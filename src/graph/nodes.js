import crypto from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import pdfParse from "pdf-parse";

import { query } from "../config/db.js";
import { toBuffer, parseJSON, callWithRetry, getGroqModel } from "./helpers.js";
import { sendRejectionEmail } from "../services/email.js";

// ---------------------------------------------------------------------------
// Node: check duplicates + insert candidate
// ---------------------------------------------------------------------------

export async function checkDomainAndDuplicate(state) {
  const { candidateEmail, resumeBuffer, threadId } = state;

  const buf = toBuffer(resumeBuffer);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");

  const dup = await query("SELECT thread_id FROM candidates WHERE resume_hash = $1", [hash]);
  if (dup.rows.length > 0) {
    return { status: "Rejected", resumeHash: hash };
  }

  await query(
    "INSERT INTO candidates (thread_id, email, resume_hash, status, created_at) VALUES ($1, $2, $3, 'Screening', NOW())",
    [threadId, candidateEmail, hash]
  );

  return { resumeHash: hash, status: "Screening" };
}

// ---------------------------------------------------------------------------
// Node: score resume with Groq + produce summary
// ---------------------------------------------------------------------------

export async function analyzeResume(state) {
  const { threadId, resumeBuffer } = state;

  try {
    const jdRow = await query("SELECT value FROM settings WHERE key = 'jd'");
    const jd = jdRow.rows[0].value;

    const buf = toBuffer(resumeBuffer);
    let resumeText;
    try {
      const pdfData = await pdfParse(buf);
      resumeText = pdfData.text;
    } catch (pdfErr) {
      console.warn(`PDF parse failed for ${threadId}, using raw text:`, pdfErr.message);
      resumeText = buf.toString("utf-8");
    }

    const model = getGroqModel();
    const prompt = [
      "You are an expert technical recruiter.",
      "Given the job description and a candidate resume:",
      "1. Score the resume fit from 0 to 100.",
      "2. Provide a brief summary of what the candidate HAS that matches the JD.",
      "3. List what key requirements from the JD the candidate is MISSING.",
      "",
      "Job Description:",
      jd,
      "",
      "Candidate Resume:",
      resumeText,
      "",
      'Return ONLY valid JSON:',
      '{',
      '  "score": <number 0-100>,',
      '  "matching": ["skill or requirement they have", ...],',
      '  "missing": ["skill or requirement they lack", ...],',
      '  "summary": "2-3 sentence overall assessment"',
      '}',
    ].join("\n");

    const response = await callWithRetry(() => model.invoke([new HumanMessage(prompt)]));
    const parsed = parseJSON(response.content);
    const score = typeof parsed.score === "number" ? parsed.score : 0;
    const matching = Array.isArray(parsed.matching) ? parsed.matching : [];
    const missing = Array.isArray(parsed.missing) ? parsed.missing : [];
    const summaryText = parsed.summary || "";
    const summaryObj = JSON.stringify({ matching, missing, summary: summaryText });
    await query("UPDATE candidates SET resume_score = $1, summary = $2, status = 'Screening' WHERE thread_id = $3", [score, summaryObj, threadId]);

    return { resumeScore: score, resumeBuffer: null };
  } catch (err) {
    console.error("Resume analysis failed:", err);
    await query("UPDATE candidates SET status = 'Error' WHERE thread_id = $1", [threadId]);
    return { status: "Error", resumeScore: 0, resumeBuffer: null };
  }
}

// ---------------------------------------------------------------------------
// Node: mark as screened (passed threshold)
// ---------------------------------------------------------------------------

export async function markScreened(state) {
  const { threadId } = state;
  await query("UPDATE candidates SET status = 'Screened' WHERE thread_id = $1", [threadId]);
  return { status: "Screened" };
}

// ---------------------------------------------------------------------------
// Node: reject candidate
// ---------------------------------------------------------------------------

export async function rejectCandidate(state) {
  const { threadId, candidateEmail } = state;

  try {
    await sendRejectionEmail(candidateEmail);
  } catch (err) {
    console.error("Failed to send rejection email:", err.message);
  }

  await query("UPDATE candidates SET status = 'Rejected' WHERE thread_id = $1", [threadId]);
  return { status: "Rejected" };
}
