import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

/** Ensure a value is a proper Node Buffer (survives checkpoint serialisation). */
export function toBuffer(val) {
  if (Buffer.isBuffer(val)) return val;
  if (val?.type === "Buffer" && Array.isArray(val.data)) return Buffer.from(val.data);
  if (typeof val === "string") return Buffer.from(val, "base64");
  return Buffer.from(val);
}

/** Extract JSON from an LLM response that may contain Markdown fences. */
export function parseJSON(text) {
  const str = typeof text === "string" ? text : String(text);
  try { return JSON.parse(str); } catch { /* continue */ }
  const fenced = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
  const obj = str.match(/\{[\s\S]*\}/);
  if (obj) try { return JSON.parse(obj[0]); } catch { /* continue */ }
  throw new Error("Failed to parse JSON from LLM response: " + str.slice(0, 200));
}

/** Retry a function up to `maxRetries` times on 429 (rate-limit) errors. */
export async function callWithRetry(fn, maxRetries = 3) {
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

/** Groq chat model for text/reasoning tasks. */
export function getGroqModel() {
  return new ChatGroq({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    apiKey: process.env.GROQ_API_KEY,
  });
}

/** Gemini model for multimodal (video) analysis. */
export function getGeminiModel() {
  return new ChatGoogleGenerativeAI({ model: "gemini-2.5-pro", temperature: 0 });
}
