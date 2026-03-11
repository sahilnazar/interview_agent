import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { query } from "../config/db.js";
import { INTERVIEW_QUESTION } from "../config/env.js";
import { requireCandidate } from "../middleware/auth.js";
import { analyzeVideoForCandidate } from "../graph/actions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const router = Router();

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

export default router;
