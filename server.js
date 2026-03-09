import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import chokidar from "chokidar";
import pdfParse from "pdf-parse";

import { initDB, query } from "./db.js";
import { createGraph, inviteCandidateById, rejectCandidateById, analyzeVideoForCandidate } from "./graph.js";
import { initMCPClients } from "./mcp.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
const CVS_DIR = path.join(__dirname, "cvs");
const CVS_PROCESSED_DIR = path.join(CVS_DIR, "processed");
const PORT = parseInt(process.env.PORT || "3000", 10);

const INTERVIEW_QUESTION =
  "Record a 2–3 minute video introducing yourself, discussing your relevant " +
  "experience, and explaining why you're interested in this position. " +
  "Focus on demonstrating your technical knowledge and communication skills.";

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------

function validateEnv() {
  const required = ["GROQ_API_KEY", "PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!process.env.GOOGLE_API_KEY) {
    console.warn("GOOGLE_API_KEY not set — video analysis (Gemini) will be unavailable");
  }
}

// ---------------------------------------------------------------------------
// Multer configuration
// ---------------------------------------------------------------------------

// Resumes: kept in memory for hashing + PDF parsing
const resumeUpload = multer({ storage: multer.memoryStorage() });

// Videos: saved to disk
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `${req.params.threadId}-${Date.now()}${ext}`);
  },
});

const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

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
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

async function main() {
  validateEnv();
  await initDB();
  await initMCPClients();
  const compiledGraph = await createGraph();

  const app = express();
  app.set("view engine", "pug");
  app.set("views", path.join(__dirname, "views"));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // -----------------------------------------------------------------------
  // GET /admin — dashboard
  // -----------------------------------------------------------------------
  app.get("/admin", async (_req, res, next) => {
    try {
      const settingsRows = await query("SELECT key, value FROM settings");
      const settings = {};
      for (const r of settingsRows.rows) settings[r.key] = r.value;

      const candidatesRows = await query(
        "SELECT thread_id, email, status, resume_score, summary, english_score, skills, created_at FROM candidates ORDER BY created_at DESC"
      );

      res.render("admin", {
        settings,
        candidates: candidatesRows.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /admin/settings — update JD, domain filter, pass threshold
  // -----------------------------------------------------------------------
  app.post("/admin/settings", async (req, res, next) => {
    try {
      const { jd, domainFilter, passThreshold } = req.body;
      if (jd !== undefined) await query("UPDATE settings SET value = $1 WHERE key = 'jd'", [jd]);
      if (domainFilter !== undefined) await query("UPDATE settings SET value = $1 WHERE key = 'domainFilter'", [domainFilter]);
      if (passThreshold !== undefined) await query("UPDATE settings SET value = $1 WHERE key = 'passThreshold'", [String(passThreshold)]);
      res.redirect("/admin");
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /admin/trigger — manually trigger graph for email + resume
  // -----------------------------------------------------------------------
  app.post("/admin/trigger", resumeUpload.single("resume"), async (req, res, next) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).send("Email is required");
      if (!req.file) return res.status(400).send("Resume PDF is required");

      const threadId = uuidv4();
      const config = { configurable: { thread_id: threadId } };

      // Fire graph and don't block the HTTP response for the full run.
      // Errors are captured inside graph nodes.
      compiledGraph
        .invoke({ candidateEmail: email, resumeBuffer: req.file.buffer, threadId }, config)
        .then(() => console.log(`Graph completed for ${threadId}`))
        .catch((err) => console.error(`Graph error for ${threadId}:`, err.message));

      res.redirect("/admin");
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /admin/invite/:threadId — admin sends invite to a screened candidate
  // -----------------------------------------------------------------------
  app.post("/admin/invite/:threadId", async (req, res, next) => {
    try {
      await inviteCandidateById(req.params.threadId);
      res.redirect("/admin");
    } catch (err) {
      if (err.message.includes("not found")) return res.status(404).send(err.message);
      if (err.message.includes("not in Screened")) return res.status(409).send(err.message);
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /admin/reject/:threadId — admin rejects a screened candidate
  // -----------------------------------------------------------------------
  app.post("/admin/reject/:threadId", async (req, res, next) => {
    try {
      await rejectCandidateById(req.params.threadId);
      res.redirect("/admin");
    } catch (err) {
      if (err.message.includes("not found")) return res.status(404).send(err.message);
      if (err.message.includes("not in Screened")) return res.status(409).send(err.message);
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // POST /admin/delete/:threadId — delete a candidate so they can be re-uploaded
  // -----------------------------------------------------------------------
  app.post("/admin/delete/:threadId", async (req, res, next) => {
    try {
      const { threadId } = req.params;
      const result = await query("DELETE FROM candidates WHERE thread_id = $1 RETURNING thread_id", [threadId]);
      if (!result.rows.length) return res.status(404).send("Candidate not found");
      res.redirect("/admin");
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // GET /upload/:threadId — candidate upload page
  // -----------------------------------------------------------------------
  app.get("/upload/:threadId", async (req, res, next) => {
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

  // -----------------------------------------------------------------------
  // POST /upload/:threadId — accept video, resume graph
  // -----------------------------------------------------------------------
  app.post("/upload/:threadId", (req, res, next) => {
    videoUpload.single("video")(req, res, async (multerErr) => {
      try {
        const { threadId } = req.params;

        // Multer errors
        if (multerErr) {
          if (multerErr.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ error: "File too large — 200 MB maximum" });
          }
          if (multerErr.status === 415 || multerErr.message?.includes("Only MP4")) {
            return res.status(415).json({ error: multerErr.message });
          }
          return res.status(400).json({ error: multerErr.message });
        }

        // Candidate checks
        const result = await query("SELECT status FROM candidates WHERE thread_id = $1", [threadId]);
        if (!result.rows.length) return res.status(404).json({ error: "Not found" });
        if (result.rows[0].status !== "AwaitingVideo") {
          return res.status(409).json({ error: "Submission already received or link expired" });
        }
        if (!req.file) return res.status(400).json({ error: "No video file provided" });

        const videoPath = req.file.path;

        // Run video analysis in background
        analyzeVideoForCandidate(threadId, videoPath)
          .then((result) => console.log(`Video analysis complete for ${threadId}:`, result))
          .catch((err) => console.error(`Video analysis error for ${threadId}:`, err.message));

        res.json({ success: true, message: "Submission received — we'll be in touch" });
      } catch (err) {
        next(err);
      }
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/candidates — JSON list
  // -----------------------------------------------------------------------
  app.get("/api/candidates", async (_req, res, next) => {
    try {
      const result = await query(
        "SELECT thread_id, email, status, resume_score, summary, english_score, skills, created_at FROM candidates ORDER BY created_at DESC"
      );
      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------------
  // Root redirect
  // -----------------------------------------------------------------------
  app.get("/", (_req, res) => res.redirect("/admin"));

  // -----------------------------------------------------------------------
  // Error handler
  // -----------------------------------------------------------------------
  app.use((err, _req, res, _next) => {
    console.error(err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || "Internal server error" });
  });

  // -----------------------------------------------------------------------
  // Start
  // -----------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // CV Folder Watcher — auto-pick up PDFs from /cvs
  // ---------------------------------------------------------------------
  fs.mkdirSync(CVS_DIR, { recursive: true });
  fs.mkdirSync(CVS_PROCESSED_DIR, { recursive: true });

  const processing = new Set(); // avoid double-processing

  async function processCV(filePath) {
    const basename = path.basename(filePath);
    if (processing.has(filePath)) return;
    processing.add(filePath);

    try {
      // Wait briefly for the file write to finish
      await new Promise((r) => setTimeout(r, 1000));

      if (!fs.existsSync(filePath)) return;
      const buf = fs.readFileSync(filePath);
      if (buf.length === 0) { console.warn(`CV watcher: ${basename} is empty — skipped`); return; }

      // Try to extract an email from the PDF text
      let resumeText = "";
      try {
        const pdfData = await pdfParse(buf);
        resumeText = pdfData.text;
      } catch {
        resumeText = buf.toString("utf-8");
      }

      // Look for email in the PDF content
      const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
      const emails = resumeText.match(emailRegex) || [];

      // Also try to parse email from filename: "john@company.com.pdf" or "john@company.com - resume.pdf"
      const nameWithoutExt = basename.replace(/\.pdf$/i, "");
      const filenameEmails = nameWithoutExt.match(emailRegex) || [];

      // Prefer filename email, then first email found in PDF content
      const candidateEmail = filenameEmails[0] || emails[0];

      if (!candidateEmail) {
        console.warn(`CV watcher: No email found in ${basename} — skipped (rename file to email@domain.pdf)`);
        return;
      }

      const threadId = uuidv4();
      const config = { configurable: { thread_id: threadId } };

      console.log(`CV watcher: Processing ${basename} → ${candidateEmail} (${threadId})`);

      compiledGraph
        .invoke({ candidateEmail, resumeBuffer: buf, threadId }, config)
        .then(() => console.log(`CV watcher: Graph completed for ${candidateEmail} (${threadId})`))
        .catch((err) => console.error(`CV watcher: Graph error for ${candidateEmail}:`, err.message));

      // Move file to processed folder
      const dest = path.join(CVS_PROCESSED_DIR, `${Date.now()}-${basename}`);
      fs.renameSync(filePath, dest);
      console.log(`CV watcher: Moved ${basename} → processed/`);
    } catch (err) {
      console.error(`CV watcher: Error processing ${basename}:`, err.message);
    } finally {
      processing.delete(filePath);
    }
  }

  chokidar
    .watch(CVS_DIR, {
      ignored: [CVS_PROCESSED_DIR, /(^|[\/\\])\..*/],
      depth: 0,
      ignoreInitial: false, // process files already in the folder on startup
    })
    .on("add", (filePath) => {
      if (path.extname(filePath).toLowerCase() === ".pdf") {
        processCV(filePath);
      }
    });

  console.log(`CV watcher: Watching ${CVS_DIR} for new PDFs`);

  app.listen(PORT, () => {
    console.log(`Interview Assistant running → http://localhost:${PORT}/admin`);
  });
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
