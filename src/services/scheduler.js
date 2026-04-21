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
import { sendEmail, sendSelectionEmail, sendNotSelectedEmail, sendHrApprovalRequestNotification } from "./email.js";
import { callWithRetry, getGroqModel } from "../graph/helpers.js";
import { HumanMessage } from "@langchain/core/messages";
import { PORT } from "../config/env.js";

const BASE_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const AUTO_SCHEDULE_INTERVAL_MS = parseInt(process.env.AUTO_SCHEDULE_INTERVAL_MS || "180000", 10);
let autoScheduleTimer = null;
let autoScheduleRunning = false;

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

function normalizeSkillText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9+#.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSkillList(value = "") {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSkillText(item))
      .filter(Boolean);
  }
  return String(value)
    .split(/[\n,;/|]/)
    .map((item) => normalizeSkillText(item))
    .filter(Boolean);
}

function toUnique(list = []) {
  return [...new Set(list.filter(Boolean))];
}

const INTERVIEWER_MATCH_THRESHOLD = 60;

export async function suggestInterviewersForCandidate(candidateId, interviewId, limit = 5) {
  const slots = await findAvailableSlots(interviewId, candidateId, limit * 3);
  if (!slots.length) return [];

  const unique = new Map();
  for (const slot of slots) {
    if (!unique.has(slot.interviewer_id)) {
      unique.set(slot.interviewer_id, {
        interviewer_id: slot.interviewer_id,
        interviewer_name: slot.interviewer_name,
        interviewer_email: slot.interviewer_email,
        interviewer_match_percent: slot.interviewer_match_percent || 0,
        slot_start: slot.slot_start,
        slot_end: slot.slot_end,
      });
    }
  }

  const suggestions = Array.from(unique.values())
    .sort((a, b) => b.interviewer_match_percent - a.interviewer_match_percent)
    .slice(0, limit);

  if (!suggestions.length) return [];

  const interviewerRows = await query(
    "SELECT id, name, email, department, skills FROM interviewers WHERE id = ANY($1::uuid[])",
    [suggestions.map((item) => item.interviewer_id)],
  );
  const interviewerMap = new Map(interviewerRows.rows.map((row) => [row.id, row]));

  return suggestions.map((item) => {
    const metadata = interviewerMap.get(item.interviewer_id) || {};
    return {
      ...item,
      department: metadata.department || "",
      skills: parseSkillList(metadata.skills || ""),
    };
  });
}

export async function createInterviewerAssignmentRequest(candidateId, interviewId, suggestions, reason) {
  const result = await query(
    `INSERT INTO interviewer_assignment_requests
       (candidate_id, interview_id, status, reason, suggested_interviewers, created_at, updated_at)
     VALUES ($1, $2, 'pending', $3, $4::jsonb, NOW(), NOW())
     RETURNING id`,
    [candidateId, interviewId, reason, JSON.stringify(suggestions)],
  );

  const requestId = result.rows[0].id;
  await sendHrApprovalRequestNotification(interviewId, candidateId, requestId, suggestions, reason);
  return requestId;
}

export async function getHrAssignmentRequests() {
  const res = await query(
    `SELECT r.*, c.email AS candidate_email, i.title AS interview_title
     FROM interviewer_assignment_requests r
     JOIN candidates c ON c.thread_id = r.candidate_id
     JOIN interviews i ON i.id = r.interview_id
     ORDER BY r.created_at DESC`,
  );
  return res.rows;
}

export async function getPendingHrRequestCount() {
  const res = await query("SELECT COUNT(*) AS count FROM interviewer_assignment_requests WHERE status = 'pending'");
  return parseInt(res.rows[0].count, 10);
}

export async function getPendingHrRequestCountForInterview(interviewId) {
  const res = await query(
    "SELECT COUNT(*) AS count FROM interviewer_assignment_requests WHERE interview_id = $1 AND status = 'pending'",
    [interviewId],
  );
  return parseInt(res.rows[0].count, 10);
}

export async function getHrAssignmentRequest(requestId) {
  const res = await query(
    `SELECT r.*, c.email AS candidate_email, i.title AS interview_title
     FROM interviewer_assignment_requests r
     JOIN candidates c ON c.thread_id = r.candidate_id
     JOIN interviews i ON i.id = r.interview_id
     WHERE r.id = $1`,
    [requestId],
  );
  if (!res.rows.length) return null;
  return res.rows[0];
}

export async function approveInterviewerAssignmentRequest(requestId, interviewerId, notes = "") {
  const request = await getHrAssignmentRequest(requestId);
  if (!request) throw new Error("Request not found");
  if (request.status !== "pending") throw new Error("Request is no longer pending");

  const suggestions = Array.isArray(request.suggested_interviewers)
    ? request.suggested_interviewers
    : [];
  const chosen = suggestions.find((item) => item.interviewer_id === interviewerId);
  if (!chosen) throw new Error("Selected interviewer is not part of this request");

  const slotResult = await query(
    `SELECT s.*
     FROM interviewer_slots s
     WHERE s.interviewer_id = $1
       AND s.status = 'available'
       AND s.slot_start > NOW()
       AND NOT EXISTS (
         SELECT 1 FROM scheduled_interviews si
         WHERE si.slot_id = s.id
           AND si.status NOT IN ('rejected_interviewer', 'rejected_candidate', 'cancelled')
       )
     ORDER BY s.slot_start
     LIMIT 1`,
    [interviewerId],
  );
  if (!slotResult.rows.length) throw new Error("No available slot found for selected interviewer");
  const slot = slotResult.rows[0];

  await query(
    "INSERT INTO interview_interviewers (interview_id, interviewer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [request.interview_id, interviewerId],
  );

  const candidateToken = generateToken();
  const interviewerToken = generateToken();

  const scheduled = await query(
    `INSERT INTO scheduled_interviews
       (candidate_id, interviewer_id, slot_id, slot_start, slot_end,
        status, candidate_token, interviewer_token, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending_candidate', $6, $7, NOW())
     RETURNING id`,
    [request.candidate_id, interviewerId, slot.id, slot.slot_start, slot.slot_end, candidateToken, interviewerToken],
  );

  await query("UPDATE interviewer_slots SET status = 'booked' WHERE id = $1", [slot.id]);
  await query(
    `UPDATE interviewer_assignment_requests
     SET status = 'approved', selected_interviewer_id = $1, approval_notes = $2, updated_at = NOW()
     WHERE id = $3`,
    [interviewerId, notes, requestId],
  );

  await sendCandidateSlotEmail(request.candidate_email, request.candidate_id, [
    {
      ...scheduled.rows[0],
      candidateToken,
      slot_start: slot.slot_start,
      slot_end: slot.slot_end,
      interviewer_name: chosen.interviewer_name,
    },
  ]);

  return scheduled.rows[0];
}

export async function rejectInterviewerAssignmentRequest(requestId, notes = "Rejected by HR") {
  const request = await getHrAssignmentRequest(requestId);
  if (!request) throw new Error("Request not found");
  if (request.status !== "pending") throw new Error("Request is no longer pending");

  await query(
    `UPDATE interviewer_assignment_requests
     SET status = 'rejected', approval_notes = $1, updated_at = NOW()
     WHERE id = $2`,
    [notes, requestId],
  );
  return true;
}

function computeInterviewerMatchPercent(interviewerSkills = [], jobSkills = [], candidateSkills = []) {
  const iSkills = toUnique(interviewerSkills);
  if (!iSkills.length) return 0;

  const jSkills = toUnique(jobSkills);
  const cSkills = toUnique(candidateSkills);

  const jobMatched = jSkills.length
    ? jSkills.filter((skill) => iSkills.includes(skill)).length / jSkills.length
    : 0;

  const candidateMatched = cSkills.length
    ? cSkills.filter((skill) => iSkills.includes(skill)).length / cSkills.length
    : 0;

  if (jSkills.length && cSkills.length) {
    return Math.round(((jobMatched + candidateMatched) / 2) * 100);
  }
  if (jSkills.length) return Math.round(jobMatched * 100);
  if (cSkills.length) return Math.round(candidateMatched * 100);
  return 0;
}

// ─── Core scheduling ──────────────────────────────────────────────────────

/**
 * Find up to `limit` available slots across ALL assigned interviewers for an
 * interview. If there is more than one interviewer, returns only slots where
 * at least one of them is available (one-on-one scheduling).
 */
export async function findAvailableSlots(interviewId, candidateId, limit = 5) {
  const contextResult = await query(
    `SELECT c.skills AS candidate_skills, i.required_skills, i.jd
     FROM candidates c
     JOIN interviews i ON i.id = c.interview_id
     WHERE c.thread_id = $1
     LIMIT 1`,
    [candidateId],
  );

  const context = contextResult.rows[0] || {};
  const candidateSkillsRaw = Array.isArray(context.candidate_skills)
    ? context.candidate_skills
    : [];
  const candidateSkills = parseSkillList(candidateSkillsRaw);
  const jobSkills = toUnique([
    ...parseSkillList(context.required_skills || ""),
    ...parseSkillList(context.jd || ""),
  ]);

  // Get all interviewers who have at least one future available slot.
  // Skill matching now drives priority instead of fixed interview assignment.
  const availableInterviewers = await query(
    `SELECT DISTINCT i.id, i.name, i.email, i.skills
     FROM interviewers i
     JOIN interviewer_slots s ON s.interviewer_id = i.id
     WHERE s.status = 'available'
       AND s.slot_start > NOW()`
  );

  if (!availableInterviewers.rows.length) return [];

  const scoreByInterviewer = new Map(
    availableInterviewers.rows.map((r) => {
      const interviewerSkills = parseSkillList(r.skills || "");
      const matchPercent = computeInterviewerMatchPercent(
        interviewerSkills,
        jobSkills,
        candidateSkills,
      );
      return [r.id, matchPercent];
    }),
  );

  const interviewerIds = availableInterviewers.rows.map((r) => r.id);

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
    [interviewerIds, limit * 4], // fetch extra, LLM will shortlist
  );

  if (!slotsResult.rows.length) return [];

  // First priority: skill match > 50%. Second priority: everyone else.
  // If no first-priority slots are currently available, fall back to any available interviewer.
  const rankedSlots = slotsResult.rows.map((slot) => {
    const matchPercent = scoreByInterviewer.get(slot.interviewer_id) || 0;
    return {
      ...slot,
      interviewer_match_percent: matchPercent,
      interviewer_priority: matchPercent > 50 ? 1 : 2,
    };
  });

  const firstPrioritySlots = rankedSlots
    .filter((slot) => slot.interviewer_priority === 1)
    .sort((a, b) => new Date(a.slot_start) - new Date(b.slot_start));

  const secondPrioritySlots = rankedSlots
    .filter((slot) => slot.interviewer_priority === 2)
    .sort((a, b) => new Date(a.slot_start) - new Date(b.slot_start));

  const prioritizedSlots = firstPrioritySlots.length
    ? [...firstPrioritySlots, ...secondPrioritySlots]
    : rankedSlots.sort((a, b) => new Date(a.slot_start) - new Date(b.slot_start));

  // If only a few slots, just return them
  if (prioritizedSlots.length <= limit) return prioritizedSlots;

  // With single-slot scheduling, deterministic priority ordering is preferred over LLM ranking.
  if (limit === 1) return prioritizedSlots.slice(0, limit);

  // LLM-rank: ask Groq to pick the best N spread-out slots
  try {
    const model = getGroqModel();
    const slotList = prioritizedSlots
      .map(
        (s, i) =>
          `${i + 1}. ${fmt(s.slot_start)} – ${fmt(s.slot_end)} (${s.interviewer_name})`,
      )
      .join("\n");

    const prompt = `You are a scheduling assistant. Pick the ${limit} best interview slots from the list below.
Prefer: variety across different days/times, business hours, reasonable spread.
Return ONLY the 1-based indices as JSON array, e.g. [1,3,5].

Slots:
${slotList}`;

    const res = await callWithRetry(() =>
      model.invoke([new HumanMessage(prompt)]),
    );
    const raw = String(res.content).match(/\[[\d,\s]+\]/)?.[0];
    if (raw) {
      const indices = JSON.parse(raw)
        .map((n) => n - 1)
        .filter((n) => n >= 0 && n < prioritizedSlots.length);
      if (indices.length)
        return indices.map((i) => prioritizedSlots[i]).slice(0, limit);
    }
  } catch {
    // fall through to chronological
  }

  return prioritizedSlots.slice(0, limit);
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
    [candidateId],
  );
  if (!candidateResult.rows.length) throw new Error("Candidate not found");
  const candidate = candidateResult.rows[0];

  const slots = await findAvailableSlots(interviewId, candidateId, 1);
  if (!slots.length) {
    console.warn(
      `scheduleCandidate: No available slots for interview ${interviewId}`,
    );
    return { scheduled: false, reason: "no_slots" };
  }

  // Create one pending row for the single next available slot
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
      ],
    );

    if (slot.id) {
      await query(
        "UPDATE interviewer_slots SET status = 'booked' WHERE id = $1",
        [slot.id],
      );
    }

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

/**
 * Fully automated scheduling for passed candidates:
 * - interviewer must be assigned to the interview
 * - slot must be available
 * - first suitable slot is auto-confirmed
 * - candidate + interviewer get confirmation emails with meet link and slot
 */
export async function autoAssignAndConfirmCandidate(candidateId, interviewId) {
  const existing = await query(
    `SELECT si.id
     FROM scheduled_interviews si
     WHERE si.candidate_id = $1
       AND si.status NOT IN ('rejected_interviewer', 'rejected_candidate', 'cancelled')
     ORDER BY si.created_at DESC
     LIMIT 1`,
    [candidateId],
  );
  if (existing.rows.length) {
    return { scheduled: true, alreadyScheduled: true, scheduledId: existing.rows[0].id };
  }

  const candidateResult = await query(
    "SELECT email FROM candidates WHERE thread_id = $1",
    [candidateId],
  );
  if (!candidateResult.rows.length) throw new Error("Candidate not found");

  // Apply the same HR gate used by manual scheduling.
  const suggestions = await suggestInterviewersForCandidate(candidateId, interviewId, 5);
  const topMatch = suggestions[0]?.interviewer_match_percent || 0;
  if (suggestions.length > 0 && topMatch < INTERVIEWER_MATCH_THRESHOLD) {
    const pendingRequest = await query(
      `SELECT id
       FROM interviewer_assignment_requests
       WHERE candidate_id = $1
         AND interview_id = $2
         AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [candidateId, interviewId],
    );

    if (!pendingRequest.rows.length) {
      const reason = `Low-skill match (${topMatch.toFixed(0)}%) — HR review required`;
      const requestId = await createInterviewerAssignmentRequest(
        candidateId,
        interviewId,
        suggestions,
        reason,
      );
      return { scheduled: false, reason: "hr_review_required", requestId };
    }

    return {
      scheduled: false,
      reason: "hr_review_pending",
      requestId: pendingRequest.rows[0].id,
    };
  }

  const slots = await findAvailableSlots(interviewId, candidateId, 1);
  if (!slots.length) {
    return { scheduled: false, reason: "no_slots" };
  }

  const slot = slots[0];
  const candidateToken = generateToken();
  const interviewerToken = generateToken();
  const meetLink = "https://meet.google.com/new";

  const ins = await query(
    `INSERT INTO scheduled_interviews
       (candidate_id, interviewer_id, slot_id, slot_start, slot_end,
        status, candidate_token, interviewer_token, meet_link)
     VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8)
     RETURNING id`,
    [
      candidateId,
      slot.interviewer_id,
      slot.id,
      slot.slot_start,
      slot.slot_end,
      candidateToken,
      interviewerToken,
      meetLink,
    ],
  );

  await query(
    "UPDATE interviewer_slots SET status = 'booked' WHERE id = $1",
    [slot.id],
  );

  await sendScheduleConfirmedEmails(ins.rows[0].id);

  return {
    scheduled: true,
    scheduledId: ins.rows[0].id,
    interviewerId: slot.interviewer_id,
    slotStart: slot.slot_start,
    slotEnd: slot.slot_end,
  };
}

async function runAutoScheduleTick() {
  if (autoScheduleRunning) return;
  autoScheduleRunning = true;
  try {
    const pending = await query(
      `SELECT thread_id, interview_id
       FROM candidates
       WHERE status = 'Done'
         AND interview_id IS NOT NULL
         AND scheduled_interview_id IS NULL
       ORDER BY created_at ASC
       LIMIT 50`,
    );

    for (const candidate of pending.rows) {
      try {
        const result = await autoAssignAndConfirmCandidate(
          candidate.thread_id,
          candidate.interview_id,
        );
        if (result?.scheduled && !result?.alreadyScheduled) {
          console.log(
            `[AutoSchedule] Candidate ${candidate.thread_id} auto-assigned (scheduledId=${result.scheduledId})`,
          );
        }
      } catch (err) {
        console.error(
          `[AutoSchedule] Failed for ${candidate.thread_id}:`,
          err.message || err,
        );
      }
    }
  } finally {
    autoScheduleRunning = false;
  }
}

export function startAutoSchedulePassedCandidates(intervalMs = AUTO_SCHEDULE_INTERVAL_MS) {
  if (autoScheduleTimer) return autoScheduleTimer;

  // Initial run at startup so newly passed candidates are picked quickly.
  runAutoScheduleTick().catch((err) => {
    console.error("[AutoSchedule] Initial tick failed:", err.message || err);
  });

  autoScheduleTimer = setInterval(() => {
    runAutoScheduleTick().catch((err) => {
      console.error("[AutoSchedule] Tick failed:", err.message || err);
    });
  }, intervalMs);

  console.log(`[AutoSchedule] Worker started (interval=${intervalMs}ms)`);
  return autoScheduleTimer;
}

async function getBulkMailSettings() {
  const rows = await query(
    "SELECT key, value FROM settings WHERE key IN ('bulk_mail_enabled', 'bulk_mail_send_time', 'bulk_mail_last_sent')"
  );
  const settings = {};
  for (const row of rows.rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function shouldRunBulkMail(settings) {
  if (settings.bulk_mail_enabled !== 'true') return false;
  const timeValue = settings.bulk_mail_send_time || '18:00';
  const [hour, minute] = timeValue.split(':').map((value) => parseInt(value, 10));
  if (Number.isNaN(hour) || Number.isNaN(minute)) return false;

  const now = new Date();
  const todayTarget = new Date(now);
  todayTarget.setHours(hour, minute, 0, 0);

  if (now < todayTarget) return false;
  const lastSent = settings.bulk_mail_last_sent || '';
  return lastSent !== formatDateKey(todayTarget);
}

export async function sendBulkOutcomeEmails(interviewId = null) {
  const passParams = [];
  const failParams = [];
  let passQuery = "SELECT thread_id, email FROM candidates WHERE final_result = 'pass' AND selected_email_sent = FALSE";
  let failQuery = "SELECT thread_id, email FROM candidates WHERE final_result = 'fail' AND not_selected_email_sent = FALSE";

  if (interviewId) {
    passQuery += " AND interview_id = $1";
    failQuery += " AND interview_id = $1";
    passParams.push(interviewId);
    failParams.push(interviewId);
  }

  const passResult = await query(passQuery, passParams);
  const failResult = await query(failQuery, failParams);

  let passSent = 0;
  let failSent = 0;

  for (const row of passResult.rows) {
    try {
      await sendSelectionEmail(row.email);
      await query("UPDATE candidates SET selected_email_sent = TRUE WHERE thread_id = $1", [row.thread_id]);
      passSent += 1;
    } catch (err) {
      console.error(`Failed to send selected email to ${row.email}:`, err.message || err);
    }
  }

  for (const row of failResult.rows) {
    try {
      await sendNotSelectedEmail(row.email);
      await query("UPDATE candidates SET not_selected_email_sent = TRUE WHERE thread_id = $1", [row.thread_id]);
      failSent += 1;
    } catch (err) {
      console.error(`Failed to send not-selected email to ${row.email}:`, err.message || err);
    }
  }

  return { passSent, failSent, passTotal: passResult.rows.length, failTotal: failResult.rows.length };
}

export async function sendBulkOutcomeEmailsIfDue() {
  const settings = await getBulkMailSettings();
  if (!shouldRunBulkMail(settings)) {
    return { ran: false };
  }

  const result = await sendBulkOutcomeEmails();
  const todayKey = formatDateKey(new Date());
  await query(
    "INSERT INTO settings (key, value) VALUES ('bulk_mail_last_sent', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [todayKey]
  );

  console.log(`[BulkMail] Sent pass=${result.passSent}/${result.passTotal}, fail=${result.failSent}/${result.failTotal} at ${todayKey}`);
  return { ran: true, ...result };
}

let bulkMailTimer = null;
export function startBulkOutcomeEmailWorker(intervalMs = 60000) {
  if (bulkMailTimer) return bulkMailTimer;

  sendBulkOutcomeEmailsIfDue().catch((err) => {
    console.error('[BulkMail] Initial run failed:', err.message || err);
  });

  bulkMailTimer = setInterval(() => {
    sendBulkOutcomeEmailsIfDue().catch((err) => {
      console.error('[BulkMail] Tick failed:', err.message || err);
    });
  }, intervalMs);

  console.log(`[BulkMail] Worker started (interval=${intervalMs}ms)`);
  return bulkMailTimer;
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
          Confirm slot
        </a>
      </td>
    </tr>`,
    )
    .join("");

  await sendEmail(
    email,
    "Interview Scheduling — Your Interview Slot",
    `<div style="font-family:sans-serif;max-width:640px">
      <h2>Your interview slot is ready</h2>
      <p>Great news! We've reserved the next available slot for your interview:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#0f0f1a;border-radius:8px;overflow:hidden">
        ${slotOptions}
      </table>
      <p style="color:#94a3b8;font-size:12px">
        Click the button above to confirm this slot. If you have any issues, please contact us.
      </p>
    </div>`,
  );
}

export async function sendInterviewerConfirmationRequest(scheduledId) {
  const result = await query(
    `SELECT si.*, i.name AS iname, i.email AS iemail, c.email AS cemail
     FROM scheduled_interviews si
     JOIN interviewers i ON i.id = si.interviewer_id
     JOIN candidates c ON c.thread_id = si.candidate_id
     WHERE si.id = $1`,
    [scheduledId],
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
    </div>`,
  );
}

export async function sendScheduleConfirmedEmails(scheduledId) {
  const result = await query(
    `SELECT si.*, i.name AS iname, i.email AS iemail, c.email AS cemail
     FROM scheduled_interviews si
     JOIN interviewers i ON i.id = si.interviewer_id
     JOIN candidates c ON c.thread_id = si.candidate_id
     WHERE si.id = $1`,
    [scheduledId],
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
        ${
          si.meet_link
            ? `<tr><td style="padding:6px 16px 6px 0;color:#888">Meet Link:</td>
            <td><a href="${si.meet_link}" style="color:#4f6ef7">${si.meet_link}</a></td></tr>`
            : ""
        }
      </table>
      <p style="margin-top:8px">Please ensure you attend the interview on time.</p>
      <p style="color:#94a3b8;font-size:12px">Please add this to your calendar.</p>
    </div>`;

  await sendEmail(si.cemail, "Your Interview is Confirmed!", body("there"));
  await sendEmail(
    si.iemail,
    "Interview Confirmed — Calendar Update",
    body(si.iname),
  );

  // Mark candidate as scheduled
  await query(
    "UPDATE candidates SET status = 'Scheduled', scheduled_interview_id = $1 WHERE thread_id = $2",
    [scheduledId, si.candidate_id],
  );
}

export async function sendScheduleRejectedEmail(scheduledId, rejectedBy) {
  const result = await query(
    `SELECT si.*, i.name AS iname, i.email AS iemail, c.email AS cemail
     FROM scheduled_interviews si
     JOIN interviewers i ON i.id = si.interviewer_id
     JOIN candidates c ON c.thread_id = si.candidate_id
     WHERE si.id = $1`,
    [scheduledId],
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
      </div>`,
    );
  } else {
    // Notify candidate their declined slot
    await sendEmail(
      si.cemail,
      "Interview Slot Update",
      `<div style="font-family:sans-serif;max-width:600px">
        <h2>Interview Slot Declined</h2>
        <p>Your selected interview slot has been declined. We will be in touch with alternative options.</p>
      </div>`,
    );
  }
}
