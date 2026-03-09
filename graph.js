/**
 * LangGraph Interview Workflow
 *
 * Nodes:
 *   1. check_domain_and_duplicate  — validate sender, dedupe by resume hash
 *   2. analyze_resume_rag          — RAG-based resume scoring via Gemini Flash
 *   3. mark_screened               — mark passing candidates for admin review
 *   4. reject_candidate            — send rejection email
 *
 * After screening the admin reviews the scored candidates and
 * manually clicks Invite or Reject.  Video analysis runs as a
 * standalone exported function when the candidate uploads.
 *
 * Conditional edges:
 *   domain_gate     — after node 1: rejected → END, else → node 2
 *   threshold_gate  — after node 2: pass → node 3, fail → node 4
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import pdfParse from "pdf-parse";
import nodemailer from "nodemailer";

import { query } from "./db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure a value is a proper Node Buffer (survives checkpoint serialisation). */
function toBuffer(val) {
  if (Buffer.isBuffer(val)) return val;
  if (val?.type === "Buffer" && Array.isArray(val.data)) return Buffer.from(val.data);
  if (typeof val === "string") return Buffer.from(val, "base64");
  return Buffer.from(val);
}

/** Extract JSON from an LLM response that may contain Markdown fences. */
function parseJSON(text) {
  const str = typeof text === "string" ? text : String(text);
  try { return JSON.parse(str); } catch { /* continue */ }
  const fenced = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
  const obj = str.match(/\{[\s\S]*\}/);
  if (obj) try { return JSON.parse(obj[0]); } catch { /* continue */ }
  throw new Error("Failed to parse JSON from LLM response: " + str.slice(0, 200));
}

/** Nodemailer transport (lazy-created). */
let _transporter;

/** Retry a function up to `maxRetries` times on 429 (rate-limit) errors. */
async function callWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes("429");
      if (!is429 || attempt === maxRetries) throw err;
      const wait = Math.min(2 ** attempt * 2000, 15000);
      console.warn(`Rate limited — retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** Get a Groq chat model for text/reasoning tasks. */
function getGroqModel() {
  return new ChatGroq({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    apiKey: process.env.GROQ_API_KEY,
  });
}
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return _transporter;
}

async function sendEmail(to, subject, html) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn("Email credentials not configured — skipping send to", to);
    return;
  }
  await getTransporter().sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject,
    html,
  });
}

async function sendInvitationEmail(email, threadId) {
  const port = process.env.PORT || 3000;
  const uploadUrl = `http://localhost:${port}/upload/${encodeURIComponent(threadId)}`;
  await sendEmail(
    email,
    "Interview Invitation — Next Steps",
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Congratulations!</h2>
      <p>Your resume has been shortlisted. Please complete the next step of our process.</p>
      <h3>Interview Question</h3>
      <p>Record a <strong>2–3 minute video</strong> introducing yourself, discussing your
      relevant experience, and explaining why you're interested in this position.
      Focus on demonstrating your technical knowledge and communication skills.</p>
      <p><a href="${uploadUrl}" style="display:inline-block;padding:12px 24px;background:#4f6ef7;color:#fff;border-radius:6px;text-decoration:none">
        Submit Your Video
      </a></p>
      <p style="color:#888;font-size:12px">Reference: ${threadId}</p>
    </div>`
  );
}

async function sendRejectionEmail(email) {
  await sendEmail(
    email,
    "Application Update",
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Thank you for your interest</h2>
      <p>After careful review we have decided not to move forward with your application
      at this time.</p>
      <p>We appreciate your time and wish you the best in your job search.</p>
    </div>`
  );
}

// ---------------------------------------------------------------------------
// State Annotation
// ---------------------------------------------------------------------------

const InterviewState = Annotation.Root({
  candidateEmail: Annotation({ reducer: (_, v) => v, default: () => "" }),
  resumeBuffer:   Annotation({ reducer: (_, v) => v, default: () => null }),
  resumeHash:     Annotation({ reducer: (_, v) => v, default: () => "" }),
  resumeScore:    Annotation({ reducer: (_, v) => v, default: () => 0 }),
  videoUrl:       Annotation({ reducer: (_, v) => v, default: () => "" }),
  videoAnalysis:  Annotation({ reducer: (_, v) => v, default: () => ({ englishScore: 0, skills: [] }) }),
  status:         Annotation({ reducer: (_, v) => v, default: () => "Screening" }),
  messages:       Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  threadId:       Annotation({ reducer: (_, v) => v, default: () => "" }),
});

// ---------------------------------------------------------------------------
// Graph Nodes
// ---------------------------------------------------------------------------

async function checkDomainAndDuplicate(state) {
  const { candidateEmail, resumeBuffer, threadId } = state;

  // --- compute SHA-256 hash ---
  const buf = toBuffer(resumeBuffer);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");

  // --- duplicate check ---
  const dup = await query("SELECT thread_id FROM candidates WHERE resume_hash = $1", [hash]);
  if (dup.rows.length > 0) {
    return { status: "Rejected", resumeHash: hash };
  }

  // --- insert new candidate ---
  await query(
    "INSERT INTO candidates (thread_id, email, resume_hash, status, created_at) VALUES ($1, $2, $3, 'Screening', NOW())",
    [threadId, candidateEmail, hash]
  );

  return { resumeHash: hash, status: "Screening" };
}

async function analyzeResumeRag(state) {
  const { threadId, resumeBuffer } = state;

  try {
    // Fetch JD
    const jdRow = await query("SELECT value FROM settings WHERE key = 'jd'");
    const jd = jdRow.rows[0].value;

    // Extract resume text
    const buf = toBuffer(resumeBuffer);
    let resumeText;
    try {
      const pdfData = await pdfParse(buf);
      resumeText = pdfData.text;
    } catch (pdfErr) {
      console.warn(`PDF parse failed for ${threadId}, using raw text:`, pdfErr.message);
      resumeText = buf.toString("utf-8");
    }
    // Score with Groq (Llama 3.3 70B) — fast, free, generous limits
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

    // Clear buffer from state to keep checkpoints lean
    return { resumeScore: score, resumeBuffer: null };
  } catch (err) {
    console.error("Resume analysis failed:", err);
    await query("UPDATE candidates SET status = 'Error' WHERE thread_id = $1", [threadId]);
    return { status: "Error", resumeScore: 0, resumeBuffer: null };
  }
}

async function markScreened(state) {
  const { threadId } = state;
  await query("UPDATE candidates SET status = 'Screened' WHERE thread_id = $1", [threadId]);
  return { status: "Screened" };
}

async function rejectCandidate(state) {
  const { threadId, candidateEmail } = state;

  try {
    await sendRejectionEmail(candidateEmail);
  } catch (err) {
    console.error("Failed to send rejection email:", err.message);
  }

  await query("UPDATE candidates SET status = 'Rejected' WHERE thread_id = $1", [threadId]);
  return { status: "Rejected" };
}

// ---------------------------------------------------------------------------
// Standalone helpers exported for server routes
// ---------------------------------------------------------------------------

/**
 * Send an invitation email & update status to AwaitingVideo.
 * Called by the admin from the dashboard.
 */
export async function inviteCandidateById(threadId) {
  const row = await query("SELECT email, status FROM candidates WHERE thread_id = $1", [threadId]);
  if (!row.rows.length) throw new Error("Candidate not found");
  if (row.rows[0].status !== "Screened") throw new Error("Candidate is not in Screened status");
  await sendInvitationEmail(row.rows[0].email, threadId);
  await query("UPDATE candidates SET status = 'AwaitingVideo' WHERE thread_id = $1", [threadId]);
}

/**
 * Send a rejection email & update status to Rejected.
 * Called by the admin from the dashboard.
 */
export async function rejectCandidateById(threadId) {
  const row = await query("SELECT email, status FROM candidates WHERE thread_id = $1", [threadId]);
  if (!row.rows.length) throw new Error("Candidate not found");
  if (row.rows[0].status !== "Screened") throw new Error("Candidate is not in Screened status");
  try { await sendRejectionEmail(row.rows[0].email); } catch (e) { console.error("Rejection email failed:", e.message); }
  await query("UPDATE candidates SET status = 'Rejected' WHERE thread_id = $1", [threadId]);
}

/**
 * Analyse an uploaded candidate video with Gemini Pro.
 * Called directly from the upload route (no graph interrupt needed).
 */
export async function analyzeVideoForCandidate(threadId, videoPath) {
  try {
    const absPath = path.resolve(videoPath);
    const videoBuffer = fs.readFileSync(absPath);
    const base64Video = videoBuffer.toString("base64");

    const ext = path.extname(absPath).toLowerCase();
    const mimeMap = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
    const mimeType = mimeMap[ext] || "video/mp4";

    const model = new ChatGoogleGenerativeAI({ model: "gemini-2.5-pro", temperature: 0 });
    const message = new HumanMessage({
      content: [
        {
          type: "image_url",
          image_url: `data:${mimeType};base64,${base64Video}`,
        },
        {
          type: "text",
          text: [
            "Analyze this candidate interview video.",
            'Return only valid JSON: { "englishScore": <1-10>, "skills": ["skill1", "skill2"] }.',
            "englishScore is fluency/clarity rating. skills are specific technical topics mentioned.",
          ].join(" "),
        },
      ],
    });

    const response = await callWithRetry(() => model.invoke([message]));
    const analysis = parseJSON(response.content);
    const englishScore = typeof analysis.englishScore === "number" ? analysis.englishScore : 0;
    const skills = Array.isArray(analysis.skills) ? analysis.skills : [];

    await query(
      "UPDATE candidates SET english_score = $1, skills = $2, status = 'Done', video_path = $3 WHERE thread_id = $4",
      [englishScore, JSON.stringify(skills), videoPath, threadId]
    );

    return { englishScore, skills };
  } catch (err) {
    console.error("Video analysis failed:", err);
    await query("UPDATE candidates SET status = 'Error' WHERE thread_id = $1", [threadId]);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Conditional routers
// ---------------------------------------------------------------------------

function domainGate(state) {
  return state.status === "Rejected" ? END : "analyze_resume_rag";
}

async function thresholdGate(state) {
  if (state.status === "Error") return END;
  const row = await query("SELECT value FROM settings WHERE key = 'passThreshold'");
  const threshold = parseFloat(row.rows[0].value);
  return state.resumeScore >= threshold ? "mark_screened" : "reject_candidate";
}

// ---------------------------------------------------------------------------
// Graph definition
// ---------------------------------------------------------------------------

const workflow = new StateGraph(InterviewState)
  .addNode("check_domain_and_duplicate", checkDomainAndDuplicate)
  .addNode("analyze_resume_rag", analyzeResumeRag)
  .addNode("mark_screened", markScreened)
  .addNode("reject_candidate", rejectCandidate)
  .addEdge(START, "check_domain_and_duplicate")
  .addConditionalEdges("check_domain_and_duplicate", domainGate)
  .addConditionalEdges("analyze_resume_rag", thresholdGate)
  .addEdge("mark_screened", END)
  .addEdge("reject_candidate", END);

// ---------------------------------------------------------------------------
// createGraph — compile with PostgresSaver (falls back to MemorySaver)
// ---------------------------------------------------------------------------

export async function createGraph() {
  let checkpointer;

  try {
    const mod = await import("@langchain/langgraph-checkpoint-postgres");
    const PostgresSaver = mod.PostgresSaver;
    const connString = `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
    checkpointer = PostgresSaver.fromConnString(connString);
    await checkpointer.setup();
    console.log("Using PostgresSaver checkpointer");
  } catch (err) {
    console.warn("PostgresSaver unavailable, falling back to MemorySaver:", err.message);
    checkpointer = new MemorySaver();
  }

  return workflow.compile({ checkpointer });
}
