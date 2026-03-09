import fs from "node:fs";
import path from "node:path";
import { HumanMessage } from "@langchain/core/messages";

import { query } from "../config/db.js";
import { parseJSON, callWithRetry, getGeminiModel } from "./helpers.js";
import { sendInvitationEmail, sendRejectionEmail } from "../services/email.js";

/**
 * Send an invitation email & update status to AwaitingVideo.
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
 */
export async function analyzeVideoForCandidate(threadId, videoPath) {
  try {
    const absPath = path.resolve(videoPath);
    const videoBuffer = fs.readFileSync(absPath);
    const base64Video = videoBuffer.toString("base64");

    const ext = path.extname(absPath).toLowerCase();
    const mimeMap = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
    const mimeType = mimeMap[ext] || "video/mp4";

    const model = getGeminiModel();
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
