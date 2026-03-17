import { Router } from "express";
import { query } from "../config/db.js";
import {
  scheduleCandidate,
  sendInterviewerConfirmationRequest,
  sendScheduleRejectedEmail,
} from "../services/scheduler.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

// ─── Admin: list interviewers ──────────────────────────────────────────────
router.get("/", requireAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT i.*,
              COUNT(DISTINCT ii.interview_id) AS assigned_interviews,
              COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'available' AND s.slot_start > NOW()) AS available_slots
       FROM interviewers i
       LEFT JOIN interview_interviewers ii ON ii.interviewer_id = i.id
       LEFT JOIN interviewer_slots s ON s.interviewer_id = i.id
       GROUP BY i.id
       ORDER BY i.created_at DESC`,
    );
    res.render("interviewers-list", { interviewers: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── Admin: create interviewer ─────────────────────────────────────────────
router.post("/", requireAdmin, async (req, res, next) => {
  try {
    const { name, email, department } = req.body;
    if (!name || !email)
      return res.status(400).send("Name and email are required");
    await query(
      "INSERT INTO interviewers (name, email, department) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING",
      [name.trim(), email.trim().toLowerCase(), (department || "").trim()],
    );
    res.redirect("/admin/interviewers");
  } catch (err) {
    next(err);
  }
});

// ─── Admin: delete interviewer ─────────────────────────────────────────────
router.post("/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await query("DELETE FROM interviewers WHERE id = $1", [req.params.id]);
    res.redirect("/admin/interviewers");
  } catch (err) {
    next(err);
  }
});

// ─── Admin: assign/unassign interviewer to interview ──────────────────────
import { validate as isUuid } from "uuid";

router.post(
  "/:interviewerId/assign/:interviewId",
  requireAdmin,
  async (req, res, next) => {
    try {
      const { interviewerId, interviewId } = req.params;
      if (!isUuid(interviewerId) || !isUuid(interviewId)) {
        return res
          .status(400)
          .render("error", { message: "Invalid interviewer or interview ID." });
      }

      // Check if this interviewer email is also a candidate for this interview
      const interviewerRow = await query(
        "SELECT email FROM interviewers WHERE id = $1",
        [interviewerId],
      );
      if (!interviewerRow.rows.length) {
        return res
          .status(404)
          .render("error", { message: "Interviewer not found." });
      }
      const interviewerEmail = interviewerRow.rows[0].email;
      const candidateRow = await query(
        "SELECT 1 FROM candidates WHERE interview_id = $1 AND email = $2",
        [interviewId, interviewerEmail],
      );
      if (candidateRow.rows.length) {
        return res
          .status(409)
          .render("error", {
            message:
              "This interviewer is already a candidate for this interview and cannot be assigned as interviewer.",
          });
      }

      await query(
        "INSERT INTO interview_interviewers (interview_id, interviewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [interviewId, interviewerId],
      );
      res.redirect(`/admin/interviews/${interviewId}`);
    } catch (err) {
      // Show a user-friendly error page
      res.status(500).render("error", { message: err.message });
    }
  },
);

router.post(
  "/:interviewerId/unassign/:interviewId",
  requireAdmin,
  async (req, res, next) => {
    try {
      await query(
        "DELETE FROM interview_interviewers WHERE interview_id = $1 AND interviewer_id = $2",
        [req.params.interviewId, req.params.interviewerId],
      );
      res.redirect(`/admin/interviews/${req.params.interviewId}`);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin: manually trigger scheduling for a candidate ───────────────────
router.post("/schedule/:candidateId", requireAdmin, async (req, res, next) => {
  try {
    const { candidateId } = req.params;
    const cRow = await query(
      "SELECT interview_id FROM candidates WHERE thread_id = $1",
      [candidateId],
    );
    if (!cRow.rows.length) return res.status(404).send("Candidate not found");

    const result = await scheduleCandidate(
      candidateId,
      cRow.rows[0].interview_id,
    );
    if (!result.scheduled) {
      return res
        .status(409)
        .send("No available slots found for any assigned interviewer");
    }
    res.redirect(`/admin/interviews/${cRow.rows[0].interview_id}`);
  } catch (err) {
    next(err);
  }
});

export default router;
