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
      `SELECT c.thread_id, c.email, c.status, c.resume_score, c.summary, c.english_score,
              c.confidence_score, c.skills, c.salary_expectation, c.video_summary, c.video_transcript,
              c.rejection_sent, c.assignment_method, c.match_confidence, c.created_at, c.video_path,
              c.final_result,
              EXISTS(
                SELECT 1 FROM scheduled_interviews si
                WHERE si.candidate_id = c.thread_id
                  AND si.status NOT IN ('cancelled','rejected_candidate','rejected_interviewer')
              ) AS scheduled,
              (SELECT i.name FROM scheduled_interviews si
               JOIN interviewers i ON si.interviewer_id = i.id
               WHERE si.candidate_id = c.thread_id
                 AND si.status NOT IN ('cancelled','rejected_candidate','rejected_interviewer')
               LIMIT 1) AS interviewer_name,
              (SELECT si.slot_start FROM scheduled_interviews si
               WHERE si.candidate_id = c.thread_id
                 AND si.status NOT IN ('cancelled','rejected_candidate','rejected_interviewer')
               LIMIT 1) AS interview_scheduled_at
       FROM candidates c WHERE c.interview_id = $1 ORDER BY c.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

export default router;
