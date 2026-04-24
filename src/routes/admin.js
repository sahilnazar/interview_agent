import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";

import { query } from "../config/db.js";
import { requireAdmin } from "../middleware/auth.js";
import { reselectCandidateById, rejectCandidateById } from "../graph/actions.js";
import { storeJDChunks, getEmbedStatus } from "../services/embeddings.js";
import { sendRejectionEmail } from "../services/email.js";
import { restartEmailIngest } from "../services/email-ingest.js";
import {
  sendBulkOutcomeEmails,
  sendBulkOutcomeEmailsIfDue,
  getHrAssignmentRequests,
  getPendingHrRequestCount,
  getHrAssignmentRequest,
  approveInterviewerAssignmentRequest,
  rejectInterviewerAssignmentRequest,
} from "../services/scheduler.js";

const router = Router();
const resumeUpload = multer({ storage: multer.memoryStorage() });

// ─── Interview List ──────────────────────────────────────────────────────
// GET /admin — list all interviews and show interview creation
router.get("/", requireAdmin, async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT i.*, 
              COUNT(c.thread_id) AS candidate_count
       FROM interviews i
       LEFT JOIN candidates c ON c.interview_id = i.id
       GROUP BY i.id
       ORDER BY i.created_at DESC`
    );

    const pendingHrCount = await getPendingHrRequestCount();
    res.render("admin", { interviews: result.rows, pendingHrCount });
  } catch (err) {
    next(err);
  }
});

// GET /admin/hr-requests — show HR assignment requests panel
router.get("/hr-requests", requireAdmin, async (_req, res, next) => {
  try {
    const requests = await getHrAssignmentRequests();
    const pendingCount = await getPendingHrRequestCount();
    res.render("hr-requests", { requests, pendingCount });
  } catch (err) {
    next(err);
  }
});

// GET /admin/hr-requests/:requestId — view single HR request detail
router.get("/hr-requests/:requestId", requireAdmin, async (req, res, next) => {
  try {
    const request = await getHrAssignmentRequest(req.params.requestId);
    if (!request) return res.status(404).send("Request not found");
    res.render("hr-request-detail", { request });
  } catch (err) {
    next(err);
  }
});

// POST /admin/hr-requests/:requestId/approve/:interviewerId — HR approves an interviewer
router.post("/hr-requests/:requestId/approve/:interviewerId", requireAdmin, async (req, res, next) => {
  try {
    const { requestId, interviewerId } = req.params;
    const { notes } = req.body;
    await approveInterviewerAssignmentRequest(requestId, interviewerId, notes || "");
    res.redirect("/admin/hr-requests");
  } catch (err) {
    next(err);
  }
});

// POST /admin/hr-requests/:requestId/reject — HR rejects the request
router.post("/hr-requests/:requestId/reject", requireAdmin, async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { notes } = req.body;
    await rejectInterviewerAssignmentRequest(requestId, notes || "Rejected by HR");
    res.redirect("/admin/hr-requests");
  } catch (err) {
    next(err);
  }
});

// GET /admin/settings — show admin settings page
router.get("/settings", requireAdmin, async (req, res, next) => {
  try {
    const settingsResult = await query("SELECT key, value FROM settings");
    const settings = {};
    for (const r of settingsResult.rows) settings[r.key] = r.value;
    res.render("admin-settings", { settings, bulkResult: req.query.bulkResult || null });
  } catch (err) {
    next(err);
  }
});

// POST /admin/settings — save global embedding settings
router.post("/settings", requireAdmin, async (req, res, next) => {
  try {
    const { embedding_provider, ollama_base_url } = req.body;
    if (embedding_provider) {
      await query(
        "INSERT INTO settings (key, value) VALUES ('embedding_provider', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [embedding_provider]
      );
    }
    if (ollama_base_url !== undefined) {
      await query(
        "INSERT INTO settings (key, value) VALUES ('ollama_base_url', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [ollama_base_url.trim() || "http://localhost:11434"]
      );
    }
    res.redirect("/admin/settings");
  } catch (err) {
    next(err);
  }
});

// POST /admin/settings/bulk-mail — save bulk outcome email settings
router.post("/settings/bulk-mail", requireAdmin, async (req, res, next) => {
  try {
    const { bulk_mail_enabled, bulk_mail_send_time } = req.body;
    await query(
      "INSERT INTO settings (key, value) VALUES ('bulk_mail_enabled', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [bulk_mail_enabled === 'on' ? 'true' : 'false']
    );
    if (bulk_mail_send_time !== undefined) {
      await query(
        "INSERT INTO settings (key, value) VALUES ('bulk_mail_send_time', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [bulk_mail_send_time.trim() || '18:00']
      );
    }
    res.redirect("/admin/settings");
  } catch (err) {
    next(err);
  }
});

// POST /admin/settings/hr-notifications — save HR notification email list
router.post("/settings/hr-notifications", requireAdmin, async (req, res, next) => {
  try {
    const emails = (req.body.hr_notification_emails || '').trim();
    await query(
      "INSERT INTO settings (key, value) VALUES ('hr_notification_emails', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [emails]
    );
    res.redirect("/admin/settings");
  } catch (err) {
    next(err);
  }
});

// POST /admin/settings/bulk-mail/trigger — manually fire bulk outcome emails now
router.post("/settings/bulk-mail/trigger", requireAdmin, async (req, res, next) => {
  try {
    const result = await sendBulkOutcomeEmails(null, null);
    if (result.passSent + result.failSent > 0) {
      await query(
        "INSERT INTO settings (key, value) VALUES ('bulk_mail_last_sent', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [new Date().toLocaleString()]
      );
    }
    const msg = `Sent: ${result.passSent} selected, ${result.failSent} rejected (${result.passTotal + result.failTotal} total pending)`;
    console.log(`[BulkMail] Manual trigger: ${msg}`);
    res.redirect(`/admin/settings?bulkResult=${encodeURIComponent(msg)}`);
  } catch (err) {
    next(err);
  }
});

// POST /admin/settings/imap — save IMAP email ingestion settings
router.post("/settings/imap", requireAdmin, async (req, res, next) => {
  try {
    const fields = ["imap_host", "imap_port", "imap_user", "imap_password", "imap_poll_interval", "imap_folder"];
    const enabled = req.body.imap_enabled === "on" ? "true" : "false";

    await query(
      "INSERT INTO settings (key, value) VALUES ('imap_enabled', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [enabled]
    );

    for (const key of fields) {
      if (req.body[key] !== undefined) {
        await query(
          "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
          [key, req.body[key].toString().trim()]
        );
      }
    }

    // Restart the poller with new settings
    const cvsAutoDir = path.join(process.cwd(), "cvs", "auto");
    await restartEmailIngest(cvsAutoDir);

    res.redirect("/admin/settings");
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews — create a new interview
router.post("/interviews", requireAdmin, async (req, res, next) => {
  try {
    const { title, requiredSkills, salaryRange } = req.body;
    if (!title || !title.trim()) return res.status(400).send("Title is required");
    const id = uuidv4();
    await query(
      "INSERT INTO interviews (id, title, required_skills, salary_range, created_at) VALUES ($1, $2, $3, $4, NOW())",
      [id, title.trim(), (requiredSkills || '').trim(), (salaryRange || '').trim()]
    );
    // Create the CV drop folder for this interview
    fs.mkdirSync(path.join(process.cwd(), "cvs", id), { recursive: true });
    res.redirect(`/admin/interviews/${id}`);
  } catch (err) {
    next(err);
  }
});

// ─── Single Interview ────────────────────────────────────────────────────
// GET /admin/interviews/:id — interview detail page
router.get("/interviews/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const intRow = await query("SELECT * FROM interviews WHERE id = $1", [id]);
    if (!intRow.rows.length) return res.status(404).send("Interview not found");

    const candidates = await query(
      `SELECT c.thread_id, c.email, c.status, c.resume_score, c.summary, c.confidence_score,
              c.english_score, c.salary_expectation, c.video_transcript,
              c.skills, c.video_summary, c.rejection_sent, c.assignment_method,
              c.match_confidence, c.created_at, c.video_path, c.final_result,
              EXISTS(
                SELECT 1 FROM scheduled_interviews si
                WHERE si.candidate_id = c.thread_id
                  AND si.status NOT IN ('cancelled', 'rejected_candidate', 'rejected_interviewer')
              ) AS scheduled,
              (
                SELECT i.name FROM scheduled_interviews si
                JOIN interviewers i ON si.interviewer_id = i.id
                WHERE si.candidate_id = c.thread_id
                  AND si.status NOT IN ('cancelled', 'rejected_candidate', 'rejected_interviewer')
                LIMIT 1
              ) AS interviewer_name,
              (
                SELECT si.slot_start FROM scheduled_interviews si
                WHERE si.candidate_id = c.thread_id
                  AND si.status NOT IN ('cancelled', 'rejected_candidate', 'rejected_interviewer')
                LIMIT 1
              ) AS interview_scheduled_at
       FROM candidates c
       WHERE c.interview_id = $1
       ORDER BY c.created_at DESC`,
      [id]
    );

    const pendingSelected = await query(
      "SELECT COUNT(*) FROM candidates WHERE interview_id = $1 AND final_result = 'pass' AND selected_email_sent = FALSE",
      [id]
    );
    const pendingNotSelected = await query(
      "SELECT COUNT(*) FROM candidates WHERE interview_id = $1 AND final_result = 'fail' AND not_selected_email_sent = FALSE",
      [id]
    );

    const settingsRows = await query(
      "SELECT key, value FROM settings WHERE key IN ('bulk_mail_enabled', 'bulk_mail_send_time', 'bulk_mail_last_sent')"
    );
    const bulkSettings = {};
    for (const row of settingsRows.rows) {
      bulkSettings[row.key] = row.value;
    }

    res.render("interview", {
      interview: intRow.rows[0],
      candidates: candidates.rows,
      bulkMail: {
        pendingSelected: parseInt(pendingSelected.rows[0].count, 10),
        pendingNotSelected: parseInt(pendingNotSelected.rows[0].count, 10),
        ...bulkSettings,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews/:id/settings — update JD, threshold, domain filter
router.post("/interviews/:id/settings", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { jd, passThreshold, domainFilter, requiredSkills, salaryRange } = req.body;

    const updates = [];
    const params = [];
    let idx = 1;

    if (jd !== undefined) { updates.push(`jd = $${idx++}`); params.push(jd); }
    if (requiredSkills !== undefined) { updates.push(`required_skills = $${idx++}`); params.push(requiredSkills); }
    if (salaryRange !== undefined) { updates.push(`salary_range = $${idx++}`); params.push(salaryRange); }
    if (passThreshold !== undefined) { updates.push(`pass_threshold = $${idx++}`); params.push(parseFloat(passThreshold)); }
    if (domainFilter !== undefined) { updates.push(`domain_filter = $${idx++}`); params.push(domainFilter); }

    if (updates.length) {
      params.push(id);
      await query(`UPDATE interviews SET ${updates.join(", ")} WHERE id = $${idx}`, params);
    }

    // Re-embed JD chunks when JD is updated (runs in background)
    if (jd !== undefined && jd.trim()) {
      storeJDChunks(id, jd);
    }

    res.redirect(`/admin/interviews/${id}`);
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews/:id/trigger — trigger graph for a resume
router.post("/interviews/:id/trigger", requireAdmin, resumeUpload.single("resume"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!req.file) return res.status(400).json({ error: "Resume file is required (PDF, DOC, or DOCX)" });

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    // Save the uploaded buffer to processed/ so Download CV works later
    const processedDir = path.join(process.cwd(), "cvs", "processed");
    fs.mkdirSync(processedDir, { recursive: true });
    const savedName = `${threadId}-${req.file.originalname}`;
    const savedPath = path.join(processedDir, savedName);
    fs.writeFileSync(savedPath, req.file.buffer);
    console.log(`[Trigger] CV saved: ${savedPath} (${req.file.buffer.length} bytes)`);

    req.app.locals.compiledGraph
      .invoke({ candidateEmail: email, resumeBuffer: req.file.buffer, threadId, interviewId: id }, config)
      .then(() => console.log(`Graph completed for ${threadId}`))
      .catch((err) => console.error(`Graph error for ${threadId}:`, err.message));

    // Check if this is an AJAX request
    if (req.headers.accept?.includes('application/json') || req.xhr) {
      res.json({ success: true, message: `Pipeline started for ${email}`, threadId });
    } else {
      res.redirect(`/admin/interviews/${id}`);
    }
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews/:id/reselect/:threadId — re-invite a rejected candidate
router.post("/interviews/:id/reselect/:threadId", requireAdmin, async (req, res, next) => {
  try {
    await reselectCandidateById(req.params.threadId);
    res.redirect(`/admin/interviews/${req.params.id}`);
  } catch (err) {
    if (err.message.includes("not found")) return res.status(404).send(err.message);
    if (err.message.includes("not in Rejected")) return res.status(409).send(err.message);
    next(err);
  }
});

// POST /admin/interviews/:id/retry-analysis/:threadId — re-run video analysis on failed statuses
router.post("/interviews/:id/retry-analysis/:threadId", requireAdmin, async (req, res, next) => {
  try {
    const { threadId, id } = req.params;
    const result = await query("SELECT video_path, status FROM candidates WHERE thread_id = $1", [threadId]);
    if (!result.rows.length) return res.status(404).send("Candidate not found");

    const { video_path, status } = result.rows[0];
    const retryableStatuses = ["Error", "Rejected"];
    if (!retryableStatuses.includes(status)) {
      return res.status(409).send("Candidate must be in failed status (Error/Rejected) to retry analysis");
    }
    if (!video_path) return res.status(400).send("No video file found for this candidate — candidate must re-upload");

    // Reset status and stale analysis fields before retrying.
    await query(
      `UPDATE candidates
       SET status = 'VideoReceived',
           english_score = NULL,
           confidence_score = NULL,
           skills = NULL,
           salary_expectation = NULL,
           video_summary = NULL,
           video_transcript = NULL
       WHERE thread_id = $1`,
      [threadId]
    );

    // Fire analysis in background
    const { analyzeVideoForCandidate } = await import("../graph/actions.js");
    analyzeVideoForCandidate(threadId, video_path).catch((err) => {
      console.error(`[Retry] Video analysis error for ${threadId}:`, err.message);
    });

    res.redirect(`/admin/interviews/${id}`);
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews/:id/reject/:threadId — manually reject a candidate
router.post("/interviews/:id/reject/:threadId", requireAdmin, async (req, res, next) => {
  try {
    await rejectCandidateById(req.params.threadId);
    res.redirect(`/admin/interviews/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews/:id/delete/:threadId — delete a candidate
router.post("/interviews/:id/delete/:threadId", requireAdmin, async (req, res, next) => {
  try {
    // Cancel linked schedules first and release held slots so delete cannot crash on FK dependencies.
    await query(
      `WITH affected AS (
         UPDATE scheduled_interviews
         SET status = 'cancelled'
         WHERE candidate_id = $1
         RETURNING slot_id
       )
       UPDATE interviewer_slots
       SET status = 'available'
       WHERE id = ANY(SELECT slot_id FROM affected)
         AND id IS NOT NULL`,
      [req.params.threadId]
    );

    const result = await query("DELETE FROM candidates WHERE thread_id = $1 RETURNING thread_id", [req.params.threadId]);
    if (!result.rows.length) return res.status(404).send("Candidate not found");
    res.redirect(`/admin/interviews/${req.params.id}`);
  } catch (err) {
    if (err?.code === "23503") {
      return res.status(409).send("Candidate cannot be deleted yet because related records still exist.");
    }
    next(err);
  }
});

// POST /admin/interviews/:id/bulk-reject-email — send rejection emails to all unsent rejected
router.post("/interviews/:id/bulk-reject-email", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      "SELECT thread_id, email FROM candidates WHERE interview_id = $1 AND status = 'Rejected' AND rejection_sent = FALSE",
      [id]
    );

    let sent = 0;
    for (const c of result.rows) {
      try {
        await sendRejectionEmail(c.email);
        await query("UPDATE candidates SET rejection_sent = TRUE WHERE thread_id = $1", [c.thread_id]);
        sent++;
      } catch (err) {
        console.error(`Bulk reject email failed for ${c.email}:`, err.message);
      }
    }

    console.log(`Bulk rejection: sent ${sent}/${result.rows.length} emails for interview ${id}`);
    res.redirect(`/admin/interviews/${id}`);
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews/:id/bulk-outcome-email — send selection/fail outcome emails
router.post("/interviews/:id/bulk-outcome-email", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await sendBulkOutcomeEmails(id);
    console.log(`Bulk outcome email: selected=${result.passSent}/${result.passTotal}, notSelected=${result.failSent}/${result.failTotal} for interview ${id}`);
    res.redirect(`/admin/interviews/${id}`);
  } catch (err) {
    next(err);
  }
});

// GET /admin/interviews/:id/embed-status — SSE-like status for JD embedding
router.get("/interviews/:id/embed-status", requireAdmin, async (req, res) => {
  res.json(getEmbedStatus(req.params.id));
});

// POST /admin/interviews/:id/delete-interview — delete an entire interview
router.post("/interviews/:id/delete-interview", requireAdmin, async (req, res, next) => {
  try {
    await query("DELETE FROM interviews WHERE id = $1", [req.params.id]);
    res.redirect("/admin");
  } catch (err) {
    next(err);
  }
});

// GET /admin/interviews/:id/download-cv/:threadId — download candidate CV
router.get("/interviews/:id/download-cv/:threadId", requireAdmin, async (req, res, next) => {
  try {
    const { id, threadId } = req.params;
    
    // Get candidate email
    const candResult = await query(
      "SELECT email FROM candidates WHERE thread_id = $1 AND interview_id = $2",
      [threadId, id]
    );
    
    if (!candResult.rows.length) {
      console.error(`[Download CV] Candidate not found: threadId=${threadId}, interviewId=${id}`);
      return res.status(404).json({ error: "Candidate not found in database" });
    }
    
    const email = candResult.rows[0].email;
    console.log(`[Download CV] Looking for CV of ${email} (threadId=${threadId})`);
    
    const VALID_DOC_EXTS = [".pdf", ".doc", ".docx"];
    let filePath = null;

    const processedDir = path.join(process.cwd(), "cvs", "processed");

    // 1. Check cvs/processed/ for new-format files: <threadId>-<any_filename>.<ext>
    //    This works regardless of what the original file was named.
    if (fs.existsSync(processedDir)) {
      const files = fs.readdirSync(processedDir);
      const byThread = files.find((f) => f.startsWith(`${threadId}-`));
      if (byThread) {
        filePath = path.join(processedDir, byThread);
        console.log(`[Download CV] Found by threadId in processed: ${filePath}`);
      }
    }

    // 2. Check cvs/<interview_id>/ — file may still be there (not yet processed)
    if (!filePath) {
      const cvsDir = path.join(process.cwd(), "cvs", id);
      for (const ext of VALID_DOC_EXTS) {
        const file = path.join(cvsDir, email + ext);
        if (fs.existsSync(file)) {
          filePath = file;
          console.log(`[Download CV] Found in interview cvs folder: ${file}`);
          break;
        }
      }
    }

    // 3. Legacy fallback: processed files with old <timestamp>-<email>.<ext> format
    if (!filePath && fs.existsSync(processedDir)) {
      const files = fs.readdirSync(processedDir);
      for (const file of files) {
        const match = file.match(/^\d+-(.+)$/);
        if (match) {
          const originalFilename = match[1];
          if (originalFilename === email || originalFilename.startsWith(email)) {
            filePath = path.join(processedDir, file);
            console.log(`[Download CV] Found by email (legacy) in processed: ${filePath}`);
            break;
          }
        }
      }
    }

    if (!filePath) {
      console.error(`[Download CV] CV file not found for: ${email} (threadId=${threadId})`);
      return res.status(404).json({ error: `CV file not found for ${email}` });
    }
    
    // Determine download name — path.extname on email-named files returns the TLD
    // (.com, .net, etc.) which is not a valid document extension.
    const detectedExt = path.extname(filePath);
    const downloadExt = VALID_DOC_EXTS.includes(detectedExt) ? detectedExt : '.pdf';
    const downloadName = `${email}-cv${downloadExt}`;
    
    // Send file for download
    res.download(filePath, downloadName);
  } catch (err) {
    console.error(`[Download CV] Error:`, err);
    next(err);
  }
});

export default router;
