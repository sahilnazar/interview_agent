import crypto from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { extractPdfText } from "../services/pdf-extract.js";
import bcrypt from "bcrypt";

import { query } from "../config/db.js";
import { toBuffer, parseJSON, callWithRetry, getGroqModel } from "./helpers.js";
import { sendInvitationEmail } from "../services/email.js";
import { retrieveRelevantChunks } from "../services/embeddings.js";

// ---------------------------------------------------------------------------
// Node: check duplicates + insert candidate (scoped to interview)
// ---------------------------------------------------------------------------

export async function checkDomainAndDuplicate(state) {
  const { candidateEmail, resumeBuffer, threadId, interviewId, assignmentMethod, matchConfidence } = state;

  const buf = toBuffer(resumeBuffer);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");

  // Duplicate check scoped to this interview (by file hash OR email)
  const dup = await query(
    "SELECT thread_id FROM candidates WHERE interview_id = $1 AND (resume_hash = $2 OR email = $3)",
    [interviewId, hash, candidateEmail]
  );
  if (dup.rows.length > 0) {
    console.log(`Duplicate candidate detected for ${candidateEmail} in interview ${interviewId} — skipping`);
    return { status: "Rejected", resumeHash: hash };
  }

  await query(
    `INSERT INTO candidates (thread_id, interview_id, email, resume_hash, status, assignment_method, match_confidence, created_at)
     VALUES ($1, $2, $3, $4, 'Screening', $5, $6, NOW())`,
    [threadId, interviewId, candidateEmail, hash, assignmentMethod || "manual", matchConfidence]
  );

  return { resumeHash: hash, status: "Screening" };
}

// ---------------------------------------------------------------------------
// Node: score resume with RAG (pgvector) + Groq + produce summary
// ---------------------------------------------------------------------------

export async function analyzeResume(state) {
  const { threadId, resumeBuffer, interviewId } = state;

  try {
    const buf = toBuffer(resumeBuffer);
    let resumeText = "";

    // Detect file type from magic bytes
    const isDocx = buf[0] === 0x50 && buf[1] === 0x4B; // PK (ZIP/DOCX)
    const isDoc = buf[0] === 0xD0 && buf[1] === 0xCF;  // OLE compound (DOC)

    if (isDocx) {
      try {
        const result = await mammoth.extractRawText({ buffer: buf });
        resumeText = (result.value || "").trim();
        console.log(`[${threadId}] Extracted ${resumeText.length} chars from DOCX`);
      } catch (docxErr) {
        console.warn(`[${threadId}] mammoth DOCX parse failed: ${docxErr.message}`);
      }
    } else if (isDoc) {
      try {
        const extractor = new WordExtractor();
        const doc = await extractor.extract(buf);
        resumeText = (doc.getBody() || "").trim();
        console.log(`[${threadId}] Extracted ${resumeText.length} chars from DOC`);
      } catch (docErr) {
        console.warn(`[${threadId}] word-extractor DOC parse failed: ${docErr.message}`);
      }
    } else {
      // PDF: multi-strategy extraction (pdf-parse → pdfjs-dist → raw regex)
      resumeText = await extractPdfText(buf);
    }

    if (resumeText.length < 50) {
      console.error(`[${threadId}] Could not extract meaningful text from resume (${resumeText.length} chars)`);
      // Store a low score with an explanation rather than sending garbage to the LLM
      await query(
        "UPDATE candidates SET resume_score = 0, summary = $1, status = 'Rejected' WHERE thread_id = $2",
        [JSON.stringify({ score: 0, summary: "Resume PDF could not be parsed — no readable text extracted.", matching: [], missing: ["Unreadable resume"] }), threadId]
      );
      return { status: "Rejected", resumeScore: 0 };
    }

    console.log(`[${threadId}] Extracted ${resumeText.length} chars from resume`);

    // RAG: retrieve relevant JD chunks for this interview
    let jdContext;
    const chunks = await retrieveRelevantChunks(interviewId, resumeText, 5);
    if (chunks.length > 0) {
      jdContext = chunks.join("\n\n---\n\n");
      console.log(`[${threadId}] RAG: using ${chunks.length} relevant JD chunks`);
    } else {
      // Fallback: use full JD if no chunks stored yet
      const jdRow = await query("SELECT jd FROM interviews WHERE id = $1", [interviewId]);
      jdContext = jdRow.rows.length ? jdRow.rows[0].jd : "";
      console.log(`[${threadId}] RAG: no chunks found — using full JD fallback`);
    }

    const model = getGroqModel();
    const prompt = [
      "You are an expert technical recruiter.",
      "Given the job description context and a candidate resume:",
      "1. Score the resume fit from 0 to 100.",
      "2. Provide a brief summary of what the candidate HAS that matches the JD.",
      "3. List what key requirements from the JD the candidate is MISSING.",
      "",
      "Job Description Context:",
      jdContext,
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
// Node: auto-invite — send invitation email + set AwaitingVideo
// ---------------------------------------------------------------------------

export async function sendInvite(state) {
  const { threadId, candidateEmail } = state;

  // Generate login credentials
  const loginToken = crypto.randomBytes(4).toString("hex"); // 8-char hex
  const plainPassword = crypto.randomBytes(6).toString("base64url"); // ~8 chars
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  await query(
    "UPDATE candidates SET login_token = $1, password_hash = $2, must_change_password = TRUE WHERE thread_id = $3",
    [loginToken, passwordHash, threadId]
  );

  try {
    await sendInvitationEmail(candidateEmail, threadId, plainPassword);
  } catch (err) {
    console.error("Failed to send invitation email:", err.message);
  }

  await query("UPDATE candidates SET status = 'AwaitingVideo' WHERE thread_id = $1", [threadId]);
  return { status: "AwaitingVideo" };
}

// ---------------------------------------------------------------------------
// Node: reject candidate (status only — no email, admin sends in bulk)
// ---------------------------------------------------------------------------

export async function rejectCandidate(state) {
  const { threadId } = state;
  await query("UPDATE candidates SET status = 'Rejected' WHERE thread_id = $1", [threadId]);
  return { status: "Rejected" };
}
