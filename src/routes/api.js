import { Router } from "express";
import { query } from "../config/db.js";
import { requireAdmin } from "../middleware/auth.js";
import { getMCPDebugStatus } from "../services/mcp.js";

const router = Router();

// GET /api/debug/mcp — MCP runtime health/status (admin only)
router.get("/debug/mcp", requireAdmin, async (_req, res) => {
  res.json(getMCPDebugStatus());
});

// GET /api/interviews/:id/candidates — JSON list scoped to interview
router.get("/interviews/:id/candidates", async (req, res, next) => {
  try {
    const result = await query(
      "SELECT thread_id, email, status, resume_score, summary, english_score, confidence_score, skills, salary_expectation, video_summary, rejection_sent, assignment_method, match_confidence, created_at, video_path FROM candidates WHERE interview_id = $1 ORDER BY created_at DESC",
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

export default router;
