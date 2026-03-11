import { query } from "../config/db.js";
import { embedText } from "./embeddings.js";
import { getGroqModel } from "../graph/helpers.js";
import { HumanMessage } from "@langchain/core/messages";
import { callWithRetry } from "../graph/helpers.js";

/**
 * Match a resume against all active interviews and return the best fit.
 *
 * Stage A: Embedding similarity — embed resume, compare against each interview's jd_chunks.
 * Stage B: LLM confirmation — send resume + top JD candidates to Groq for final pick.
 *
 * @param {string} resumeText — extracted text from the resume
 * @returns {Promise<{interviewId: string, confidence: number, title: string, rankedMatches: Array} | null>}
 */
export async function matchResumeToInterview(resumeText) {
  // Fetch all active interviews
  const interviews = await query(
    "SELECT id, title, jd, domain_filter FROM interviews WHERE status = 'active' ORDER BY created_at DESC"
  );
  if (!interviews.rows.length) {
    console.warn("Auto-match: No active interviews found");
    return null;
  }

  // Stage A: Embedding similarity
  const resumeEmbedding = await embedText(resumeText.slice(0, 2000));
  const scored = [];

  if (resumeEmbedding) {
    const pgVector = `[${resumeEmbedding.join(",")}]`;

    for (const interview of interviews.rows) {
      // Get average similarity against this interview's JD chunks
      const simResult = await query(
        `SELECT AVG(1 - (embedding <=> $1::vector)) AS avg_sim, COUNT(*) AS cnt
         FROM jd_chunks WHERE interview_id = $2`,
        [pgVector, interview.id]
      ).catch(() => ({ rows: [{ avg_sim: null, cnt: 0 }] }));

      const row = simResult.rows[0];
      if (row.cnt > 0 && row.avg_sim != null) {
        scored.push({
          interviewId: interview.id,
          title: interview.title,
          jd: interview.jd,
          domainFilter: interview.domain_filter,
          similarity: parseFloat(row.avg_sim),
        });
      }
    }
  }

  // Sort by similarity descending
  scored.sort((a, b) => b.similarity - a.similarity);

  // If no embeddings available, fall back to all interviews for LLM
  const candidates = scored.length > 0
    ? scored.slice(0, 3)
    : interviews.rows.slice(0, 3).map((r) => ({
        interviewId: r.id,
        title: r.title,
        jd: r.jd,
        domainFilter: r.domain_filter,
        similarity: 0,
      }));

  // Stage B: LLM confirmation
  const positionList = candidates
    .map((c, i) => `Position ${i + 1}: "${c.title}"\nJD Summary: ${c.jd.slice(0, 500)}`)
    .join("\n\n");

  const prompt = `You are an expert recruiter. Given the resume below and the open positions, pick the BEST matching position.

RESUME (first 2000 chars):
${resumeText.slice(0, 2000)}

OPEN POSITIONS:
${positionList}

Respond ONLY with valid JSON — no markdown, no explanation:
{"position": <1-based index>, "confidence": <0-100>, "reason": "<one sentence>"}`;

  try {
    const model = getGroqModel();
    const response = await callWithRetry(() =>
      model.invoke([new HumanMessage(prompt)])
    );

    const raw = response.content.replace(/```json\s*|```/g, "").trim();
    const parsed = JSON.parse(raw);
    const idx = (parsed.position || 1) - 1;
    const match = candidates[Math.min(idx, candidates.length - 1)];

    const confidence = Math.min(100, Math.max(0, parsed.confidence || 0));

    console.log(`Auto-match: "${match.title}" (confidence: ${confidence}%) — ${parsed.reason}`);

    return {
      interviewId: match.interviewId,
      title: match.title,
      domainFilter: match.domainFilter,
      confidence,
      reason: parsed.reason,
      rankedMatches: candidates.map((c) => ({
        interviewId: c.interviewId,
        title: c.title,
        similarity: c.similarity,
      })),
    };
  } catch (err) {
    console.error("Auto-match LLM error:", err.message);
    // Fall back to highest embedding similarity
    if (scored.length > 0) {
      const best = scored[0];
      const confidence = Math.round(best.similarity * 100);
      console.log(`Auto-match fallback (embedding only): "${best.title}" (${confidence}%)`);
      return {
        interviewId: best.interviewId,
        title: best.title,
        domainFilter: best.domainFilter,
        confidence,
        reason: "LLM unavailable — matched by embedding similarity",
        rankedMatches: scored.slice(0, 3).map((c) => ({
          interviewId: c.interviewId,
          title: c.title,
          similarity: c.similarity,
        })),
      };
    }
    return null;
  }
}
