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
const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    englishScore: { type: "NUMBER" },
    confidenceScore: { type: "NUMBER" },
    skills: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    salaryExpectation: { type: "STRING" },
    fitVerdict: { type: "STRING", enum: ["match", "mismatch", "unclear"] },
    fitReason: { type: "STRING" },
    summary: { type: "STRING" },
  },
  required: [
    "englishScore",
    "confidenceScore",
    "skills",
    "salaryExpectation",
    "fitVerdict",
    "fitReason",
    "summary",
  ],
};

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

  const cleanText = (value = "") => value.replace(/\s+/g, " ").trim();
  const scoreTranscript = (value = "") => {
    const cleaned = cleanText(value);
    if (!cleaned) return 0;

    const words = cleaned.match(/[a-zA-Z][a-zA-Z'.-]*/g) || [];
    const unique = new Set(words.map((word) => word.toLowerCase()));
    const veryShortPenalty = cleaned.length < 24 ? 8 : 0;

    return (words.length * 2) + unique.size + Math.min(cleaned.length / 18, 10) - veryShortPenalty;
  };

  const transcribeOnce = async (options = {}) => {
    const response = await groqClient.audio.transcriptions.create({
      file: fs.createReadStream(videoPath),
      model: "whisper-large-v3",
      response_format: "verbose_json",
      ...options,
    });
    return cleanText(response?.text || "");
  };

  const firstPass = await transcribeOnce({
    language: "en",
    temperature: 0,
  });

  // Retry with interview-specific prompt if transcript looks too short/weak.
  const needsRetry = scoreTranscript(firstPass) < 18;
  if (!needsRetry) return firstPass;

  const secondPass = await transcribeOnce({
    temperature: 0,
    prompt: "Interview answer. Candidate may mention name, React, TypeScript, JavaScript, salary expectation. Transcribe exactly what is spoken.",
  });

  const firstScore = scoreTranscript(firstPass);
  const secondScore = scoreTranscript(secondPass);
  const selected = secondScore > firstScore ? secondPass : firstPass;

  console.log(
    `[Whisper] Multi-pass selected transcript: firstScore=${firstScore.toFixed(1)}, secondScore=${secondScore.toFixed(1)}`
  );

  return selected;
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

function extractFirstJsonObject(text = "") {
  const start = text.indexOf("{");
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return "";
}

function matchTextValue(text = "", pattern) {
  const match = text.match(pattern);
  return match ? match[1].trim() : "";
}

function parseGeminiTextFallback(text = "", transcript = "") {
  const englishScore = Number.parseFloat(matchTextValue(text, /englishScore\s*[:=]\s*"?([0-9.]+)/i));
  const confidenceScore = Number.parseFloat(matchTextValue(text, /confidenceScore\s*[:=]\s*"?([0-9.]+)/i));
  const salaryExpectation = matchTextValue(text, /salaryExpectation\s*[:=]\s*"?([^"\n,}]+)/i);
  const fitVerdict = matchTextValue(text, /fitVerdict\s*[:=]\s*"?([^"\n,}]+)/i).toLowerCase();
  const fitReason = matchTextValue(text, /fitReason\s*[:=]\s*"?([^"\n}]+)/i);
  const summary = matchTextValue(text, /summary\s*[:=]\s*"?([^"\n}]+)/i);
  const skillsBlock = matchTextValue(text, /skills\s*[:=]\s*\[([^\]]*)\]/i);
  const skills = skillsBlock
    .split(",")
    .map((skill) => skill.replace(/["']/g, "").trim())
    .filter(Boolean)
    .slice(0, 5);

  if (
    Number.isFinite(englishScore) ||
    Number.isFinite(confidenceScore) ||
    skills.length > 0 ||
    salaryExpectation ||
    fitVerdict ||
    fitReason ||
    summary
  ) {
    return {
      englishScore: Number.isFinite(englishScore) ? englishScore : (transcript ? 5 : 0),
      confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : (transcript ? 5 : 0),
      skills,
      salaryExpectation: salaryExpectation || "Not mentioned",
      fitVerdict: fitVerdict || "unclear",
      fitReason,
      summary: summary || "Recovered partial structured response from Gemini text output.",
      usedFallback: false,
    };
  }

  return null;
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
    usedFallback: true,
  };
}

function buildGeminiPrompt(transcript = "", roleContext = {}) {
  const transcriptExcerpt = compactTranscript(transcript, 900);
  const transcriptLine = transcriptExcerpt
    ? `Transcript excerpt: "${transcriptExcerpt}"\n`
    : "";
  const requiredSkills = compactTranscript(roleContext.requiredSkills || "", 250);
  const salaryRange = compactTranscript(roleContext.salaryRange || "", 120);
  const roleLine =
    `Role required skills: ${requiredSkills || "Not provided"}.\n` +
    `Target salary range: ${salaryRange || "Not provided"}.\n`;

  return (
    `Evaluate this short interview video for a Tell me about yourself response.\n` +
    roleLine +
    transcriptLine +
    `Return exactly one JSON object with only these keys: englishScore, confidenceScore, skills, salaryExpectation, fitVerdict, fitReason, summary. ` +
    `fitVerdict must be one of: match, mismatch, unclear. Keep skills to max 5 short items and summary under 160 chars.\n` +
    `{"englishScore":1,"confidenceScore":1,"skills":["skill1"],"salaryExpectation":"Not mentioned","fitVerdict":"match","fitReason":"brief reason","summary":"brief summary"}`
  );
}

async function requestGeminiAnalysis(parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`;
  const requestBody = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 320,
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESPONSE_SCHEMA,
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
      return null;
    }

    throw new Error(`Gemini generateContent failed: ${res.status} ${text}`);
  }

  return data;
}

function parseGeminiJsonResponse(data, transcript = "") {
  const rawText = extractGeminiText(data);
  if (!rawText) {
    console.warn("[Gemini] Empty response payload; using safe fallback");
    return buildFallbackAnalysis(transcript);
  }

  const cleaned = rawText.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const extractedJson = extractFirstJsonObject(cleaned);

  try {
    return JSON.parse(cleaned);
  } catch {}

  if (extractedJson) {
    try {
      return JSON.parse(extractedJson);
    } catch {}
  }

  const salvaged = parseGeminiTextFallback(cleaned, transcript);
  if (salvaged) {
    console.warn("[Gemini] Recovered analysis from non-JSON text response");
    return salvaged;
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
  const prompt = buildGeminiPrompt(transcript, roleContext);

  let geminiResult = null;
  try {
    const data = await requestGeminiAnalysis([
      { file_data: { mime_type: activeFile.mimeType, file_uri: activeFile.uri } },
      { text: prompt },
    ]);

    geminiResult = data ? parseGeminiJsonResponse(data, transcript) : buildFallbackAnalysis(transcript);
  } finally {
    await deleteGeminiFile(activeFile.name);
  }

  return geminiResult;
}

export async function analyzeTranscriptWithGeminiFlash(transcript = "", roleContext = {}) {
  if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set");
  const prompt = buildGeminiPrompt(transcript, roleContext);
  const data = await requestGeminiAnalysis([{ text: prompt }]);
  return data ? parseGeminiJsonResponse(data, transcript) : buildFallbackAnalysis(transcript);
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
    if (transcript) {
      console.log(`[VideoAnalysis] Whisper preview: ${transcript.slice(0, 180)}`);
    }
  } catch (err) {
    whisperError = err.message;
    console.warn("[VideoAnalysis] Whisper failed (continuing without transcript):", err.message);
  }

  // Stage B — Gemini 2.5 Flash visual + behavioural analysis
  console.log("[VideoAnalysis] Starting Gemini 2.5 Flash analysis...");
  let gemini = await analyzeWithGeminiFlash(videoPath, transcript, roleContext);

  if (gemini.usedFallback && transcript.trim().length >= 40) {
    try {
      console.warn("[VideoAnalysis] File-based Gemini response was unusable; retrying with transcript-only analysis...");
      const transcriptOnly = await analyzeTranscriptWithGeminiFlash(transcript, roleContext);
      if (!transcriptOnly.usedFallback) {
        gemini = transcriptOnly;
      }
    } catch (err) {
      console.warn("[VideoAnalysis] Transcript-only Gemini retry failed:", err.message || err);
    }
  }

  return {
    englishScore: typeof gemini.englishScore === "number" ? gemini.englishScore : 0,
    confidenceScore: typeof gemini.confidenceScore === "number" ? gemini.confidenceScore : 0,
    skills: Array.isArray(gemini.skills) ? gemini.skills.slice(0, 5).map((s) => String(s).trim()).filter(Boolean) : [],
    salaryExpectation: typeof gemini.salaryExpectation === "string" ? gemini.salaryExpectation.trim() : "",
    fitVerdict: typeof gemini.fitVerdict === "string" ? gemini.fitVerdict.trim().toLowerCase() : "unclear",
    fitReason: typeof gemini.fitReason === "string" ? gemini.fitReason.trim() : "",
    summary: typeof gemini.summary === "string" ? gemini.summary : "",
    usedFallback: gemini.usedFallback === true,
    transcript,
    whisperError,
  };
}
