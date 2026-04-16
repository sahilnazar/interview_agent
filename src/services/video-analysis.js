/**
 * Dual video analysis service:
 *  1. Groq Whisper (whisper-large-v3) — audio transcription
 *  2. Gemini 2.5 Flash (File API)     — visual + behavioural analysis
 */
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ─── 1. Groq Whisper — Audio Transcription ───────────────────────────────────

/**
 * Transcribe the audio track of a video file using Groq Whisper.
 * WebM and MP4 containers are supported directly (no ffmpeg needed).
 */
export async function transcribeWithWhisper(videoPath) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY not set");

  const groqClient = new OpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: GROQ_API_KEY,
  });

  const transcription = await groqClient.audio.transcriptions.create({
    file: fs.createReadStream(videoPath),
    model: "whisper-large-v3",
    language: "en",
    response_format: "json",
  });

  return transcription.text || "";
}

// ─── 2. Gemini 2.5 Flash — Visual + Behavioural Analysis ─────────────────────

function compactTranscript(transcript = "", limit = 900) {
  return transcript.replace(/\s+/g, " ").trim().slice(0, limit);
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildFallbackAnalysis(transcript = "") {
  const excerpt = compactTranscript(transcript, 140);
  return {
    englishScore: excerpt ? 5 : 0,
    confidenceScore: excerpt ? 5 : 0,
    skills: [],
    salaryExpectation: "Not mentioned",
    fitVerdict: "unclear",
    fitReason: "Fallback result used due to limited model response.",
    summary: excerpt
      ? "Transcript captured. Visual scoring used a safe fallback because Gemini was temporarily busy."
      : "Video uploaded, but AI analysis is temporarily delayed due to model capacity.",
  };
}

function parseGeminiJsonResponse(data, transcript = "") {
  const rawText = extractGeminiText(data);
  if (!rawText) {
    console.warn("[Gemini] Empty response payload; using safe fallback");
    return buildFallbackAnalysis(transcript);
  }

  const cleaned = rawText.replace(/```json/gi, "```").replace(/```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  console.warn("[Gemini] Non-JSON response; using text fallback:", cleaned.slice(0, 200));
  return buildFallbackAnalysis(transcript);
}

async function uploadVideoToGemini(videoPath) {
  const videoBuffer = fs.readFileSync(videoPath);
  const ext = path.extname(videoPath).toLowerCase();
  const mimeMap = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
  const mimeType = mimeMap[ext] || "video/webm";
  const displayName = path.basename(videoPath);

  // Step 1 — Initiate resumable upload
  const initRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(videoBuffer.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    }
  );
  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`Gemini File API init failed: ${initRes.status} ${text}`);
  }

  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("No upload URL from Gemini File API");

  // Step 2 — Upload video bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(videoBuffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: videoBuffer,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Gemini File upload failed: ${uploadRes.status} ${text}`);
  }

  const fileData = await uploadRes.json();

  // The API sometimes wraps the file in { file: {...} } and sometimes returns it directly
  const fileObj = fileData.file || fileData;

  if (!fileObj || !fileObj.name) {
    throw new Error(`Gemini File API returned unexpected response: ${JSON.stringify(fileData).slice(0, 300)}`);
  }

  console.log(`[Gemini] File uploaded: name=${fileObj.name} state=${fileObj.state} uri=${fileObj.uri}`);
  return fileObj;
}

async function waitForGeminiFile(fileName, maxWaitMs = 120000) {
  if (!fileName) throw new Error("Gemini file name is undefined — upload may have failed");

  // Ensure the name has the 'files/' prefix
  const resourceName = fileName.startsWith("files/") ? fileName : `files/${fileName}`;

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${resourceName}?key=${GOOGLE_API_KEY}`
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to poll file state: ${res.status} — ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    console.log(`[Gemini] File state: ${data.state}`);
    if (data.state === "ACTIVE") return data;
    if (data.state === "FAILED") throw new Error("Gemini file processing failed");
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("Gemini file processing timed out after 120s");
}

async function deleteGeminiFile(fileName) {
  try {
    const resourceName = fileName.startsWith("files/") ? fileName : `files/${fileName}`;
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${resourceName}?key=${GOOGLE_API_KEY}`,
      { method: "DELETE" }
    );
  } catch { /* best-effort cleanup */ }
}

/**
 * Analyse candidate video using Gemini 2.5 Flash via the File API.
 * Keeps the prompt compact to minimize free-tier token usage.
 */
export async function analyzeWithGeminiFlash(videoPath, transcript = "", roleContext = {}) {
  if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set");

  const file = await uploadVideoToGemini(videoPath);
  const activeFile = await waitForGeminiFile(file.name);

  const transcriptExcerpt = compactTranscript(transcript, 900);
  const transcriptLine = transcriptExcerpt
    ? `Transcript excerpt: "${transcriptExcerpt}"\n`
    : "";
  const requiredSkills = compactTranscript(roleContext.requiredSkills || "", 250);
  const salaryRange = compactTranscript(roleContext.salaryRange || "", 120);
  const roleLine =
    `Role required skills: ${requiredSkills || "Not provided"}.\n` +
    `Target salary range: ${salaryRange || "Not provided"}.\n`;

  const prompt =
    `Evaluate this short interview video for a Tell me about yourself response.\n` +
    roleLine +
    transcriptLine +
    `Return exactly one JSON object with only these keys: englishScore, confidenceScore, skills, salaryExpectation, fitVerdict, fitReason, summary. ` +
    `fitVerdict must be one of: match, mismatch, unclear. Keep skills to max 5 short items and summary under 160 chars.\n` +
    `{"englishScore":1,"confidenceScore":1,"skills":["skill1"],"salaryExpectation":"Not mentioned","fitVerdict":"match","fitReason":"brief reason","summary":"brief summary"}`;

  let geminiResult = null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`;
    const requestBody = JSON.stringify({
      contents: [{
        parts: [
          { file_data: { mime_type: activeFile.mimeType, file_uri: activeFile.uri } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 220,
        responseMimeType: "application/json",
      },
    });

    let data = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });

      if (res.ok) {
        data = await res.json();
        break;
      }

      const text = await res.text();
      if ((res.status === 429 || res.status === 503) && attempt < 2) {
        const waitMs = 2000 * (attempt + 1);
        console.warn(`[Gemini] Temporary ${res.status}; retrying in ${waitMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (res.status === 429 || res.status === 503) {
        console.warn(`[Gemini] Model unavailable after retries; using fallback. ${text.slice(0, 200)}`);
        geminiResult = buildFallbackAnalysis(transcriptExcerpt);
        break;
      }

      throw new Error(`Gemini generateContent failed: ${res.status} ${text}`);
    }

    if (!geminiResult) {
      geminiResult = parseGeminiJsonResponse(data, transcriptExcerpt);
    }
  } finally {
    await deleteGeminiFile(activeFile.name);
  }

  return geminiResult;
}

// ─── 3. Combined Analysis ─────────────────────────────────────────────────────

/**
 * Run both agents on the video and return a merged result.
 * Falls back gracefully if either agent fails.
 */
export async function analyzeCandidateVideo(videoPath, roleContext = {}) {
  let transcript = "";
  let whisperError = null;

  // Stage A — Groq Whisper transcription
  try {
    console.log("[VideoAnalysis] Starting Groq Whisper transcription...");
    transcript = await transcribeWithWhisper(videoPath);
    console.log(`[VideoAnalysis] Whisper transcript (${transcript.length} chars)`);
  } catch (err) {
    whisperError = err.message;
    console.warn("[VideoAnalysis] Whisper failed (continuing without transcript):", err.message);
  }

  // Stage B — Gemini 2.5 Flash visual + behavioural analysis
  console.log("[VideoAnalysis] Starting Gemini 2.5 Flash analysis...");
  const gemini = await analyzeWithGeminiFlash(videoPath, transcript, roleContext);

  return {
    englishScore: typeof gemini.englishScore === "number" ? gemini.englishScore : 0,
    confidenceScore: typeof gemini.confidenceScore === "number" ? gemini.confidenceScore : 0,
    skills: Array.isArray(gemini.skills) ? gemini.skills.slice(0, 5).map((s) => String(s).trim()).filter(Boolean) : [],
    salaryExpectation: typeof gemini.salaryExpectation === "string" ? gemini.salaryExpectation.trim() : "",
    fitVerdict: typeof gemini.fitVerdict === "string" ? gemini.fitVerdict.trim().toLowerCase() : "unclear",
    fitReason: typeof gemini.fitReason === "string" ? gemini.fitReason.trim() : "",
    summary: typeof gemini.summary === "string" ? gemini.summary : "",
    transcript,
    whisperError,
  };
}
