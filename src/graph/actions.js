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

function escapeRegExp(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSkillVariants(skill = "") {
  const base = normalizeText(skill);
  if (!base) return [];

  const compact = base.replace(/\s+/g, "");
  const variants = new Set([base, compact]);

  const aliasMap = {
    js: ["javascript", "java script", "ecmascript", "node js", "nodejs"],
    javascript: ["js", "java script", "ecmascript"],
    typescript: ["ts", "type script"],
    ts: ["typescript", "type script"],
    react: ["reactjs", "react js", "react.js"],
    reactjs: ["react", "react js", "react.js"],
    node: ["nodejs", "node js", "node.js"],
    nodejs: ["node", "node js", "node.js"],
  };

  for (const [key, aliases] of Object.entries(aliasMap)) {
    if (base === key || compact === key) {
      for (const alias of aliases) {
        const normalizedAlias = normalizeText(alias);
        if (!normalizedAlias) continue;
        variants.add(normalizedAlias);
        variants.add(normalizedAlias.replace(/\s+/g, ""));
      }
    }
  }

  return Array.from(variants);
}

function textContainsSkill(text = "", skill = "") {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const variants = buildSkillVariants(skill);
  return variants.some((variant) => {
    if (!variant) return false;

    // Short variants like "js" or "ts" should match as whole words only.
    if (variant.length <= 2) {
      const shortRegex = new RegExp(`(^|\\s)${escapeRegExp(variant)}($|\\s)`, "i");
      return shortRegex.test(normalized);
    }

    const spacedRegex = new RegExp(`(^|\\s)${escapeRegExp(variant)}($|\\s)`, "i");
    if (spacedRegex.test(normalized)) return true;

    const compactText = normalized.replace(/\s+/g, "");
    const compactVariant = variant.replace(/\s+/g, "");
    return compactVariant.length >= 4 && compactText.includes(compactVariant);
  });
}

function hasRequiredSkillMatch(requiredSkillsText = "", result = {}) {
  const requiredSkills = parseSkillList(requiredSkillsText);
  if (!requiredSkills.length) {
    return { matched: true, matchedSkills: [], missing: [] };
  }

  const detectedSkills = Array.isArray(result.skills) ? result.skills : [];
  const combinedText = normalizeText([
    detectedSkills.join(" "),
    result.transcript || "",
    result.summary || "",
    result.fitReason || "",
  ].join(" "));

  const matched = requiredSkills.filter((skill) => {
    return textContainsSkill(combinedText, skill);
  });

  return {
    matched: matched.length > 0,
    matchedSkills: matched,
    missing: requiredSkills.filter((skill) => !matched.includes(skill)),
  };
}

function hasNameIntroduction(transcript = "") {
  const text = normalizeText(transcript);
  if (!text) return false;

  // Accept common short intro patterns like "my name is..." and "i am...".
  const patterns = [
    /\bmy name is\b/,
    /\bi am\b/,
    /\bi m\b/,
    /\bthis is\b/,
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function extractCandidateName(transcript = "") {
  if (!transcript) return "Unknown";

  const patterns = [
    /\bmy name is\s+([a-z][a-z\s'.-]{1,40})/i,
    /\bi am\s+([a-z][a-z\s'.-]{1,40})/i,
    /\bi'm\s+([a-z][a-z\s'.-]{1,40})/i,
    /\bthis is\s+([a-z][a-z\s'.-]{1,40})/i,
  ];

  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (!match || !match[1]) continue;

    let name = match[1]
      .split(/\b(and|with|from|for|working|currently|having|who|i|my skill|skills|skill is|experience|experienced)\b/i)[0]
      .trim()
      .replace(/[^a-z\s'.-]/gi, "")
      .replace(/\s+/g, " ");

    if (!name) continue;
    if (name.length > 40) name = name.slice(0, 40).trim();
    return name;
  }

  return "Unknown";
}

function hasSkillMention(result = {}) {
  const detectedSkills = Array.isArray(result.skills) ? result.skills.filter(Boolean) : [];
  if (detectedSkills.length > 0) return true;

  const transcript = normalizeText(result.transcript || "");
  if (!transcript) return false;

  return /\b(skill|skills|experienced|experience|proficient|expertise|worked with|hands on)\b/.test(transcript);
}

function hasSalaryExpectation(result = {}) {
  const salary = String(result.salaryExpectation || "").trim().toLowerCase();
  if (salary && salary !== "not mentioned" && salary !== "na" && salary !== "n/a") {
    return true;
  }

  const transcript = normalizeText(result.transcript || "");
  if (!transcript) return false;

  const salaryKeywords = /\b(salary|expected salary|expectation|ctc|compensation|package|pay|remuneration)\b/;
  const intentKeywords = /\b(expect|expected|looking for|target|around|between|minimum|at least)\b/;
  const amountPatterns = [
    /\b\d+(?:\.\d+)?\s*(k|thousand|lakh|lakhs|lac|lpa|crore|crores|million|monthly|annual|yearly|per month|per annum)\b/,
    /\b(rs|inr|rupees?)\s*\d+(?:\.\d+)?\b/,
    /\b\d+(?:\.\d+)?\s*(to|-)\s*\d+(?:\.\d+)?\s*(lpa|lakh|lakhs|k|thousand|crore|crores)\b/,
  ];

  if (salaryKeywords.test(transcript)) return true;

  const hasAmount = amountPatterns.some((pattern) => pattern.test(transcript));
  return hasAmount && intentKeywords.test(transcript);
}

function evaluateMandatoryResponse(result = {}, requiredSkillsText = "") {
  const skillMatch = hasRequiredSkillMatch(requiredSkillsText, result);
  const hasGenericSkillMention = hasSkillMention(result);
  const skillsProvided = parseSkillList(requiredSkillsText).length > 0
    ? skillMatch.matched
    : hasGenericSkillMention;

  const checks = {
    nameProvided: hasNameIntroduction(result.transcript || ""),
    skillsProvided,
    salaryProvided: hasSalaryExpectation(result),
  };

  const missing = [];
  if (!checks.nameProvided) missing.push("name introduction");
  if (!checks.skillsProvided) missing.push("skills");

  return {
    checks,
    passed: missing.length === 0,
    missing,
    skillMatch,
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
    const mandatoryCheck = evaluateMandatoryResponse(result, roleContext.required_skills || "");
    const skillCheck = mandatoryCheck.skillMatch;
    const candidateName = extractCandidateName(transcript || "");
    const detectedSkills = Array.isArray(skills) ? skills.filter(Boolean) : [];

    console.log(
      `[VideoAnalysis] Extracted profile for ${threadId}: ` +
      `name=${candidateName}; skills=${detectedSkills.length ? detectedSkills.join(", ") : "none"}`
    );
    console.log(
      `[VideoAnalysis] Required skills match for ${threadId}: ` +
      `matched=${skillCheck.matchedSkills.length ? skillCheck.matchedSkills.join(", ") : "none"}; ` +
      `missing=${skillCheck.missing.length ? skillCheck.missing.join(", ") : "none"}`
    );
    console.log(
      `[VideoAnalysis] Mandatory checks for ${threadId}: ` +
      `name=${mandatoryCheck.checks.nameProvided}, ` +
      `skills=${mandatoryCheck.checks.skillsProvided}, ` +
      `salary=${mandatoryCheck.checks.salaryProvided}, ` +
      `passed=${mandatoryCheck.passed}`
    );

    let finalStatus = "Done";
    let finalSummary = summary || "";
    if (!mandatoryCheck.passed) {
      finalStatus = "Rejected";
      const reason = `Missing required introduction details: ${mandatoryCheck.missing.join(", ")}.`;
      finalSummary = [summary, `Auto-screen result: ${reason}`].filter(Boolean).join(" ");
    } else if (!skillCheck.matched) {
      finalStatus = "Rejected";
      const reason = skillCheck.missing.length
        ? `Missing required skills in video: ${skillCheck.missing.join(", ")}`
        : "Candidate does not match the role requirements.";
      finalSummary = [summary, `Auto-screen result: ${reason}`].filter(Boolean).join(" ");
    } else if (usedFallback) {
      finalSummary = [
        summary,
        "Auto-screen note: AI fallback used, decision made from transcript checks.",
      ].filter(Boolean).join(" ");
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
          console.log(`[Scheduling] Auto-assignment pending for ${threadId}: ${scheduling?.reason || "unknown_reason"}`);
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
