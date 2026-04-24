const PptxGenJS = require("pptxgenjs");

const prs = new PptxGenJS();
prs.layout = "LAYOUT_WIDE";

// ── Theme colors
const BG     = "06060F";
const ACCENT = "00D4FF";
const GREEN  = "00FF88";
const PURPLE = "A855F7";
const MUTED  = "64748B";
const WHITE  = "FFFFFF";
const DANGER = "FF4757";

function addBg(slide) {
  slide.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: "100%", h: "100%",
    fill: { color: BG },
    line: { color: BG },
  });
}

function label(slide, text, y = 0.4) {
  slide.addText(text, {
    x: 0.6, y, w: 12, h: 0.3,
    fontSize: 9, bold: true, color: ACCENT,
    charSpacing: 4, align: "left",
  });
}

// ────────────────────────────────────────────────────────────
// SLIDE 1 — Hero
// ────────────────────────────────────────────────────────────
{
  const s = prs.addSlide();
  addBg(s);
  label(s, "AI-POWERED RECRUITMENT PLATFORM");

  s.addText([
    { text: "Interview", options: { color: WHITE } },
    { text: "Assist", options: { color: ACCENT } },
  ], {
    x: 0.6, y: 0.9, w: 12, h: 1.8,
    fontSize: 72, bold: true, align: "center",
  });

  s.addText("A fully autonomous end-to-end hiring pipeline —\nfrom resume drop to scheduled interview, powered by Agentic AI.",
    { x: 1.5, y: 2.8, w: 10, h: 0.9, fontSize: 16, color: MUTED, align: "center" });

  const pills = [
    ["🤖 MCP Tool Calling", ACCENT],
    ["🎥 Gemini Vision", GREEN],
    ["⚡ Groq LLM", PURPLE],
    ["🗄️ pgvector RAG", "FFA500"],
    ["📧 IMAP Ingest", ACCENT],
    ["📅 Auto Scheduler", GREEN],
  ];
  const pillW = 1.9;
  const startX = (13.33 - pills.length * (pillW + 0.15)) / 2;
  pills.forEach(([text, color], i) => {
    s.addText(text, {
      x: startX + i * (pillW + 0.15), y: 4.0, w: pillW, h: 0.38,
      fontSize: 10, color, bold: true, align: "center",
      fill: { color: BG },
      line: { color, width: 1 },
      margin: [4, 8, 4, 8],
    });
  });

  s.addNotes("Welcome everyone. Today I'll walk you through InterviewAssist — an AI-powered hiring platform that automates the full recruitment pipeline, from resume intake all the way to scheduled interviews.");
}

// ────────────────────────────────────────────────────────────
// SLIDE 2 — Problem / Solution
// ────────────────────────────────────────────────────────────
{
  const s = prs.addSlide();
  addBg(s);
  label(s, "WHY INTERVIEWASSIST");

  s.addText([
    { text: "Traditional Hiring is ", options: { color: WHITE } },
    { text: "Broken", options: { color: ACCENT } },
  ], { x: 0.6, y: 0.7, w: 12, h: 0.8, fontSize: 36, bold: true });

  const pains = [
    "Hundreds of resumes screened manually",
    "No structured scoring for video interviews",
    "Interviewer-candidate skill mismatch undetected",
    "Scheduling back-and-forth over emails",
    "No audit trail or data-driven decisions",
  ];
  const sols = [
    "AI pipeline screens & scores resumes automatically",
    "Gemini Vision analyzes fluency, skills & confidence",
    "Skill-aware matching with HR approval workflow",
    "Automated slot booking, tokens & confirmation emails",
    "Full candidate lifecycle tracked in one dashboard",
  ];

  // Left column header
  s.addText("✗  The Old Way", { x: 0.5, y: 1.6, w: 5.8, h: 0.4, fontSize: 14, bold: true, color: DANGER, fill: { color: "1A0608" }, line: { color: DANGER, width: 1 }, margin: [4,10,4,10] });
  pains.forEach((t, i) => {
    s.addText("✗  " + t, { x: 0.5, y: 2.1 + i * 0.62, w: 5.8, h: 0.52, fontSize: 11, color: MUTED, fill: { color: "110608" }, line: { color: "331015", width: 1 }, margin: [6, 10, 6, 10] });
  });

  // Right column header
  s.addText("✓  With InterviewAssist", { x: 6.9, y: 1.6, w: 6.0, h: 0.4, fontSize: 14, bold: true, color: GREEN, fill: { color: "06120A" }, line: { color: GREEN, width: 1 }, margin: [4,10,4,10] });
  sols.forEach((t, i) => {
    s.addText("✓  " + t, { x: 6.9, y: 2.1 + i * 0.62, w: 6.0, h: 0.52, fontSize: 11, color: MUTED, fill: { color: "06100A" }, line: { color: "0A3318", width: 1 }, margin: [6, 10, 6, 10] });
  });

  s.addNotes("The problem: recruiting teams are drowning in manual work. Hundreds of resumes, unscored video calls, skill mismatches they never catch, and endless email chains to book a single interview slot. InterviewAssist eliminates all of that.");
}

// ────────────────────────────────────────────────────────────
// SLIDE 3 — Feature Pipeline
// ────────────────────────────────────────────────────────────
{
  const s = prs.addSlide();
  addBg(s);
  label(s, "AGENTIC AI PIPELINE WITH MCP TOOL CALLING");

  s.addText([
    { text: "LLMs autonomously ", options: { color: ACCENT } },
    { text: "call tools", options: { color: GREEN } },
  ], { x: 0.6, y: 0.65, w: 12, h: 0.7, fontSize: 32, bold: true });

  const steps = [
    { icon: "📥", label: "Resume Intake",   sub: "Drop folder, careers portal, IMAP email" },
    { icon: "🧠", label: "AI Screening",    sub: "LLM calls analyze_resume via MCP" },
    { icon: "🎥", label: "Video Analysis",  sub: "Gemini Vision: fluency, skills, confidence" },
    { icon: "📅", label: "Smart Scheduling",sub: "LLM calls schedule_candidate autonomously" },
    { icon: "✅", label: "Outcome",         sub: "LLM calls send_invite with audit trail" },
  ];
  const stepW = 2.3;
  const gap   = 0.22;
  const startX = (13.33 - steps.length * stepW - (steps.length - 1) * gap) / 2;
  steps.forEach((st, i) => {
    const x = startX + i * (stepW + gap);
    s.addShape(prs.ShapeType.rect, { x, y: 1.5, w: stepW, h: 1.55, fill: { color: "0D0D1A" }, line: { color: "1A1A2E", width: 1 } });
    s.addText(st.icon,  { x, y: 1.58, w: stepW, h: 0.45, fontSize: 22, align: "center" });
    s.addText(st.label, { x, y: 2.05, w: stepW, h: 0.38, fontSize: 11, bold: true, color: WHITE, align: "center" });
    s.addText(st.sub,   { x, y: 2.43, w: stepW, h: 0.52, fontSize: 8.5, color: MUTED, align: "center" });
    if (i < steps.length - 1) {
      s.addText("→", { x: x + stepW, y: 2.1, w: gap + 0.02, h: 0.4, fontSize: 16, color: ACCENT, align: "center" });
    }
  });

  const feats = [
    { icon: "🔍", title: "RAG-based JD Matching",  body: "Embeddings (Ollama/OpenAI) chunk JDs into pgvector for semantic resume-to-role matching" },
    { icon: "👥", title: "HR Approval Panel",       body: "When no high-skill interviewer is available, admin reviews AI suggestions & approves" },
    { icon: "🔐", title: "OTP Interviewer Login",   body: "Interviewers authenticate via one-time email OTP with calendar & slot management" },
    { icon: "🤖", title: "MCP Tool Protocol",       body: "LLMs autonomously call 9 specialized tools: analyze_resume, send_invite, schedule_candidate…" },
  ];
  const fw = 2.9;
  feats.forEach((f, i) => {
    const x = 0.5 + i * (fw + 0.28);
    s.addShape(prs.ShapeType.rect, { x, y: 3.25, w: fw, h: 1.45, fill: { color: "0D0D1A" }, line: { color: "1A1A2E", width: 1 } });
    s.addText(f.icon + "  " + f.title, { x: x + 0.1, y: 3.33, w: fw - 0.2, h: 0.38, fontSize: 11, bold: true, color: WHITE });
    s.addText(f.body, { x: x + 0.1, y: 3.72, w: fw - 0.2, h: 0.9, fontSize: 8.5, color: MUTED });
  });

  s.addNotes("Here's how it works. Every resume flows through a 5-stage AI pipeline. Each stage is an LLM autonomously calling a specialized MCP tool — no human in the loop until HR review is needed. The system also does semantic JD matching using vector embeddings.");
}

// ────────────────────────────────────────────────────────────
// SLIDE 4 — Tech Stack
// ────────────────────────────────────────────────────────────
{
  const s = prs.addSlide();
  addBg(s);
  label(s, "TECHNOLOGY STACK");

  s.addText([
    { text: "Built on ", options: { color: WHITE } },
    { text: "Modern AI Infrastructure", options: { color: PURPLE } },
  ], { x: 0.6, y: 0.65, w: 12, h: 0.7, fontSize: 32, bold: true });

  const cols = [
    {
      heading: "🤖  AI & Agents",
      items: [
        ["LangGraph.js",   "Stateful agent pipeline"],
        ["Groq LLM",       "Resume scoring & scheduling"],
        ["Gemini Vision",  "Video analysis"],
        ["Ollama / OpenAI","Text embeddings"],
        ["MCP SDK",        "Tool-use protocol"],
      ],
    },
    {
      heading: "🗄️  Data & Storage",
      items: [
        ["PostgreSQL",            "Primary datastore"],
        ["pgvector",              "Vector similarity search"],
        ["LangGraph Checkpoint",  "Agent state persistence"],
        ["File Watcher",          "CV drop folder (chokidar)"],
      ],
    },
    {
      heading: "🌐  Backend & Infra",
      items: [
        ["Node.js + Express",    "REST API server"],
        ["Pug Templates",        "Server-side UI rendering"],
        ["Nodemailer + IMAP",    "Email send & ingest"],
        ["Docker",               "Containerized deployment"],
        ["Session Auth + bcrypt","Secure admin access"],
      ],
    },
  ];

  const colW = 4.0;
  cols.forEach((col, ci) => {
    const x = 0.5 + ci * (colW + 0.4);
    s.addText(col.heading, { x, y: 1.55, w: colW, h: 0.38, fontSize: 10, bold: true, color: MUTED, charSpacing: 2 });
    col.items.forEach((item, ri) => {
      const y = 2.05 + ri * 0.72;
      s.addShape(prs.ShapeType.rect, { x, y, w: colW, h: 0.62, fill: { color: "0D0D1A" }, line: { color: "1A1A2E", width: 1 } });
      s.addText(item[0], { x: x + 0.12, y: y + 0.06, w: colW - 0.2, h: 0.26, fontSize: 11.5, bold: true, color: WHITE });
      s.addText(item[1], { x: x + 0.12, y: y + 0.32, w: colW - 0.2, h: 0.22, fontSize: 9,    color: MUTED });
    });
  });

  s.addNotes("The platform is built entirely on open standards. LangGraph manages the agent state machine. Groq gives us ultra-fast LLM inference. Gemini Vision handles video. pgvector enables semantic search. Everything runs on Node.js and can be containerized with Docker.");
}

// ────────────────────────────────────────────────────────────
// SLIDE 5 — 8 Agents
// ────────────────────────────────────────────────────────────
{
  const s = prs.addSlide();
  addBg(s);
  label(s, "AUTONOMOUS AI AGENTS");

  s.addText([
    { text: "8 agents, ", options: { color: ACCENT } },
    { text: "zero manual steps", options: { color: GREEN } },
  ], { x: 0.6, y: 0.65, w: 12, h: 0.7, fontSize: 32, bold: true });

  const agents = [
    { icon: "📁", name: "CV Watcher",            desc: "Monitors drop folder, triggers LangGraph pipeline" },
    { icon: "📧", name: "Email Ingest Agent",     desc: "Polls IMAP inbox, extracts & routes resumes" },
    { icon: "🎥", name: "Video Analysis Agent",   desc: "Whisper transcription + Gemini Vision scoring" },
    { icon: "🧠", name: "Resume Scoring Agent",   desc: "RAG + pgvector + Groq LLM analysis" },
    { icon: "🎯", name: "Interview Matcher",      desc: "AI skill-match pairing via MCP tool call" },
    { icon: "📅", name: "Auto-Scheduler Agent",   desc: "Books slots, routes low-matches to HR approval" },
    { icon: "💌", name: "Email Sending Agent",    desc: "Invitations, rejections & confirmations" },
    { icon: "📬", name: "Bulk Outcome Worker",    desc: "Daily bulk email at configured time with buffer" },
  ];

  const cols = 4;
  const cardW = 2.95, cardH = 1.0;
  const gapX = 0.3, gapY = 0.24;
  const startX = (13.33 - cols * cardW - (cols - 1) * gapX) / 2;

  agents.forEach((a, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cardW + gapX);
    const y = 1.55 + row * (cardH + gapY);
    s.addShape(prs.ShapeType.rect, { x, y, w: cardW, h: cardH, fill: { color: "0D0D1A" }, line: { color: "1A1A2E", width: 1 } });
    s.addText(a.icon + "  " + a.name, { x: x + 0.12, y: y + 0.1, w: cardW - 0.2, h: 0.35, fontSize: 11.5, bold: true, color: WHITE });
    s.addText(a.desc, { x: x + 0.12, y: y + 0.46, w: cardW - 0.2, h: 0.42, fontSize: 9.5, color: MUTED });
  });

  s.addNotes("There are 8 background agents running continuously. Each one is responsible for a specific stage. Critically, they don't just execute scripts — they're LLM agents making decisions: routing, scoring, matching, and escalating when confidence is low.");
}

// ────────────────────────────────────────────────────────────
// SLIDE 6 — Closing
// ────────────────────────────────────────────────────────────
{
  const s = prs.addSlide();
  addBg(s);
  label(s, "AGENTIC AI IMPACT & SUMMARY");

  s.addText([
    { text: "One platform.\n", options: { color: WHITE } },
    { text: "LLMs autonomously call tools.", options: { color: ACCENT } },
  ], { x: 0.6, y: 0.7, w: 12, h: 1.2, fontSize: 34, bold: true, align: "center" });

  const stats = [
    { num: "100%", lbl: "Automated Resume Screening" },
    { num: "9",    lbl: "MCP Tools Available" },
    { num: "0",    lbl: "Manual Scheduling Steps" },
    { num: "∞",    lbl: "Interviews Scalable" },
  ];
  const sw = 2.7;
  const sx = (13.33 - stats.length * sw - 3 * 0.3) / 2;
  stats.forEach((st, i) => {
    const x = sx + i * (sw + 0.3);
    s.addShape(prs.ShapeType.rect, { x, y: 2.05, w: sw, h: 1.25, fill: { color: "0D0D1A" }, line: { color: "1A1A2E", width: 1 } });
    s.addText(st.num, { x, y: 2.12, w: sw, h: 0.65, fontSize: 38, bold: true, color: ACCENT, align: "center" });
    s.addText(st.lbl, { x, y: 2.78, w: sw, h: 0.42, fontSize: 9.5, color: MUTED, align: "center" });
  });

  const pills = ["MCP Tool Calling", "Gemini Vision", "Groq LLM", "pgvector RAG", "IMAP Auto-Ingest", "Smart Scheduling", "HR Approval Panel", "Agentic AI"];
  const colors = [ACCENT, GREEN, PURPLE, "FFA500", ACCENT, GREEN, PURPLE, "FFA500"];
  const pw = 1.52;
  pills.forEach((p, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const px = (13.33 - 4 * pw - 3 * 0.2) / 2 + col * (pw + 0.2);
    const py = 3.52 + row * 0.52;
    s.addText(p, { x: px, y: py, w: pw, h: 0.36, fontSize: 9, bold: true, color: colors[i], align: "center", fill: { color: BG }, line: { color: colors[i], width: 1 } });
  });

  s.addText("InterviewAssist brings together the best of modern AI to eliminate hiring inefficiencies — so teams can focus on what matters: finding the right people.",
    { x: 1.5, y: 4.7, w: 10, h: 0.7, fontSize: 13, color: MUTED, align: "center" });

  s.addNotes("To summarize: 100% automated screening, 9 MCP tools, zero manual scheduling, and infinitely scalable. InterviewAssist turns your hiring process into an autonomous pipeline — from resume drop to confirmed interview — so your team focuses on people, not paperwork. Thank you.");
}

// ── Write file
prs.writeFile({ fileName: "InterviewAssist-Presentation.pptx" })
  .then(() => console.log("✓ InterviewAssist-Presentation.pptx generated"))
  .catch(err => { console.error(err); process.exit(1); });
