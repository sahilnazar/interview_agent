import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { query } from "../config/db.js";
import { INTERVIEW_QUESTION } from "../config/env.js";
import { analyzeVideoForCandidate } from "../graph/actions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const router = Router();

const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `${req.params.threadId}-${Date.now()}${ext}`);
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

// GET /upload/:threadId — candidate upload page
router.get("/:threadId", async (req, res, next) => {
  try {
    const { threadId } = req.params;
    const result = await query("SELECT status FROM candidates WHERE thread_id = $1", [threadId]);
    if (!result.rows.length) return res.status(404).send("Not found");

    const { status } = result.rows[0];
    res.render("upload", {
      threadId,
      question: INTERVIEW_QUESTION,
      alreadySubmitted: status !== "AwaitingVideo",
      status,
    });
  } catch (err) {
    next(err);
  }
});

// POST /upload/:threadId — accept video
router.post("/:threadId", (req, res, next) => {
  videoUpload.single("video")(req, res, async (multerErr) => {
    try {
      const { threadId } = req.params;

      if (multerErr) {
        if (multerErr.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large — 200 MB maximum" });
        }
        if (multerErr.status === 415 || multerErr.message?.includes("Only MP4")) {
          return res.status(415).json({ error: multerErr.message });
        }
        return res.status(400).json({ error: multerErr.message });
      }

      const result = await query("SELECT status FROM candidates WHERE thread_id = $1", [threadId]);
      if (!result.rows.length) return res.status(404).json({ error: "Not found" });
      if (result.rows[0].status !== "AwaitingVideo") {
        return res.status(409).json({ error: "Submission already received or link expired" });
      }
      if (!req.file) return res.status(400).json({ error: "No video file provided" });

      const videoPath = req.file.path;

      analyzeVideoForCandidate(threadId, videoPath)
        .then((r) => console.log(`Video analysis complete for ${threadId}:`, r))
        .catch((err) => console.error(`Video analysis error for ${threadId}:`, err.message));

      res.json({ success: true, message: "Submission received — we'll be in touch" });
    } catch (err) {
      next(err);
    }
  });
});

export default router;
