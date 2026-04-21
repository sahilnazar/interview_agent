import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcrypt";

import { query } from "../config/db.js";
import { sendInvitationEmail, sendRejectionEmail } from "../services/email.js";
import { analyzeCandidateVideo } from "../services/video-analysis.js";
import { autoAssignAndConfirmCandidate } from "../services/scheduler.js";

function parseSkillList(value = "") {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9+#.]/g, " ").replace(/\s+/g, " ").trim();
}

function hasRequiredSkillMatch(requiredSkillsText = "", result = {}) {
  const requiredSkills = parseSkillList(requiredSkillsText);
  if (!requiredSkills.length) return { matched: true, missing: [] };

  const detectedSkills = Array.isArray(result.skills) ? result.skills : [];
  const combinedText = normalizeText([
    detectedSkills.join(" "),
    result.transcript || "",
    result.summary || "",
    result.fitReason || "",
  ].join(" "));

  const matched = requiredSkills.filter((skill) => {
    const target = normalizeText(skill);
    return target && combinedText.includes(target);
  });

  return {
    matched: matched.length > 0,
    missing: requiredSkills.filter((skill) => !matched.includes(skill)),
  };
}

/**
 * Re-select a rejected candidate — send invitation email & update status to AwaitingVideo.
 */
export async function reselectCandidateById(threadId) {
  const row = await query("SELECT email, status FROM candidates WHERE thread_id = $1", [threadId]);
  if (!row.rows.length) throw new Error("Candidate not found");
  if (row.rows[0].status !== "Rejected") throw new Error("Candidate is not in Rejected status");

  // Re-invite uses fresh credentials so candidate can log in reliably.
  const plainPassword = crypto.randomBytes(6).toString("base64url");
  const passwordHash = await bcrypt.hash(plainPassword, 10);
  const loginToken = crypto.randomBytes(4).toString("hex");

  await query(
    `UPDATE candidates
     SET status = 'AwaitingVideo',
         login_token = $1,
         password_hash = $2,
         must_change_password = TRUE,
         rejection_sent = FALSE
     WHERE thread_id = $3`,
    [loginToken, passwordHash, threadId]
  );

  await sendInvitationEmail(row.rows[0].email, threadId, plainPassword);
}

/**
 * Send a rejection email & update status to Rejected.
 */
export async function rejectCandidateById(threadId) {
  const row = await query("SELECT email, status FROM candidates WHERE thread_id = $1", [threadId]);
  if (!row.rows.length) throw new Error("Candidate not found");
  try { await sendRejectionEmail(row.rows[0].email); } catch (e) { console.error("Rejection email failed:", e.message); }
  await query("UPDATE candidates SET status = 'Rejected', rejection_sent = TRUE WHERE thread_id = $1", [threadId]);
}

/**
 * Analyse an uploaded candidate video using Groq Whisper + Gemini 2.5 Flash.
 */
export async function analyzeVideoForCandidate(threadId, videoPath) {
  try {
    const absPath = path.resolve(videoPath);
    console.log(`[VideoAnalysis] Starting analysis for ${threadId}`);

    const interviewRow = await query(
      `SELECT c.interview_id, i.required_skills, i.salary_range
       FROM candidates c
       JOIN interviews i ON i.id = c.interview_id
       WHERE c.thread_id = $1`,
      [threadId]
    );
    const roleContext = interviewRow.rows[0] || { interview_id: null, required_skills: "", salary_range: "" };

    const result = await analyzeCandidateVideo(absPath, {
      requiredSkills: roleContext.required_skills || "",
      salaryRange: roleContext.salary_range || "",
    });

    const { englishScore, confidenceScore, skills, summary, transcript, salaryExpectation, fitVerdict, fitReason, usedFallback } = result;
    const skillCheck = hasRequiredSkillMatch(roleContext.required_skills || "", result);

    let finalStatus = "Done";
    let finalSummary = summary || "";
    if (usedFallback) {
      finalStatus = "Error";
      finalSummary = [
        summary,
        "Auto-screen result: Temporary AI fallback used. Please retry analysis from admin.",
      ].filter(Boolean).join(" ");
    } else if ((fitVerdict === "mismatch" || fitVerdict === "fail" || fitVerdict === "reject") || !skillCheck.matched) {
      finalStatus = "Rejected";
      const reason = fitReason || (skillCheck.missing.length ? `Missing required skills in video: ${skillCheck.missing.join(", ")}` : "Candidate does not match the role requirements.");
      finalSummary = [summary, `Auto-screen result: ${reason}`].filter(Boolean).join(" ");
    }

    await query(
      `UPDATE candidates
       SET english_score = $1, confidence_score = $2, skills = $3,
           salary_expectation = $4, video_summary = $5, video_transcript = $6,
           status = $7, video_path = $8
       WHERE thread_id = $9`,
      [englishScore, confidenceScore, JSON.stringify(skills), salaryExpectation || null, finalSummary, transcript, finalStatus, videoPath, threadId]
    );

    let scheduling = null;
    if (finalStatus === "Done" && roleContext.interview_id) {
      try {
        scheduling = await autoAssignAndConfirmCandidate(threadId, roleContext.interview_id);
        if (scheduling?.scheduled) {
          console.log(`[Scheduling] Auto-assigned interviewer for ${threadId} (scheduledId=${scheduling.scheduledId || "existing"})`);
        } else {
          console.log(`[Scheduling] No available assigned interviewer for ${threadId} yet`);
        }
      } catch (schedErr) {
        console.error(`[Scheduling] Auto-assignment failed for ${threadId}:`, schedErr.message || schedErr);
      }
    }

    console.log(`[VideoAnalysis] Done for ${threadId} — english=${englishScore}, confidence=${confidenceScore}, status=${finalStatus}`);
    return { ...result, status: finalStatus, scheduling };
  } catch (err) {
    console.error("Video analysis failed:", err);
    // Set status to Error so admin can see it; video_path is preserved for retry
    await query("UPDATE candidates SET status = 'Error' WHERE thread_id = $1", [threadId]).catch(() => {});
    throw err;
  }
}
