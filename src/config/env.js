const REQUIRED_VARS = ["GROQ_API_KEY", "PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"];

export function validateEnv() {
  const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!process.env.GOOGLE_API_KEY) {
    console.warn("GOOGLE_API_KEY not set — video analysis (Gemini) will be unavailable");
  }
}

export const PORT = parseInt(process.env.PORT || "3000", 10);

export const INTERVIEW_QUESTION =
  "Record a 2–3 minute video introducing yourself, discussing your relevant " +
  "experience, and explaining why you're interested in this position. " +
  "Focus on demonstrating your technical knowledge and communication skills.";
