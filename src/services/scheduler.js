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
import { sendEmail, sendSelectionEmail, sendNotSelectedEmail, sendHrApprovalRequestNotification, sendAdminNoShowAlert, sendCandidateVideoReminder } from "./email.js";
import { callWithRetry, getGroqModel } from "../graph/helpers.js";
import { HumanMessage } from "@langchain/core/messages";
import { PORT } from "../config/env.js";
import { createCalendarEventForScheduledInterview } from "./calendar-mcp.js";
import { isMCPAvailable, scheduleCandidateViaMCP, autoAssignAndConfirmViaMCP } from "./mcp.js";

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
        skills: slot.interviewer_skills || "",
        interviewer_match_percent: slot.interviewer_match_percent || 0,
        can_interview: slot.can_interview ?? true,
        ai_match_reason: slot.ai_match_reason || null,
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

async function scoreInterviewersWithAI(interviewers, context) {
  const model = getGroqModel();
  const interviewerList = interviewers
    .map(
      (iv, i) =>
        `${i + 1}. ID: ${iv.id}\n   Name: ${iv.name}\n   Department: ${iv.department || "N/A"}\n   Skills: ${iv.skills || "N/A"}`,
    )
    .join("\n\n");

  const prompt = `You are an expert interviewer-matching agent. Score each interviewer's suitability to conduct an interview for the role below.

Job Description: ${context.jd || "N/A"}
Required Skills: ${context.required_skills || "N/A"}
Candidate Skills: ${context.candidate_skills || "N/A"}
Candidate Video Summary: ${context.video_summary || "N/A"}

Interviewers:
${interviewerList}

For EVERY interviewer return:
- score 0-100: domain fit (100 = perfect match)
- can_interview true/false: has enough knowledge to conduct a meaningful technical interview
- reason: one short sentence

Return ONLY a valid JSON array (no markdown, no explanation):
[{"interviewer_id":"<uuid>","score":<number>,"can_interview":<boolean>,"reason":"<string>"},...]`;

  const res = await callWithRetry(() => model.invoke([new HumanMessage(prompt)]));
  const raw = String(res.content);
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array in AI response");
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("Empty AI result array");
  return parsed;
}

// ─── Core scheduling ──────────────────────────────────────────────────────

/**
 * Find up to `limit` available slots across ALL assigned interviewers for an
 * interview. If there is more than one interviewer, returns only slots where
 * at least one of them is available (one-on-one scheduling).
 */
export async function findAvailableSlots(interviewId, candidateId, limit = 5) {
  const contextResult = await query(
    `SELECT c.skills AS candidate_skills, c.video_summary, i.required_skills, i.jd
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

  // Prefer interview-assigned interviewers first; if none have free slots,
  // fall back to all available interviewers.
  const assignedRows = await query(
    `SELECT interviewer_id
     FROM interview_interviewers
     WHERE interview_id = $1`,
    [interviewId],
  );
  const assignedInterviewerIds = assignedRows.rows.map((row) => row.interviewer_id);

  let availableInterviewers = { rows: [] };
  if (assignedInterviewerIds.length > 0) {
    availableInterviewers = await query(
      `SELECT DISTINCT i.id, i.name, i.email, i.skills, i.department
       FROM interviewers i
       JOIN interviewer_slots s ON s.interviewer_id = i.id
       WHERE i.id = ANY($1::uuid[])
         AND s.status = 'available'
         AND s.slot_start > NOW()`,
      [assignedInterviewerIds],
    );
  }

  if (!availableInterviewers.rows.length) {
    availableInterviewers = await query(
      `SELECT DISTINCT i.id, i.name, i.email, i.skills, i.department
       FROM interviewers i
       JOIN interviewer_slots s ON s.interviewer_id = i.id
       WHERE s.status = 'available'
         AND s.slot_start > NOW()`
    );
  }

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

  // AI scoring — overrides string-match scores when LLM is available
  const aiResultMap = new Map();
  try {
    const aiInterviewers = availableInterviewers.rows.map((r) => ({
      id: r.id,
      name: r.name,
      skills: r.skills || "",
      department: r.department || "",
    }));
    const candidateSkillsText = Array.isArray(context.candidate_skills)
      ? context.candidate_skills.join(", ")
      : (context.candidate_skills || "");
    const aiContext = {
      jd: context.jd || "",
      required_skills: context.required_skills || "",
      candidate_skills: candidateSkillsText,
      video_summary: context.video_summary || "",
    };
    const aiResults = await scoreInterviewersWithAI(aiInterviewers, aiContext);
    for (const result of aiResults) {
      if (result.interviewer_id) {
        aiResultMap.set(result.interviewer_id, result);
        scoreByInterviewer.set(result.interviewer_id, result.score);
      }
    }
    console.log(`[InterviewerMatch] AI scored ${aiResults.length} interviewers for candidate ${candidateId}`);
  } catch (err) {
    console.warn(`[InterviewerMatch] AI scoring failed, using string-match fallback: ${err.message}`);
  }

  const interviewerIds = availableInterviewers.rows.map((r) => r.id);

  // Get available (not booked/blocked) future slots
  const slotsResult = await query(
    `SELECT s.*, i.name AS interviewer_name, i.email AS interviewer_email, i.skills AS interviewer_skills
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
    const aiResult = aiResultMap.get(slot.interviewer_id);
    return {
      ...slot,
      interviewer_match_percent: matchPercent,
      can_interview: aiResult ? aiResult.can_interview : matchPercent > 30,
      ai_match_reason: aiResult?.reason || null,
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
  if (isMCPAvailable()) {
    try {
      const mcpResult = await scheduleCandidateViaMCP({ candidateId, interviewId });
      if (typeof mcpResult?.scheduled === "boolean") {
        return {
          scheduled: mcpResult.scheduled,
          slotCount: mcpResult.slotCount,
          reason: mcpResult.reason,
          alreadyScheduled: mcpResult.alreadyScheduled,
          scheduledId: mcpResult.scheduledId,
        };
      }
    } catch (err) {
      console.warn(`MCP schedule_candidate failed for ${candidateId}, falling back local: ${err.message}`);
    }
  }

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
  if (isMCPAvailable()) {
    try {
      const mcpResult = await autoAssignAndConfirmViaMCP({ candidateId, interviewId });
      if (typeof mcpResult?.scheduled === "boolean") {
        return {
          scheduled: mcpResult.scheduled,
          reason: mcpResult.reason,
          alreadyScheduled: mcpResult.alreadyScheduled,
          scheduledId: mcpResult.scheduledId,
          interviewerId: mcpResult.interviewerId,
          slotStart: mcpResult.slotStart,
          slotEnd: mcpResult.slotEnd,
          requestId: mcpResult.requestId,
        };
      }
    } catch (err) {
      console.warn(`MCP auto_assign_and_confirm_candidate failed for ${candidateId}, falling back local: ${err.message}`);
    }
  }

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

  // Apply required-skill overlap + HR gate used by manual scheduling.
  const suggestions = await suggestInterviewersForCandidate(candidateId, interviewId, 5);
  const topMatch = suggestions[0]?.interviewer_match_percent || 0;
  const interviewSkillsResult = await query(
    "SELECT required_skills FROM interviews WHERE id = $1 LIMIT 1",
    [interviewId],
  );
  const interviewRequiredSkills = parseSkillList(interviewSkillsResult.rows[0]?.required_skills || "");

  // AI-aware check: use can_interview from AI scoring; fall back to string overlap when AI wasn't used
  const aiWasUsed = suggestions.some((s) => s.ai_match_reason !== null);
  const hasAnyCanInterview = aiWasUsed
    ? suggestions.some((s) => s.can_interview === true)
    : interviewRequiredSkills.length === 0
      ? true
      : suggestions.some((item) => {
        const interviewerSkills = parseSkillList(item.skills || []);
        return interviewerSkills.some((skill) => interviewRequiredSkills.includes(skill));
      });

  // AI threshold gate: < 40 → HR review; 40+ → auto-assign
  const AI_HR_THRESHOLD = 40;
  const needsHrReview =
    suggestions.length > 0 &&
    (!hasAnyCanInterview || (aiWasUsed && topMatch < AI_HR_THRESHOLD));

  if (needsHrReview) {
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
      const topReason = suggestions[0]?.ai_match_reason || null;
      const reason = aiWasUsed
        ? `AI match score ${topMatch.toFixed(0)}% — ${topReason || "no suitable interviewer found"} — HR review required`
        : `No interviewer with required skill overlap is currently available — HR review required`;
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

  let slots = await findAvailableSlots(interviewId, candidateId, 3);

  // Prefer slots from interviewers flagged as suitable (AI can_interview or string overlap)
  if (suggestions.length > 0) {
    const qualifiedIds = new Set(
      suggestions
        .filter((item) =>
          aiWasUsed
            ? item.can_interview === true
            : interviewRequiredSkills.length === 0 ||
              parseSkillList(item.skills || []).some((skill) => interviewRequiredSkills.includes(skill)),
        )
        .map((item) => item.interviewer_id),
    );

    if (qualifiedIds.size > 0) {
      const filtered = slots.filter((slot) => qualifiedIds.has(slot.interviewer_id));
      if (filtered.length > 0) slots = filtered;
    }
  }

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

const BUFFER_MINUTES = 30;

function shouldRunBulkMail(settings) {
  if (settings.bulk_mail_enabled !== 'true') {
    console.log('[BulkMail] Skipped: bulk_mail_enabled is not true');
    return false;
  }
  const timeValue = settings.bulk_mail_send_time || '18:00';
  const [hour, minute] = timeValue.split(':').map((value) => parseInt(value, 10));
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    console.log('[BulkMail] Skipped: invalid send time:', timeValue);
    return false;
  }

  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setHours(hour, minute, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setMinutes(windowEnd.getMinutes() + BUFFER_MINUTES);

  if (now < windowStart) {
    console.log(`[BulkMail] Skipped: not yet time (now=${now.toLocaleTimeString()}, window=${windowStart.toLocaleTimeString()}–${windowEnd.toLocaleTimeString()})`);
    return false;
  }
  if (now > windowEnd) {
    console.log(`[BulkMail] Skipped: outside send window (now=${now.toLocaleTimeString()}, closed at ${windowEnd.toLocaleTimeString()})`);
    return false;
  }
  return true;
}

function buildCutoff(settings) {
  const timeValue = settings.bulk_mail_send_time || '18:00';
  const [hour, minute] = timeValue.split(':').map((v) => parseInt(v, 10));
  const cutoff = new Date();
  cutoff.setHours(hour, minute + BUFFER_MINUTES, 0, 0);
  return cutoff;
}

export async function sendBulkOutcomeEmails(interviewId = null, cutoff = null) {
  const passParams = [];
  const failParams = [];
  const conditions = [];

  if (interviewId) {
    passParams.push(interviewId);
    failParams.push(interviewId);
    conditions.push(`interview_id = $${passParams.length}`);
  }

  if (cutoff) {
    passParams.push(cutoff);
    failParams.push(cutoff);
    // NULL final_result_at = legacy row with no timestamp → always include
    conditions.push(`(final_result_at IS NULL OR final_result_at <= $${passParams.length})`);
  }

  const where = conditions.length ? " AND " + conditions.join(" AND ") : "";
  const passQuery = `SELECT thread_id, email FROM candidates WHERE final_result = 'pass' AND selected_email_sent = FALSE${where}`;
  const failQuery = `SELECT thread_id, email FROM candidates WHERE final_result = 'fail' AND not_selected_email_sent = FALSE${where}`;

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

  // Send all pending candidates whose result was finalized within the window.
  // Each candidate's selected_email_sent / not_selected_email_sent flag ensures no double-send.
  const cutoff = buildCutoff(settings);
  const result = await sendBulkOutcomeEmails(null, cutoff);

  // Update last_sent only when at least one email went out (for display purposes only).
  if (result.passSent + result.failSent > 0) {
    await query(
      "INSERT INTO settings (key, value) VALUES ('bulk_mail_last_sent', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [new Date().toLocaleString()]
    );
    console.log(`[BulkMail] Sent pass=${result.passSent}/${result.passTotal}, fail=${result.failSent}/${result.failTotal}`);
  } else {
    console.log(`[BulkMail] Window open, no pending emails (pass=${result.passTotal}, fail=${result.failTotal})`);
  }

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

// ─── No-show monitor ─────────────────────────────────────────────────────

async function runNoShowTick() {
  const flagged = await query(
    `UPDATE scheduled_interviews
     SET status = 'noshow'
     WHERE status = 'confirmed'
       AND slot_end < NOW()
       AND completed_at IS NULL
     RETURNING id, candidate_id, interviewer_id, slot_start`
  );

  for (const si of flagged.rows) {
    try {
      const details = await query(
        `SELECT c.email AS candidate_email, i.name AS interviewer_name
         FROM candidates c
         JOIN interviewers i ON i.id = $1
         WHERE c.thread_id = $2`,
        [si.interviewer_id, si.candidate_id]
      );
      if (details.rows.length) {
        await sendAdminNoShowAlert({
          candidateEmail: details.rows[0].candidate_email,
          interviewerName: details.rows[0].interviewer_name,
          slotStart: si.slot_start,
          scheduledId: si.id,
        });
        console.log(`[NoShowMonitor] Flagged and alerted: scheduled_id=${si.id}`);
      }
    } catch (err) {
      console.error(`[NoShowMonitor] Alert failed for ${si.id}:`, err.message);
    }
  }
}

export function startNoShowMonitor(intervalMs = 3_600_000) {
  runNoShowTick().catch((err) => console.error("[NoShowMonitor] Initial tick failed:", err.message));
  const timer = setInterval(() => {
    runNoShowTick().catch((err) => console.error("[NoShowMonitor] Tick failed:", err.message));
  }, intervalMs);
  console.log(`[NoShowMonitor] Started (interval=${intervalMs}ms)`);
  return timer;
}

// ─── Video reminder worker ────────────────────────────────────────────────

async function runVideoReminderTick() {
  const pending = await query(
    `SELECT thread_id, email
     FROM candidates
     WHERE status = 'AwaitingVideo'
       AND video_reminder_sent = FALSE
       AND created_at < NOW() - INTERVAL '48 hours'`
  );

  for (const candidate of pending.rows) {
    try {
      await sendCandidateVideoReminder(candidate.email);
      await query(
        "UPDATE candidates SET video_reminder_sent = TRUE WHERE thread_id = $1",
        [candidate.thread_id]
      );
      console.log(`[VideoReminder] Sent to ${candidate.email}`);
    } catch (err) {
      console.error(`[VideoReminder] Failed for ${candidate.thread_id}:`, err.message);
    }
  }
}

export function startVideoReminderWorker(intervalMs = 3_600_000) {
  runVideoReminderTick().catch((err) => console.error("[VideoReminder] Initial tick failed:", err.message));
  const timer = setInterval(() => {
    runVideoReminderTick().catch((err) => console.error("[VideoReminder] Tick failed:", err.message));
  }, intervalMs);
  console.log(`[VideoReminder] Started (interval=${intervalMs}ms)`);
  return timer;
}

// ─── Email helpers ────────────────────────────────────────────────────────

export async function sendCandidateSlotEmail(email, candidateId, slots) {
  const slotRows = slots.map((s) => `
    <tr>
      <td style="padding:14px 20px;border-bottom:1px solid #f1f5f9">
        <span style="font-size:15px;font-weight:600;color:#1e293b">📅 ${fmt(s.slot_start)}</span>
        <span style="color:#64748b;font-size:13px"> – ${fmt(s.slot_end)}</span>
      </td>
      <td style="padding:14px 20px;border-bottom:1px solid #f1f5f9;text-align:right">
        <a href="${BASE_URL}/candidate/schedule/accept/${s.candidateToken}"
           style="background:#6366f1;color:#fff;padding:9px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;display:inline-block">
          Select Slot →
        </a>
      </td>
    </tr>`).join("");

  await sendEmail(
    email,
    "🎯 Action Required — Choose Your Interview Slot",
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px">
      <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 32px 28px">
          <div style="font-size:13px;color:rgba(255,255,255,0.7);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">InterviewAssist</div>
          <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700">You're Shortlisted! 🎉</h1>
          <p style="margin:10px 0 0;color:rgba(255,255,255,0.85);font-size:15px">Please select a time slot for your interview.</p>
        </div>

        <!-- Body -->
        <div style="padding:32px">
          <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6">
            Hi there,<br><br>
            Congratulations — your application has been shortlisted and we'd love to meet you!
            Please choose one of the available interview slots below.
          </p>

          <div style="background:#f8fafc;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:24px">
            <table style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="background:#f1f5f9">
                  <th style="padding:12px 20px;text-align:left;font-size:11px;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">Available Slots</th>
                  <th style="padding:12px 20px;text-align:right;font-size:11px;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">Action</th>
                </tr>
              </thead>
              <tbody>${slotRows}</tbody>
            </table>
          </div>

          <div style="background:#eff6ff;border-left:4px solid #6366f1;padding:14px 18px;border-radius:0 8px 8px 0;margin-bottom:20px">
            <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.6">
              <strong>Tips for a great interview:</strong><br>
              • Find a quiet, well-lit space<br>
              • Test your camera and microphone beforehand<br>
              • Join the call 2–3 minutes early
            </p>
          </div>

          <p style="margin:0;font-size:13px;color:#94a3b8">If you have any questions, reply to this email and we'll be happy to help.</p>
        </div>

        <!-- Footer -->
        <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center">
          <p style="margin:0;font-size:12px;color:#94a3b8">Powered by InterviewAssist · This is an automated message</p>
        </div>
      </div>
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
    "⏰ Action Required — Confirm Your Interview Availability",
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px">
      <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:32px 32px 28px;border-bottom:3px solid #0ea5e9">
          <div style="font-size:13px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">InterviewAssist · Interviewer Portal</div>
          <h1 style="margin:0;color:#f8fafc;font-size:22px;font-weight:700">New Interview Assignment</h1>
          <p style="margin:10px 0 0;color:#94a3b8;font-size:14px">A candidate has confirmed a slot — your response is needed.</p>
        </div>

        <!-- Body -->
        <div style="padding:32px">
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6">Hi <strong>${si.iname}</strong>,<br><br>
          A candidate has selected an interview slot with you. Please confirm or decline your availability at your earliest convenience.</p>

          <!-- Detail card -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:28px">
            <table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;width:120px">👤 Candidate</td>
                <td style="padding:8px 0;font-size:14px;font-weight:600;color:#1e293b">${si.cemail}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b">📅 Date &amp; Time</td>
                <td style="padding:8px 0;font-size:14px;font-weight:600;color:#1e293b">${fmt(si.slot_start)} – ${fmt(si.slot_end)}</td>
              </tr>
            </table>
          </div>

          <!-- CTA buttons -->
          <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#1e293b">Are you available for this slot?</p>
          <table style="border-collapse:collapse">
            <tr>
              <td style="padding-right:12px">
                <a href="${confirmUrl}?decision=confirm"
                   style="background:#16a34a;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block">
                  ✓ &nbsp;Yes, Confirm
                </a>
              </td>
              <td>
                <a href="${rejectUrl}"
                   style="background:#fff;color:#dc2626;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block;border:2px solid #dc2626">
                  ✗ &nbsp;Decline
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">
            If the buttons don't work, visit: <a href="${confirmUrl}" style="color:#0ea5e9">${confirmUrl}</a>
          </p>
        </div>

        <!-- Footer -->
        <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center">
          <p style="margin:0;font-size:12px;color:#94a3b8">InterviewAssist · Interviewer Notification · Please do not forward this email</p>
        </div>
      </div>
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

  const meetRow = si.meet_link
    ? `<tr>
        <td style="padding:8px 0;font-size:13px;color:#64748b">🔗 Meeting Link</td>
        <td style="padding:8px 0">
          <a href="${si.meet_link}" style="color:#6366f1;font-weight:600;font-size:14px">${si.meet_link}</a>
        </td>
      </tr>`
    : "";

  const meetBtn = si.meet_link
    ? `<div style="margin-top:28px;text-align:center">
        <a href="${si.meet_link}" style="background:#6366f1;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block">
          🎥 &nbsp;Join Meeting
        </a>
       </div>`
    : "";

  // ── Candidate confirmed email ──────────────────────────────────────────────
  const candidateBody = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px">
      <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:36px 32px;text-align:center">
          <div style="font-size:40px;margin-bottom:12px">🎉</div>
          <h1 style="margin:0;color:#fff;font-size:26px;font-weight:800">Your Interview is Confirmed!</h1>
          <p style="margin:10px 0 0;color:rgba(255,255,255,0.85);font-size:15px">Everything is set — we're looking forward to meeting you.</p>
        </div>

        <!-- Body -->
        <div style="padding:32px">
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6">
            Hi there,<br><br>
            Your interview has been successfully scheduled. Here are the details:
          </p>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:24px">
            <table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;width:140px">📅 Date &amp; Time</td>
                <td style="padding:8px 0;font-size:14px;font-weight:700;color:#1e293b">${fmt(si.slot_start)} – ${fmt(si.slot_end)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b">👤 Interviewer</td>
                <td style="padding:8px 0;font-size:14px;font-weight:600;color:#1e293b">${si.iname}</td>
              </tr>
              ${meetRow}
            </table>
          </div>

          ${meetBtn}

          <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:14px 18px;border-radius:0 8px 8px 0;margin-top:24px">
            <p style="margin:0;font-size:13px;color:#15803d;line-height:1.7">
              <strong>How to prepare:</strong><br>
              • Join the meeting 2–3 minutes early<br>
              • Test your audio and camera beforehand<br>
              • Have a copy of your resume handy<br>
              • Be ready to discuss your projects and experience
            </p>
          </div>

          <p style="margin:24px 0 0;font-size:13px;color:#94a3b8">Good luck! If you need to reschedule, please contact us as soon as possible.</p>
        </div>

        <!-- Footer -->
        <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center">
          <p style="margin:0;font-size:12px;color:#94a3b8">Powered by InterviewAssist · This is an automated message</p>
        </div>
      </div>
    </div>`;

  // ── Interviewer confirmed email ────────────────────────────────────────────
  const interviewerBody = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px">
      <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:32px 32px 28px;border-bottom:3px solid #16a34a">
          <div style="font-size:13px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">InterviewAssist · Interviewer Portal</div>
          <h1 style="margin:0;color:#f8fafc;font-size:22px;font-weight:700">✓ Interview Confirmed</h1>
          <p style="margin:10px 0 0;color:#94a3b8;font-size:14px">This session is now locked in your schedule.</p>
        </div>

        <!-- Body -->
        <div style="padding:32px">
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6">
            Hi <strong>${si.iname}</strong>,<br><br>
            The following interview has been confirmed. Please add it to your calendar.
          </p>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:24px">
            <table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b;width:140px">📅 Date &amp; Time</td>
                <td style="padding:8px 0;font-size:14px;font-weight:700;color:#1e293b">${fmt(si.slot_start)} – ${fmt(si.slot_end)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#64748b">👤 Candidate</td>
                <td style="padding:8px 0;font-size:14px;font-weight:600;color:#1e293b">${si.cemail}</td>
              </tr>
              ${meetRow}
            </table>
          </div>

          ${meetBtn}

          <div style="background:#eff6ff;border-left:4px solid #0ea5e9;padding:14px 18px;border-radius:0 8px 8px 0;margin-top:24px">
            <p style="margin:0;font-size:13px;color:#0369a1;line-height:1.7">
              <strong>Before the interview:</strong><br>
              • Review the candidate's resume and video screening notes in the admin panel<br>
              • Note any skills gaps or points to probe<br>
              • Ensure you join on time — the candidate will be waiting
            </p>
          </div>

          <p style="margin:24px 0 0;font-size:13px;color:#94a3b8">If you have any issues, please contact the hiring team immediately.</p>
        </div>

        <!-- Footer -->
        <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center">
          <p style="margin:0;font-size:12px;color:#94a3b8">InterviewAssist · Interviewer Notification · Do not forward this email</p>
        </div>
      </div>
    </div>`;

  await sendEmail(si.cemail, "🎉 Your Interview is Confirmed!", candidateBody);
  await sendEmail(si.iemail, "✓ Interview Confirmed — Calendar Update", interviewerBody);

  // Mark candidate as scheduled
  await query(
    "UPDATE candidates SET status = 'Scheduled', scheduled_interview_id = $1 WHERE thread_id = $2",
    [scheduledId, si.candidate_id],
  );

  // Create calendar event via configured MCP provider (no-op when not configured)
  createCalendarEventForScheduledInterview(scheduledId).catch((err) =>
    console.warn(`[CalendarMCP] Event creation failed for ${scheduledId}: ${err.message}`)
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
