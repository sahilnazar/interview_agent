import { Router } from "express";
import { query } from "../config/db.js";
import { sendInterviewerOTP, verifyInterviewerOTP } from "../services/otp.js";
import { requireInterviewer } from "../middleware/auth.js";

const router = Router();

// ─── GET /interviewer/login ────────────────────────────────────────────────
router.get("/login", (req, res) => {
  if (req.session?.interviewer) return res.redirect("/interviewer/calendar");
  res.render("interviewer-login", { step: "email", error: null, email: "" });
});

// ─── POST /interviewer/login/send-otp ─────────────────────────────────────
router.post("/login/send-otp", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.render("interviewer-login", {
        step: "email",
        error: "Email is required",
        email: "",
      });

    const result = await query("SELECT * FROM interviewers WHERE email = $1", [
      email.trim().toLowerCase(),
    ]);
    if (!result.rows.length) {
      return res.render("interviewer-login", {
        step: "email",
        error: "No interviewer account found for this email",
        email,
      });
    }

    await sendInterviewerOTP(result.rows[0]);
    req.session.otpEmail = email.trim().toLowerCase();
    res.render("interviewer-login", {
      step: "otp",
      error: null,
      email: email.trim().toLowerCase(),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /interviewer/login/verify-otp ───────────────────────────────────
router.post("/login/verify-otp", async (req, res, next) => {
  try {
    const { otp } = req.body;
    const email = req.session.otpEmail;
    if (!email) return res.redirect("/interviewer/login");

    const interviewer = await verifyInterviewerOTP(email, otp?.trim());
    if (!interviewer) {
      return res.render("interviewer-login", {
        step: "otp",
        error: "Invalid or expired OTP",
        email,
      });
    }

    delete req.session.otpEmail;
    req.session.interviewer = {
      id: interviewer.id,
      name: interviewer.name,
      email: interviewer.email,
    };
    res.redirect("/interviewer/calendar");
  } catch (err) {
    next(err);
  }
});

// ─── GET /interviewer/calendar ─────────────────────────────────────────────
router.get("/calendar", requireInterviewer, async (req, res, next) => {
  try {
    const { id, name, email } = req.session.interviewer;

    const slotsResult = await query(
      `SELECT * FROM interviewer_slots
       WHERE interviewer_id = $1 AND slot_start >= NOW() - INTERVAL '1 day'
       ORDER BY slot_start`,
      [id],
    );

    const scheduledResult = await query(
      `SELECT si.*, c.email AS candidate_email, c.status AS candidate_status
       FROM scheduled_interviews si
       JOIN candidates c ON c.thread_id = si.candidate_id
       WHERE si.interviewer_id = $1 AND si.slot_start >= NOW() - INTERVAL '1 day'
       ORDER BY si.slot_start`,
      [id],
    );

    res.render("interviewer-calendar", {
      interviewer: { id, name, email },
      slots: slotsResult.rows,
      scheduled: scheduledResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /interviewer/calendar/slots ─────────────────────────────────────
// Add a single available slot
router.post("/calendar/slots", requireInterviewer, async (req, res, next) => {
  try {
    const { slot_start, slot_end, status } = req.body;
    if (!slot_start || !slot_end) return res.redirect("/interviewer/calendar");

    const start = new Date(slot_start);
    const end = new Date(slot_end);
    if (isNaN(start) || isNaN(end) || end <= start) {
      return res.redirect("/interviewer/calendar");
    }

    const slotStatus = status === "blocked" ? "blocked" : "available";

    await query(
      "INSERT INTO interviewer_slots (interviewer_id, slot_start, slot_end, status) VALUES ($1, $2, $3, $4)",
      [req.session.interviewer.id, start, end, slotStatus],
    );

    res.redirect("/interviewer/calendar");
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /interviewer/calendar/slots/:slotId ──────────────────────────
router.post(
  "/calendar/slots/:slotId/delete",
  requireInterviewer,
  async (req, res, next) => {
    try {
      await query(
        "DELETE FROM interviewer_slots WHERE id = $1 AND interviewer_id = $2 AND status = 'available'",
        [req.params.slotId, req.session.interviewer.id],
      );
      res.redirect("/interviewer/calendar");
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /interviewer/calendar/slots/bulk ────────────────────────────────
// Bulk-add repeating weekly slots
router.post(
  "/calendar/slots/bulk",
  requireInterviewer,
  async (req, res, next) => {
    try {
      const { from_date, to_date, days, slot_time_start, slot_time_end } =
        req.body;
      if (!from_date || !to_date || !slot_time_start || !slot_time_end) {
        return res.redirect("/interviewer/calendar");
      }

      const selectedDays = Array.isArray(days)
        ? days.map(Number)
        : days
          ? [Number(days)]
          : [];
      if (!selectedDays.length) return res.redirect("/interviewer/calendar");

      const cursor = new Date(`${from_date}T00:00:00`);
      const end = new Date(`${to_date}T23:59:59`);
      const values = [];

      while (cursor <= end) {
        if (selectedDays.includes(cursor.getDay())) {
          const start = new Date(
            `${cursor.toISOString().slice(0, 10)}T${slot_time_start}:00`,
          );
          const finish = new Date(
            `${cursor.toISOString().slice(0, 10)}T${slot_time_end}:00`,
          );
          if (finish > start) {
            values.push([
              req.session.interviewer.id,
              start,
              finish,
              "available",
            ]);
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      for (const v of values) {
        await query(
          "INSERT INTO interviewer_slots (interviewer_id, slot_start, slot_end, status) VALUES ($1, $2, $3, $4)",
          v,
        );
      }

      res.redirect("/interviewer/calendar");
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /interviewer/schedule/:id/respond ───────────────────────────────
// Interviewer accepts or declines a scheduled interview
router.post(
  "/schedule/:id/respond",
  requireInterviewer,
  async (req, res, next) => {
    try {
      const { decision } = req.body; // "confirm" | "reject"
      const { id } = req.params;
      const interviewerId = req.session.interviewer.id;

      const result = await query(
        "SELECT * FROM scheduled_interviews WHERE id = $1 AND interviewer_id = $2",
        [id, interviewerId],
      );
      if (!result.rows.length) return res.status(404).send("Not found");

      const si = result.rows[0];
      if (si.status !== "pending_interviewer") {
        return res.redirect("/interviewer/calendar");
      }

      if (decision === "confirm") {
        await query(
          "UPDATE scheduled_interviews SET status = 'confirmed' WHERE id = $1",
          [id],
        );
        // Free the slot so it can't be double-booked
        if (si.slot_id) {
          await query(
            "UPDATE interviewer_slots SET status = 'booked' WHERE id = $1",
            [si.slot_id],
          );
        }
        // Send confirmation emails (handled by scheduling service)
        const { sendScheduleConfirmedEmails } =
          await import("../services/scheduler.js");
        await sendScheduleConfirmedEmails(id);
      } else {
        await query(
          "UPDATE scheduled_interviews SET status = 'rejected_interviewer' WHERE id = $1",
          [id],
        );
        // Unblock slot if it was held
        if (si.slot_id) {
          await query(
            "UPDATE interviewer_slots SET status = 'available' WHERE id = $1",
            [si.slot_id],
          );
        }
        const { sendScheduleRejectedEmail } =
          await import("../services/scheduler.js");
        await sendScheduleRejectedEmail(id, "interviewer");
      }

      res.redirect("/interviewer/calendar");
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /interviewer/confirm/:token ─────────────────────────────────────
// Token-based confirmation link in email (no login required)
router.get("/confirm/:token", async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      "SELECT si.*, i.name AS interviewer_name, i.email AS interviewer_email, c.email AS candidate_email FROM scheduled_interviews si JOIN interviewers i ON i.id = si.interviewer_id JOIN candidates c ON c.thread_id = si.candidate_id WHERE si.interviewer_token = $1",
      [token],
    );
    if (!result.rows.length)
      return res.status(404).send("Link invalid or expired");
    const si = result.rows[0];
    res.render("schedule-respond", {
      si,
      role: "interviewer",
      token,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /interviewer/confirm/:token ────────────────────────────────────
router.post("/confirm/:token", async (req, res, next) => {
  try {
    const { token } = req.params;
    const { decision } = req.body;

    const result = await query(
      "SELECT * FROM scheduled_interviews WHERE interviewer_token = $1",
      [token],
    );
    if (!result.rows.length)
      return res.status(404).send("Link invalid or expired");
    const si = result.rows[0];

    if (!["pending_interviewer", "pending_candidate"].includes(si.status)) {
      return res.render("schedule-respond", {
        si,
        role: "interviewer",
        token,
        error: "This slot has already been responded to.",
      });
    }

    if (decision === "confirm") {
      await query(
        "UPDATE scheduled_interviews SET status = 'confirmed' WHERE id = $1",
        [si.id],
      );
      if (si.slot_id)
        await query(
          "UPDATE interviewer_slots SET status = 'booked' WHERE id = $1",
          [si.slot_id],
        );
      const { sendScheduleConfirmedEmails } =
        await import("../services/scheduler.js");
      await sendScheduleConfirmedEmails(si.id);
    } else {
      await query(
        "UPDATE scheduled_interviews SET status = 'rejected_interviewer' WHERE id = $1",
        [si.id],
      );
      if (si.slot_id)
        await query(
          "UPDATE interviewer_slots SET status = 'available' WHERE id = $1",
          [si.slot_id],
        );
      const { sendScheduleRejectedEmail } =
        await import("../services/scheduler.js");
      await sendScheduleRejectedEmail(si.id, "interviewer");
    }

    res.render("schedule-done", {
      role: "interviewer",
      decision,
      slot_start: si.slot_start,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
