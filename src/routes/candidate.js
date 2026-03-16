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
import { sendInterviewerConfirmationRequest } from "../services/scheduler.js";

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

    const hash = await bcrypt.hash(newPassword, 10);
    await query(
      "UPDATE candidates SET password_hash = $1, must_change_password = FALSE WHERE thread_id = $2",
      [hash, req.session.candidate.threadId]
    );

    req.session.candidate.mustChangePassword = false;
    res.redirect("/candidate/dashboard");
  } catch (err) {
    next(err);
  }
});

const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, _file, cb) => {
    const ext = ".mp4";
    cb(null, `${req.session.candidate.threadId}-${Date.now()}${ext}`);
  },
});

const videoUpload = multer({
  storage: videoStorage,
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_VIDEO_TYPES.has(file.mimetype)) {
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

// POST /candidate/upload-video — candidate submits their video
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

      // Kick off video analysis in the background
      analyzeVideoForCandidate(threadId, videoPath).catch((err) =>
        console.error(`Video analysis error for ${threadId}:`, err.message)
      );

      res.redirect("/candidate/dashboard");
    } catch (err) {
      next(err);
    }
  });
});

// ─── GET /candidate/schedule/accept/:token ────────────────────────────────
// Token link from email — candidate picks this slot (no login needed)
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

    // Mark this slot as pending_interviewer; cancel the other pending options for this candidate
    await query(
      `UPDATE scheduled_interviews
       SET status = 'cancelled'
       WHERE candidate_id = $1
         AND status = 'pending_candidate'
         AND id != $2`,
      [si.candidate_id, si.id]
    );

    await query(
      "UPDATE scheduled_interviews SET status = 'pending_interviewer' WHERE id = $1",
      [si.id]
    );

    // Notify interviewer
    await sendInterviewerConfirmationRequest(si.id);

    res.render("schedule-done", { role: "candidate", decision: "confirm", slot_start: si.slot_start });
  } catch (err) {
    next(err);
  }
});

export default router;
