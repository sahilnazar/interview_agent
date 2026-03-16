/**
 * Scheduling Agent
 * ─────────────────
 * 1. Finds overlapping available slots between all assigned interviewers
 *    for a given interview/candidate.
 * 2. Picks the top N best slots using Groq LLM (optional — falls back to
 *    chronological order if LLM unavailable).
 * 3. Creates scheduled_interviews rows (status = pending_candidate) and
 *    sends candidate an email with multiple slot options.
 * 4. Once the candidate picks a slot → sends interviewer a confirmation
 *    request email.
 * 5. Once interviewer confirms → sends both parties a final confirmed email.
 */

import crypto from "node:crypto";
import { query } from "../config/db.js";
import { sendEmail } from "./email.js";
import { callWithRetry, getGroqModel } from "../graph/helpers.js";
import { HumanMessage } from "@langchain/core/messages";
import { PORT } from "../config/env.js";

const BASE_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// ─── Utility ──────────────────────────────────────────────────────────────

function fmt(date) {
  return new Date(date).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

// ─── Core scheduling ──────────────────────────────────────────────────────

/**
 * Find up to `limit` available slots across ALL assigned interviewers for an
 * interview. If there is more than one interviewer, returns only slots where
 * at least one of them is available (one-on-one scheduling).
 */
export async function findAvailableSlots(interviewId, candidateId, limit = 5) {
  // Get all interviewers assigned to this interview
  const intAssign = await query(
    `SELECT i.id, i.name, i.email
     FROM interview_interviewers ii
     JOIN interviewers i ON i.id = ii.interviewer_id
     WHERE ii.interview_id = $1`,
    [interviewId]
  );

  if (!intAssign.rows.length) return [];

  const interviewerIds = intAssign.rows.map((r) => r.id);

  // Get available (not booked/blocked) future slots
  const slotsResult = await query(
    `SELECT s.*, i.name AS interviewer_name, i.email AS interviewer_email
     FROM interviewer_slots s
     JOIN interviewers i ON i.id = s.interviewer_id
     WHERE s.interviewer_id = ANY($1::uuid[])
       AND s.status = 'available'
       AND s.slot_start > NOW()
       AND NOT EXISTS (
         SELECT 1 FROM scheduled_interviews si
         WHERE si.slot_id = s.id
           AND si.status NOT IN ('rejected_interviewer', 'rejected_candidate', 'cancelled')
       )
     ORDER BY s.slot_start
     LIMIT $2`,
    [interviewerIds, limit * 4] // fetch extra, LLM will shortlist
  );

  if (!slotsResult.rows.length) return [];

  // If only a few slots, just return them
  if (slotsResult.rows.length <= limit) return slotsResult.rows;

  // LLM-rank: ask Groq to pick the best N spread-out slots
  try {
    const model = getGroqModel();
    const slotList = slotsResult.rows
      .map((s, i) => `${i + 1}. ${fmt(s.slot_start)} – ${fmt(s.slot_end)} (${s.interviewer_name})`)
      .join("\n");

    const prompt = `You are a scheduling assistant. Pick the ${limit} best interview slots from the list below.
Prefer: variety across different days/times, business hours, reasonable spread.
Return ONLY the 1-based indices as JSON array, e.g. [1,3,5].

Slots:
${slotList}`;

    const res = await callWithRetry(() => model.invoke([new HumanMessage(prompt)]));
    const raw = String(res.content).match(/\[[\d,\s]+\]/)?.[0];
    if (raw) {
      const indices = JSON.parse(raw).map((n) => n - 1).filter((n) => n >= 0 && n < slotsResult.rows.length);
      if (indices.length) return indices.map((i) => slotsResult.rows[i]).slice(0, limit);
    }
  } catch {
    // fall through to chronological
  }

  return slotsResult.rows.slice(0, limit);
}

/**
 * Full scheduling flow:
 * 1. Find slots
 * 2. Create pending scheduled_interview rows
 * 3. Email candidate with slot choices
 */
export async function scheduleCandidate(candidateId, interviewId) {
  const candidateResult = await query(
    "SELECT * FROM candidates WHERE thread_id = $1",
    [candidateId]
  );
  if (!candidateResult.rows.length) throw new Error("Candidate not found");
  const candidate = candidateResult.rows[0];

  const slots = await findAvailableSlots(interviewId, candidateId, 5);
  if (!slots.length) {
    console.warn(`scheduleCandidate: No available slots for interview ${interviewId}`);
    return { scheduled: false, reason: "no_slots" };
  }

  // Create one pending row per slot option
  const created = [];
  for (const slot of slots) {
    const candidateToken = generateToken();
    const interviewerToken = generateToken();

    const ins = await query(
      `INSERT INTO scheduled_interviews
         (candidate_id, interviewer_id, slot_id, slot_start, slot_end,
          status, candidate_token, interviewer_token)
       VALUES ($1, $2, $3, $4, $5, 'pending_candidate', $6, $7)
       RETURNING id`,
      [
        candidateId,
        slot.interviewer_id,
        slot.id,
        slot.slot_start,
        slot.slot_end,
        candidateToken,
        interviewerToken,
      ]
    );
    created.push({
      ...ins.rows[0],
      candidateToken,
      slot_start: slot.slot_start,
      slot_end: slot.slot_end,
      interviewer_name: slot.interviewer_name,
    });
  }

  // Email the candidate the slot options
  await sendCandidateSlotEmail(candidate.email, candidateId, created);

  return { scheduled: true, slotCount: created.length };
}

// ─── Email helpers ────────────────────────────────────────────────────────

export async function sendCandidateSlotEmail(email, candidateId, slots) {
  const slotOptions = slots
    .map(
      (s, i) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #1e293b;font-size:14px">
        ${fmt(s.slot_start)} – ${fmt(s.slot_end)}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #1e293b;text-align:right">
        <a href="${BASE_URL}/candidate/schedule/accept/${s.candidateToken}"
           style="background:#4f6ef7;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px">
          Choose this slot
        </a>
      </td>
    </tr>`
    )
    .join("");

  await sendEmail(
    email,
    "Interview Scheduling — Please Choose a Time Slot",
    `<div style="font-family:sans-serif;max-width:640px">
      <h2>Please choose an interview slot</h2>
      <p>Great news! We'd like to schedule your interview. Please pick a time that works for you:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#0f0f1a;border-radius:8px;overflow:hidden">
        ${slotOptions}
      </table>
      <p style="color:#94a3b8;font-size:12px">
        If none of these times work, please contact us and we'll find an alternative.
      </p>
    </div>`
  );
}

export async function sendInterviewerConfirmationRequest(scheduledId) {
  const result = await query(
    `SELECT si.*, i.name AS iname, i.email AS iemail, c.email AS cemail
     FROM scheduled_interviews si
     JOIN interviewers i ON i.id = si.interviewer_id
     JOIN candidates c ON c.thread_id = si.candidate_id
     WHERE si.id = $1`,
    [scheduledId]
  );
  if (!result.rows.length) return;
  const si = result.rows[0];

  const confirmUrl = `${BASE_URL}/interviewer/confirm/${si.interviewer_token}`;
  const rejectUrl = `${BASE_URL}/interviewer/confirm/${si.interviewer_token}?decision=reject`;

  await sendEmail(
    si.iemail,
    "Interview Scheduled — Please Confirm Your Availability",
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Interview Confirmation Request</h2>
      <p>Hi ${si.iname},</p>
      <p>A candidate has selected the following interview slot:</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 16px 6px 0;color:#888">Candidate:</td><td><strong>${si.cemail}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#888">When:</td><td><strong>${fmt(si.slot_start)} – ${fmt(si.slot_end)}</strong></td></tr>
      </table>
      <p>Please confirm or decline:</p>
      <div style="display:flex;gap:12px;margin:20px 0">
        <a href="${confirmUrl}?decision=confirm"
           style="background:#22c55e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">
          ✓ Confirm
        </a>
        <a href="${confirmUrl}?decision=reject"
           style="background:#ef4444;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-left:12px">
          ✗ Decline
        </a>
      </div>
      <p style="color:#94a3b8;font-size:12px">
        Or visit: <a href="${confirmUrl}" style="color:#4f6ef7">${confirmUrl}</a>
      </p>
    </div>`
  );
}

export async function sendScheduleConfirmedEmails(scheduledId) {
  const result = await query(
    `SELECT si.*, i.name AS iname, i.email AS iemail, c.email AS cemail
     FROM scheduled_interviews si
     JOIN interviewers i ON i.id = si.interviewer_id
     JOIN candidates c ON c.thread_id = si.candidate_id
     WHERE si.id = $1`,
    [scheduledId]
  );
  if (!result.rows.length) return;
  const si = result.rows[0];

  const body = (name) => `
    <div style="font-family:sans-serif;max-width:600px">
      <h2>Interview Confirmed ✓</h2>
      <p>Hi ${name},</p>
      <p>Your interview has been confirmed.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 16px 6px 0;color:#888">When:</td>
            <td><strong>${fmt(si.slot_start)} – ${fmt(si.slot_end)}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#888">Interviewer:</td>
            <td><strong>${si.iname}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#888">Candidate:</td>
            <td><strong>${si.cemail}</strong></td></tr>
        ${si.meet_link ? `<tr><td style="padding:6px 16px 6px 0;color:#888">Meet Link:</td>
            <td><a href="${si.meet_link}" style="color:#4f6ef7">${si.meet_link}</a></td></tr>` : ""}
      </table>
      <p style="color:#94a3b8;font-size:12px">Please add this to your calendar.</p>
    </div>`;

  await sendEmail(si.cemail, "Your Interview is Confirmed!", body("there"));
  await sendEmail(si.iemail, "Interview Confirmed — Calendar Update", body(si.iname));

  // Mark candidate as scheduled
  await query(
    "UPDATE candidates SET status = 'Scheduled', scheduled_interview_id = $1 WHERE thread_id = $2",
    [scheduledId, si.candidate_id]
  );
}

export async function sendScheduleRejectedEmail(scheduledId, rejectedBy) {
  const result = await query(
    `SELECT si.*, i.name AS iname, i.email AS iemail, c.email AS cemail
     FROM scheduled_interviews si
     JOIN interviewers i ON i.id = si.interviewer_id
     JOIN candidates c ON c.thread_id = si.candidate_id
     WHERE si.id = $1`,
    [scheduledId]
  );
  if (!result.rows.length) return;
  const si = result.rows[0];

  if (rejectedBy === "interviewer") {
    // Notify candidate to pick again
    await sendEmail(
      si.cemail,
      "Interview Slot Unavailable — Please Choose Another",
      `<div style="font-family:sans-serif;max-width:600px">
        <h2>Slot no longer available</h2>
        <p>Unfortunately the interviewer is no longer available for your chosen slot.</p>
        <p>Please check your email for a new set of time options, or contact us directly.</p>
      </div>`
    );
  } else {
    // Notify candidate their declined slot
    await sendEmail(
      si.cemail,
      "Interview Slot Update",
      `<div style="font-family:sans-serif;max-width:600px">
        <h2>Interview Slot Declined</h2>
        <p>Your selected interview slot has been declined. We will be in touch with alternative options.</p>
      </div>`
    );
  }
}
