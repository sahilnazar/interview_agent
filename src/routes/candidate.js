import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";

import { query } from "../config/db.js";
import { INTERVIEW_QUESTION } from "../config/env.js";
import { requireCandidate } from "../middleware/auth.js";
import { analyzeVideoForCandidate } from "../graph/actions.js";
import { sendScheduleConfirmedEmails } from "../services/scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const router = Router();

// GET /candidate/change-password — show change-password form
router.get("/change-password", requireCandidate, (req, res) => {
  res.render("change-password", { error: null });
});

// POST /candidate/change-password — process password change
router.post("/change-password", requireCandidate, async (req, res, next) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    if (!newPassword || !confirmPassword) {
      return res.render("change-password", { error: "All fields are required" });
    }
    if (newPassword.length < 6) {
      return res.render("change-password", { error: "Password must be at least 6 characters" });
    }
    if (newPassword !== confirmPassword) {
      return res.render("change-password", { error: "Passwords do not match" });
    }

    const nextPath = req.session?.candidate?.nextPath || "/candidate/interview";
    const hash = await bcrypt.hash(newPassword, 10);
    await query(
      "UPDATE candidates SET password_hash = $1, must_change_password = FALSE WHERE thread_id = $2",
      [hash, req.session.candidate.threadId]
    );

    req.session.candidate.mustChangePassword = false;
    req.session.candidate.nextPath = "/candidate/interview";
    res.redirect(nextPath);
  } catch (err) {
    next(err);
  }
});

// ── MIME helper — strips codec params so "video/webm;codecs=vp9,opus" → "video/webm" ──
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

function normalizeVideoMime(mimetype) {
  return (mimetype || "").split(";")[0].trim().toLowerCase();
}

function isAllowedVideo(mimetype) {
  return ALLOWED_VIDEO_TYPES.has(normalizeVideoMime(mimetype));
}

// Broader check for webcam-recorded blobs — browsers may report video/x-matroska,
// application/octet-stream, or empty string when MediaRecorder type is not set.
function isAllowedVideoBlob(mimetype) {
  const norm = normalizeVideoMime(mimetype);
  return norm.startsWith("video/") || norm === "application/octet-stream" || norm === "";
}

// ── Multer for existing /upload-video route (dashboard form upload) ──
const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const base = normalizeVideoMime(file.mimetype);
    const extMap = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };
    const ext = extMap[base] || ".mp4";
    cb(null, `${req.session.candidate.threadId}-${Date.now()}${ext}`);
  },
});

const videoUpload = multer({
  storage: videoStorage,
  fileFilter: (_req, file, cb) => {
    if (isAllowedVideo(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error("Only MP4, WebM, and QuickTime videos are accepted");
      err.status = 415;
      cb(err, false);
    }
  },
  limits: { fileSize: 200 * 1024 * 1024 },
});

// GET /candidate/dashboard — candidate sees their own status
router.get("/dashboard", requireCandidate, async (req, res, next) => {
  try {
    const { threadId } = req.session.candidate;
    const result = await query(
      `SELECT c.*, i.title AS interview_title
       FROM candidates c
       JOIN interviews i ON i.id = c.interview_id
       WHERE c.thread_id = $1`,
      [threadId]
    );
    if (!result.rows.length) return res.status(404).send("Not found");

    const candidate = result.rows[0];
    let summary = null;
    try { summary = candidate.summary ? JSON.parse(candidate.summary) : null; } catch {}

    res.render("candidate-dashboard", {
      candidate,
      summary,
      question: INTERVIEW_QUESTION,
    });
  } catch (err) {
    next(err);
  }
});

// POST /candidate/upload-video — candidate submits their video (dashboard file input)
router.post("/upload-video", requireCandidate, (req, res, next) => {
  videoUpload.single("video")(req, res, async (multerErr) => {
    try {
      const { threadId } = req.session.candidate;

      if (multerErr) {
        if (multerErr.code === "LIMIT_FILE_SIZE") {
          return res.status(413).send("File too large — 200 MB maximum");
        }
        return res.status(400).send(multerErr.message);
      }

      const result = await query("SELECT status FROM candidates WHERE thread_id = $1", [threadId]);
      if (!result.rows.length) return res.status(404).send("Not found");
      if (result.rows[0].status !== "AwaitingVideo") {
        return res.redirect("/candidate/dashboard");
      }

      if (!req.file) return res.status(400).send("No video file uploaded");

      const videoPath = req.file.path;
      await query("UPDATE candidates SET video_path = $1, status = 'VideoReceived' WHERE thread_id = $2", [videoPath, threadId]);

      analyzeVideoForCandidate(threadId, videoPath).catch((err) =>
        console.error(`Video analysis error for ${threadId}:`, err.message)
      );

      res.redirect("/candidate/dashboard");
    } catch (err) {
      next(err);
    }
  });
});

// ── Multer for /interview/upload (webcam MediaRecorder blob) ──
// NOTE: fileFilter MUST use cb(null, false) — never cb(err, false) — for POST
// with large bodies. cb(err, false) causes multer to abort the stream mid-upload
// which resets the TCP connection on the client side (ERR_CONNECTION_RESET).
// MIME validation is done AFTER the upload in the route handler instead.
const interviewVideoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, _file, cb) => {
    // Use optional chaining — session is guaranteed by the guard below, but
    // multer's diskStorage callback is sync so any throw here is unrecoverable.
    const id = req.session?.candidate?.threadId || `tmp-${Date.now()}`;
    cb(null, `interview-${id}-${Date.now()}.webm`);
  },
});

const interviewVideoUpload = multer({
  storage: interviewVideoStorage,
  // Accept all MIME types here — we validate below after the body is consumed
  fileFilter: (_req, _file, cb) => cb(null, true),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

// GET /candidate/interview — webcam recording interview page
router.get("/interview", requireCandidate, async (req, res, next) => {
  try {
    const { threadId } = req.session.candidate;
    const result = await query("SELECT status FROM candidates WHERE thread_id = $1", [threadId]);
    if (!result.rows.length) return res.status(404).send("Not found");

    const { status } = result.rows[0];
    const recordingAllowed = ["AwaitingVideo", "Screening"].includes(status);
    if (!recordingAllowed) {
      return res.redirect("/candidate/dashboard");
    }

    const alreadySubmitted = status !== "AwaitingVideo";
    res.render("candidate-interview", { alreadySubmitted, status });
  } catch (err) {
    next(err);
  }
});

// POST /candidate/interview/upload — accept webcam-recorded video blob
// IMPORTANT: Do NOT use requireCandidate here — it issues a redirect() which
// resets the TCP connection while the browser is still streaming the large file.
// Instead we check the session manually AFTER multer has consumed the body.
router.post("/interview/upload", (req, res) => {
  // Guard: session must exist before we touch the body. If not, drain and respond.
  if (!req.session || !req.session.candidate) {
    // Drain the incoming stream so the client connection is closed cleanly
    req.resume();
    return res.status(401).json({ error: "Session expired — please log in again" });
  }

  interviewVideoUpload.single("video")(req, res, async (multerErr) => {
    try {
      if (multerErr) {
        if (multerErr.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large — 200 MB maximum" });
        }
        return res.status(400).json({ error: multerErr.message || "Upload error" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No video file received" });
      }

      // MIME check intentionally skipped for webcam recordings —
      // browsers may report text/plain, application/octet-stream, or empty string.
      // This endpoint is session-protected so we trust the source is our recorder.

      const { threadId } = req.session.candidate;
      console.log(`[Upload] Received video from ${threadId}: ${req.file.originalname} (${req.file.size} bytes)`);

      const dbResult = await query("SELECT status FROM candidates WHERE thread_id = $1", [threadId]);
      if (!dbResult.rows.length) {
        return res.status(404).json({ error: "Candidate not found" });
      }

      const { status } = dbResult.rows[0];
      // Accept upload if AwaitingVideo or Screening (pipeline may not have set status yet)
      if (!["AwaitingVideo", "Screening"].includes(status)) {
        return res.status(409).json({ error: "Video already submitted — check your dashboard" });
      }

      // Rename file with correct extension (default .webm for webcam blobs)
      const extMap = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/x-matroska": ".webm" };
      const ext = extMap[normalizeVideoMime(req.file.mimetype)] || ".webm";
      const finalPath = path.join(UPLOADS_DIR, `interview-${threadId}-${Date.now()}${ext}`);
      fs.renameSync(req.file.path, finalPath);

      await query(
        "UPDATE candidates SET video_path = $1, status = 'VideoReceived' WHERE thread_id = $2",
        [finalPath, threadId]
      );

      // Fire-and-forget — analysis runs in background, never blocks the response
      analyzeVideoForCandidate(threadId, finalPath).catch((err) => {
        console.error(`[Upload] Video analysis error for ${threadId}:`, err.message || err);
      });

      console.log(`[Upload] Success for ${threadId} → ${finalPath}`);
      return res.json({ success: true, message: "Video received — analysis in progress" });
    } catch (err) {
      console.error("[Upload] Unexpected error:", err.message || err);
      if (!res.headersSent) {
        return res.status(500).json({ error: "Server error — please try again" });
      }
    }
  });
});

// ─── GET /candidate/schedule/accept/:token ────────────────────────────────
router.get("/schedule/accept/:token", async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT si.*, i.name AS interviewer_name, c.email AS candidate_email
       FROM scheduled_interviews si
       JOIN interviewers i ON i.id = si.interviewer_id
       JOIN candidates c ON c.thread_id = si.candidate_id
       WHERE si.candidate_token = $1`,
      [token]
    );
    if (!result.rows.length) return res.status(404).send("Link invalid or expired");
    const si = result.rows[0];

    if (si.status !== "pending_candidate") {
      return res.render("schedule-done", {
        role: "candidate",
        decision: si.status === "confirmed" ? "confirm" : "already",
        slot_start: si.slot_start,
      });
    }

    res.render("schedule-respond", { si, role: "candidate", token, error: null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /candidate/schedule/accept/:token ───────────────────────────────
router.post("/schedule/accept/:token", async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      "SELECT * FROM scheduled_interviews WHERE candidate_token = $1",
      [token]
    );
    if (!result.rows.length) return res.status(404).send("Link invalid or expired");
    const si = result.rows[0];

    if (si.status !== "pending_candidate") {
      return res.render("schedule-done", { role: "candidate", decision: "already", slot_start: si.slot_start });
    }

    const guard = await query(
      `SELECT s.status AS slot_status
       FROM scheduled_interviews si
       JOIN candidates c ON c.thread_id = si.candidate_id
       LEFT JOIN interviewer_slots s ON s.id = si.slot_id
       WHERE si.id = $1`,
      [si.id]
    );
    if (!guard.rows.length) {
      return res.status(404).send("Scheduled slot not found");
    }

    const slotStatus = guard.rows[0].slot_status;

    if (si.slot_id && slotStatus !== "available" && slotStatus !== "booked") {
      return res.status(409).send("Selected time slot is no longer available");
    }

    await query(
      `WITH released AS (
         UPDATE scheduled_interviews
         SET status = 'cancelled'
         WHERE candidate_id = $1
           AND status = 'pending_candidate'
           AND id != $2
         RETURNING slot_id
       )
       UPDATE interviewer_slots
       SET status = 'available'
       WHERE id = ANY(SELECT slot_id FROM released)
         AND id IS NOT NULL`,
      [si.candidate_id, si.id]
    );

    await query(
      "UPDATE scheduled_interviews SET status = 'confirmed', meet_link = COALESCE(meet_link, $2) WHERE id = $1",
      [si.id, "https://meet.google.com/new"]
    );

    if (si.slot_id) {
      await query(
        "UPDATE interviewer_slots SET status = 'booked' WHERE id = $1",
        [si.slot_id]
      );
    }

    await sendScheduleConfirmedEmails(si.id);

    res.render("schedule-done", { role: "candidate", decision: "confirm", slot_start: si.slot_start });
  } catch (err) {
    next(err);
  }
});

export default router;
