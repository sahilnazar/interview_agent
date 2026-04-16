import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";

import { query } from "../config/db.js";

const router = Router();
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, DOC, or DOCX files are accepted"), false);
    }
  },
});

// GET /careers — public careers portal
router.get("/", (_req, res) => {
  res.render("careers");
});

// GET /careers/jobs — JSON list of active interviews (public)
router.get("/jobs", async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, jd, created_at
       FROM interviews
       WHERE status = 'active'
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /careers/apply/:interviewId — candidate submits application
router.post("/apply/:interviewId", resumeUpload.single("resume"), async (req, res, next) => {
  try {
    const { interviewId } = req.params;
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Resume file is required (PDF, DOC, or DOCX)" });
    }

    // Verify interview exists and is active
    const intRow = await query(
      "SELECT id, title FROM interviews WHERE id = $1 AND status = 'active'",
      [interviewId]
    );
    if (!intRow.rows.length) {
      return res.status(404).json({ error: "This position is no longer available" });
    }

    // Check for duplicate application (same email + interview)
    const existing = await query(
      "SELECT thread_id FROM candidates WHERE email = $1 AND interview_id = $2",
      [email.trim().toLowerCase(), interviewId]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: "You have already applied for this position" });
    }

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    // Fire the same pipeline as the admin trigger — non-blocking
    req.app.locals.compiledGraph
      .invoke(
        {
          candidateEmail: email.trim().toLowerCase(),
          resumeBuffer: req.file.buffer,
          threadId,
          interviewId,
        },
        config
      )
      .then(() => console.log(`[Careers] Pipeline completed for ${threadId} (${email})`))
      .catch((err) => console.error(`[Careers] Pipeline error for ${threadId}:`, err.message));

    res.json({
      success: true,
      message: "Application received! You will receive an email with next steps shortly.",
    });
  } catch (err) {
    if (!res.headersSent) {
      next(err);
    }
  }
});

export default router;
