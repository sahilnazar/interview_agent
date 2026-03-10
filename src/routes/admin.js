import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";

import { query } from "../config/db.js";
import { reselectCandidateById, rejectCandidateById } from "../graph/actions.js";
import { storeJDChunks, getEmbedStatus } from "../services/embeddings.js";
import { sendRejectionEmail } from "../services/email.js";

const router = Router();
const resumeUpload = multer({ storage: multer.memoryStorage() });

// ─── Interview List ──────────────────────────────────────────────────────
// GET /admin — list all interviews
router.get("/", async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT i.*, 
              COUNT(c.thread_id) AS candidate_count
       FROM interviews i
       LEFT JOIN candidates c ON c.interview_id = i.id
       GROUP BY i.id
       ORDER BY i.created_at DESC`
    );

    // Load global settings for the page
    const settingsResult = await query("SELECT key, value FROM settings");
    const settings = {};
    for (const r of settingsResult.rows) settings[r.key] = r.value;

    res.render("admin", { interviews: result.rows, settings });
  } catch (err) {
    next(err);
  }
});

// POST /admin/settings — save global embedding settings
router.post("/settings", async (req, res, next) => {
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
    res.redirect("/admin");
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews — create a new interview
router.post("/interviews", async (req, res, next) => {
  try {
    const { title } = req.body;
    if (!title || !title.trim()) return res.status(400).send("Title is required");
    const id = uuidv4();
    await query(
      "INSERT INTO interviews (id, title, created_at) VALUES ($1, $2, NOW())",
      [id, title.trim()]
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
router.get("/interviews/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const intRow = await query("SELECT * FROM interviews WHERE id = $1", [id]);
    if (!intRow.rows.length) return res.status(404).send("Interview not found");

    const candidates = await query(
      "SELECT thread_id, email, status, resume_score, summary, english_score, skills, rejection_sent, created_at FROM candidates WHERE interview_id = $1 ORDER BY created_at DESC",
      [id]
    );

    res.render("interview", {
      interview: intRow.rows[0],
      candidates: candidates.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews/:id/settings — update JD, threshold, domain filter
router.post("/interviews/:id/settings", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { jd, passThreshold, domainFilter } = req.body;

    const updates = [];
    const params = [];
    let idx = 1;

    if (jd !== undefined) { updates.push(`jd = $${idx++}`); params.push(jd); }
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
router.post("/interviews/:id/trigger", resumeUpload.single("resume"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    if (!email) return res.status(400).send("Email is required");
    if (!req.file) return res.status(400).send("Resume PDF is required");

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    req.app.locals.compiledGraph
      .invoke({ candidateEmail: email, resumeBuffer: req.file.buffer, threadId, interviewId: id }, config)
      .then(() => console.log(`Graph completed for ${threadId}`))
      .catch((err) => console.error(`Graph error for ${threadId}:`, err.message));

    res.redirect(`/admin/interviews/${id}`);
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews/:id/reselect/:threadId — re-invite a rejected candidate
router.post("/interviews/:id/reselect/:threadId", async (req, res, next) => {
  try {
    await reselectCandidateById(req.params.threadId);
    res.redirect(`/admin/interviews/${req.params.id}`);
  } catch (err) {
    if (err.message.includes("not found")) return res.status(404).send(err.message);
    if (err.message.includes("not in Rejected")) return res.status(409).send(err.message);
    next(err);
  }
});

// POST /admin/interviews/:id/reject/:threadId — manually reject a candidate
router.post("/interviews/:id/reject/:threadId", async (req, res, next) => {
  try {
    await rejectCandidateById(req.params.threadId);
    res.redirect(`/admin/interviews/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews/:id/delete/:threadId — delete a candidate
router.post("/interviews/:id/delete/:threadId", async (req, res, next) => {
  try {
    const result = await query("DELETE FROM candidates WHERE thread_id = $1 RETURNING thread_id", [req.params.threadId]);
    if (!result.rows.length) return res.status(404).send("Candidate not found");
    res.redirect(`/admin/interviews/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// POST /admin/interviews/:id/bulk-reject-email — send rejection emails to all unsent rejected
router.post("/interviews/:id/bulk-reject-email", async (req, res, next) => {
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

// GET /admin/interviews/:id/embed-status — SSE-like status for JD embedding
router.get("/interviews/:id/embed-status", async (req, res) => {
  res.json(getEmbedStatus(req.params.id));
});

// POST /admin/interviews/:id/delete-interview — delete an entire interview
router.post("/interviews/:id/delete-interview", async (req, res, next) => {
  try {
    await query("DELETE FROM interviews WHERE id = $1", [req.params.id]);
    res.redirect("/admin");
  } catch (err) {
    next(err);
  }
});

export default router;
