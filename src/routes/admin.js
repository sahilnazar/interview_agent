import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";

import { query } from "../config/db.js";
import { inviteCandidateById, rejectCandidateById } from "../graph/actions.js";

const router = Router();
const resumeUpload = multer({ storage: multer.memoryStorage() });

// GET /admin — dashboard
router.get("/", async (_req, res, next) => {
  try {
    const settingsRows = await query("SELECT key, value FROM settings");
    const settings = {};
    for (const r of settingsRows.rows) settings[r.key] = r.value;

    const candidatesRows = await query(
      "SELECT thread_id, email, status, resume_score, summary, english_score, skills, created_at FROM candidates ORDER BY created_at DESC"
    );

    res.render("admin", { settings, candidates: candidatesRows.rows });
  } catch (err) {
    next(err);
  }
});

// POST /admin/settings
router.post("/settings", async (req, res, next) => {
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

// POST /admin/trigger — manually trigger graph for email + resume
router.post("/trigger", resumeUpload.single("resume"), async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).send("Email is required");
    if (!req.file) return res.status(400).send("Resume PDF is required");

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    // compiledGraph is attached by app.js
    req.app.locals.compiledGraph
      .invoke({ candidateEmail: email, resumeBuffer: req.file.buffer, threadId }, config)
      .then(() => console.log(`Graph completed for ${threadId}`))
      .catch((err) => console.error(`Graph error for ${threadId}:`, err.message));

    res.redirect("/admin");
  } catch (err) {
    next(err);
  }
});

// POST /admin/invite/:threadId
router.post("/invite/:threadId", async (req, res, next) => {
  try {
    await inviteCandidateById(req.params.threadId);
    res.redirect("/admin");
  } catch (err) {
    if (err.message.includes("not found")) return res.status(404).send(err.message);
    if (err.message.includes("not in Screened")) return res.status(409).send(err.message);
    next(err);
  }
});

// POST /admin/reject/:threadId
router.post("/reject/:threadId", async (req, res, next) => {
  try {
    await rejectCandidateById(req.params.threadId);
    res.redirect("/admin");
  } catch (err) {
    if (err.message.includes("not found")) return res.status(404).send(err.message);
    if (err.message.includes("not in Screened")) return res.status(409).send(err.message);
    next(err);
  }
});

// POST /admin/delete/:threadId
router.post("/delete/:threadId", async (req, res, next) => {
  try {
    const { threadId } = req.params;
    const result = await query("DELETE FROM candidates WHERE thread_id = $1 RETURNING thread_id", [threadId]);
    if (!result.rows.length) return res.status(404).send("Candidate not found");
    res.redirect("/admin");
  } catch (err) {
    next(err);
  }
});

export default router;
