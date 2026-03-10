import { Router } from "express";
import { query } from "../config/db.js";

const router = Router();

// GET /api/interviews/:id/candidates — JSON list scoped to interview
router.get("/interviews/:id/candidates", async (req, res, next) => {
  try {
    const result = await query(
      "SELECT thread_id, email, status, resume_score, summary, english_score, skills, rejection_sent, created_at FROM candidates WHERE interview_id = $1 ORDER BY created_at DESC",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

export default router;
