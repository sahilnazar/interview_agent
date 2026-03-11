import OpenAI from "openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { query } from "../config/db.js";

// ─── Provider helpers ────────────────────────────────────────────────────

async function getSettings() {
  const res = await query("SELECT key, value FROM settings WHERE key IN ('embedding_provider', 'ollama_base_url')");
  const map = {};
  for (const r of res.rows) map[r.key] = r.value;
  return {
    provider: map.embedding_provider || "ollama",
    ollamaUrl: map.ollama_base_url || "http://localhost:11434",
  };
}

let openai;
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

async function embedOpenAI(text) {
  const client = getOpenAIClient();
  if (!client) return null;
  const res = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

async function embedOllama(text, baseUrl) {
  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama embedding failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.embedding;
}

async function embedText(text) {
  const { provider, ollamaUrl } = await getSettings();
  if (provider === "openai") return embedOpenAI(text);
  return embedOllama(text, ollamaUrl);
}

// ─── Splitter ────────────────────────────────────────────────────────────

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 100,
});

// ─── Public API ──────────────────────────────────────────────────────────

export { embedText };

// In-memory embed job status per interview
const embedJobs = new Map();

export function getEmbedStatus(interviewId) {
  return embedJobs.get(interviewId) || { status: 'idle', logs: [] };
}

export async function storeJDChunks(interviewId, jdText) {
  if (!jdText || !jdText.trim()) return;

  const { provider } = await getSettings();
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    embedJobs.set(interviewId, { status: 'error', logs: ['OPENAI_API_KEY not set — skipping JD embedding'] });
    return;
  }

  const job = { status: 'running', logs: [`Starting JD embedding with ${provider}...`] };
  embedJobs.set(interviewId, job);

  try {
    // Remove old chunks (may have different dimension from previous provider)
    await query("DELETE FROM jd_chunks WHERE interview_id = $1", [interviewId]);
    job.logs.push('Cleared old chunks');

    const chunks = await splitter.splitText(jdText);
    job.logs.push(`Split JD into ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      job.logs.push(`Embedding chunk ${i + 1}/${chunks.length}...`);
      const embedding = await embedText(chunks[i]);
      if (!embedding) { job.logs.push(`Chunk ${i + 1} returned null — skipped`); continue; }
      const pgVector = `[${embedding.join(",")}]`;
      await query(
        "INSERT INTO jd_chunks (interview_id, chunk_text, embedding) VALUES ($1, $2, $3::vector)",
        [interviewId, chunks[i], pgVector]
      );
      job.logs.push(`Chunk ${i + 1}/${chunks.length} stored (${embedding.length}-d)`);
    }

    job.status = 'done';
    job.logs.push(`✔ All ${chunks.length} chunks embedded successfully (${provider})`);
    console.log(`Stored ${chunks.length} JD chunks (${provider}) for interview ${interviewId}`);
  } catch (err) {
    job.status = 'error';
    job.logs.push(`✖ Error: ${err.message}`);
    console.error('JD embed error:', err.message);
  }
}

export async function retrieveRelevantChunks(interviewId, queryText, topK = 5) {
  const { provider } = await getSettings();
  if (provider === "openai" && !process.env.OPENAI_API_KEY) return [];

  const embedding = await embedText(queryText);
  if (!embedding) return [];
  const pgVector = `[${embedding.join(",")}]`;

  const result = await query(
    `SELECT chunk_text, 1 - (embedding <=> $1::vector) AS similarity
     FROM jd_chunks
     WHERE interview_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [pgVector, interviewId, topK]
  );

  return result.rows.map((r) => r.chunk_text);
}
