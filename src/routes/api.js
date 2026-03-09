import { Router } from "express";
import { query } from "../config/db.js";

const router = Router();

// GET /api/candidates — JSON list
router.get("/candidates", async (_req, res, next) => {
  try {
    const result = await query(
      "SELECT thread_id, email, status, resume_score, summary, english_score, skills, created_at FROM candidates ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

export default router;
