const puppeteer = require("puppeteer");
const path = require("path");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800;900&family=Fira+Code:wght@400;500&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#ffffff;color:#1e293b;font-size:14px;line-height:1.7}

/* ── PAGE SHELL ── */
.page{width:210mm;min-height:297mm;padding:14mm 16mm;page-break-after:always;position:relative;overflow:hidden}
.page:last-child{page-break-after:avoid}

/* ── COVER ── */
.cover{background:linear-gradient(145deg,#0f172a 0%,#1e1b4b 45%,#0f172a 100%);color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:20mm}
.cover-pill{background:rgba(99,102,241,.25);border:1px solid #6366f1;color:#a5b4fc;font-size:10px;letter-spacing:3px;text-transform:uppercase;padding:5px 16px;border-radius:99px;margin-bottom:24px}
.cover h1{font-size:46px;font-weight:900;line-height:1.15;margin-bottom:14px;background:linear-gradient(135deg,#818cf8,#c084fc,#38bdf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.cover .sub{font-size:15px;color:#94a3b8;margin-bottom:36px;max-width:480px}
.cover-chips{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
.chip{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:8px 16px;font-size:12px;color:#cbd5e1;text-align:center}
.chip strong{display:block;font-size:15px;color:#fff;font-weight:700}

/* ── SECTION HEADER ── */
.sec-tag{font-size:9px;letter-spacing:3px;text-transform:uppercase;font-weight:700;margin-bottom:5px}
.sec-tag.purple{color:#6366f1}
.sec-tag.green{color:#10b981}
.sec-tag.blue{color:#0ea5e9}
.sec-tag.orange{color:#f59e0b}
.sec-tag.pink{color:#ec4899}
h2{font-size:26px;font-weight:900;color:#0f172a;margin-bottom:6px;line-height:1.2}
h3{font-size:16px;font-weight:800;color:#1e293b;margin:20px 0 8px}
h4{font-size:13px;font-weight:700;color:#374151;margin:12px 0 5px}
.lead{font-size:13.5px;color:#64748b;margin-bottom:18px;line-height:1.65}
.divider{height:1px;background:#f1f5f9;margin:18px 0}

/* ── ANALOGY BOX ── */
.analogy{background:linear-gradient(135deg,#ede9fe,#ddd6fe);border-left:4px solid #7c3aed;border-radius:0 10px 10px 0;padding:14px 18px;margin:14px 0}
.analogy .a-label{font-size:9px;letter-spacing:2px;text-transform:uppercase;font-weight:800;color:#7c3aed;margin-bottom:5px}
.analogy p{font-size:13px;color:#4c1d95;line-height:1.65}
.analogy strong{color:#3730a3}

/* ── HIGHLIGHT BOX ── */
.hbox{border-radius:10px;padding:14px 18px;margin:10px 0;font-size:13px;line-height:1.65}
.hbox.blue{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}
.hbox.green{background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d}
.hbox.yellow{background:#fffbeb;border:1px solid #fde68a;color:#78350f}
.hbox.red{background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d}
.hbox strong{font-weight:700}

/* ── CARDS ── */
.card-row{display:grid;gap:10px;margin:12px 0}
.card-row.col3{grid-template-columns:repeat(3,1fr)}
.card-row.col2{grid-template-columns:repeat(2,1fr)}
.card-row.col4{grid-template-columns:repeat(4,1fr)}
.card{border-radius:10px;padding:14px;border:1.5px solid #e2e8f0}
.card .c-icon{font-size:22px;margin-bottom:8px}
.card h4{font-size:12px;margin:0 0 5px}
.card p{font-size:11.5px;color:#64748b;line-height:1.55}
.card.purple{border-color:#a5b4fc;background:#eef2ff}
.card.green{border-color:#6ee7b7;background:#f0fdf4}
.card.yellow{border-color:#fcd34d;background:#fffbeb}
.card.pink{border-color:#f9a8d4;background:#fdf2f8}
.card.cyan{border-color:#67e8f9;background:#ecfeff}
.card.gray{border-color:#e2e8f0;background:#f8fafc}
.card.dark{border-color:#334155;background:#1e293b;color:#e2e8f0}
.card.dark h4{color:#a5b4fc}
.card.dark p{color:#94a3b8}

/* ── CODE BLOCK ── */
.code-box{background:#0f172a;border-radius:10px;overflow:hidden;margin:10px 0;font-size:11px}
.code-top{background:#1e293b;padding:6px 14px;display:flex;align-items:center;gap:6px}
.dot{width:9px;height:9px;border-radius:50%}
.dr{background:#ef4444}.dy{background:#f59e0b}.dg{background:#22c55e}
.fname{color:#64748b;font-size:10px;margin-left:4px;font-family:'Fira Code',monospace}
pre{padding:14px 16px;font-family:'Fira Code',monospace;line-height:1.65;color:#cbd5e1;white-space:pre-wrap;font-size:11px}
.kw{color:#c084fc}.fn{color:#38bdf8}.str{color:#86efac}.cm{color:#475569;font-style:italic}.num{color:#fb923c}.obj{color:#fde68a}.ty{color:#f472b6}

/* ── FLOW STEPS (numbered) ── */
.steps{display:flex;flex-direction:column;gap:0;margin:12px 0}
.step{display:flex;gap:12px;align-items:flex-start}
.step-left{display:flex;flex-direction:column;align-items:center;width:34px;flex-shrink:0}
.step-num{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff;flex-shrink:0}
.step-num.purple{background:linear-gradient(135deg,#6366f1,#8b5cf6)}
.step-num.green{background:linear-gradient(135deg,#10b981,#059669)}
.step-num.orange{background:linear-gradient(135deg,#f59e0b,#d97706)}
.step-num.pink{background:linear-gradient(135deg,#ec4899,#db2777)}
.step-num.blue{background:linear-gradient(135deg,#0ea5e9,#0284c7)}
.step-line{width:2px;flex:1;min-height:16px;background:linear-gradient(to bottom,#e2e8f0,transparent);margin-top:3px}
.step-body{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;flex:1;margin-bottom:8px}
.step-body h5{font-size:13px;font-weight:700;color:#1e293b;margin-bottom:3px}
.step-body p{font-size:12px;color:#64748b;line-height:1.6}
.step-body .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.tag{font-size:10px;padding:2px 8px;border-radius:4px;font-family:'Fira Code',monospace;font-weight:500}
.tag.purple{background:#eef2ff;color:#4f46e5}
.tag.green{background:#f0fdf4;color:#059669}
.tag.yellow{background:#fffbeb;color:#b45309}
.tag.pink{background:#fdf2f8;color:#be185d}
.tag.blue{background:#eff6ff;color:#1d4ed8}

/* ── BIG VISUAL FLOW (boxes + arrows) ── */
.visual-flow{display:flex;flex-direction:column;align-items:center;gap:0;margin:14px 0}
.vf-box{border-radius:12px;padding:12px 24px;text-align:center;min-width:200px;max-width:360px}
.vf-box h5{font-size:13px;font-weight:800;margin-bottom:2px}
.vf-box p{font-size:11px;opacity:.85}
.vf-box.start{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff}
.vf-box.process{background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff}
.vf-box.ai{background:linear-gradient(135deg,#10b981,#059669);color:#fff}
.vf-box.decision{background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border-radius:8px}
.vf-box.end{background:linear-gradient(135deg,#ec4899,#db2777);color:#fff}
.vf-arrow{font-size:20px;color:#94a3b8;line-height:1;margin:3px 0;text-align:center}
.vf-branch{display:flex;gap:16px;justify-content:center;align-items:flex-start;width:100%}
.vf-branch-item{display:flex;flex-direction:column;align-items:center;gap:0;flex:1}

/* ── TWO-COLUMN ── */
.col2-layout{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:12px 0}

/* ── MCP COMPARE ── */
.mcp-side{border-radius:12px;padding:16px;border:2px solid}
.mcp-side.local{border-color:#6366f1;background:#eef2ff}
.mcp-side.remote{border-color:#10b981;background:#f0fdf4}
.mcp-side h4{font-size:13px;font-weight:800;margin-bottom:8px}
.mcp-side.local h4{color:#4f46e5}
.mcp-side.remote h4{color:#059669}
.mcp-prop{display:flex;justify-content:space-between;font-size:11.5px;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.06)}
.mcp-prop:last-child{border:none}
.mcp-prop span{color:#64748b}
.mcp-prop strong{color:#1e293b;font-weight:600}

/* ── TABLE ── */
table{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0}
th{background:#f1f5f9;padding:9px 12px;text-align:left;font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:#64748b;font-weight:700;border-bottom:2px solid #e2e8f0}
td{padding:9px 12px;border-bottom:1px solid #f1f5f9;color:#374151;vertical-align:top}
tr:last-child td{border:none}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;font-family:'Fira Code',monospace}
.bg-purple{background:#eef2ff;color:#4f46e5}
.bg-green{background:#f0fdf4;color:#059669}
.bg-yellow{background:#fffbeb;color:#b45309}
.bg-pink{background:#fdf2f8;color:#be185d}
.bg-cyan{background:#ecfeff;color:#0e7490}
.bg-gray{background:#f1f5f9;color:#475569}

/* ── WIRE FORMAT ── */
.wire{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}
.wire-side{background:#0f172a;border-radius:10px;overflow:hidden}
.wire-head{background:#1e293b;padding:6px 12px;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700}
.wire-head.send{color:#38bdf8}
.wire-head.recv{color:#86efac}

/* ── ARCH DIAGRAM ── */
.arch{background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:18px;margin:12px 0}
.arch-row{display:flex;align-items:center;gap:8px;margin:4px 0}
.arch-box-sm{border-radius:8px;padding:6px 12px;font-size:11.5px;font-weight:700;white-space:nowrap}
.arch-box-sm.purple{background:#eef2ff;color:#4f46e5;border:1.5px solid #a5b4fc}
.arch-box-sm.green{background:#f0fdf4;color:#059669;border:1.5px solid #6ee7b7}
.arch-box-sm.yellow{background:#fffbeb;color:#b45309;border:1.5px solid #fcd34d}
.arch-box-sm.pink{background:#fdf2f8;color:#be185d;border:1.5px solid #f9a8d4}
.arch-box-sm.cyan{background:#ecfeff;color:#0e7490;border:1.5px solid #67e8f9}
.arch-box-sm.gray{background:#f1f5f9;color:#475569;border:1.5px solid #e2e8f0}
.arch-box-sm.dark{background:#1e293b;color:#e2e8f0;border:1.5px solid #334155}
.arch-arrow{color:#94a3b8;font-size:16px;font-weight:700}
.arch-label{font-size:10px;color:#94a3b8;font-style:italic}
.arch-section{margin:10px 0}
.arch-title{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;color:#94a3b8;margin-bottom:6px}

/* ── FOOTER ── */
.page-foot{position:absolute;bottom:10mm;left:16mm;right:16mm;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:6px}
</style>
</head>
<body>

<!-- ══════════════════════════════════════════
  COVER
══════════════════════════════════════════ -->
<div class="page cover">
  <div class="cover-pill">Architecture Guide · April 2026</div>
  <h1>InterviewAssist<br/>How It All Works</h1>
  <p class="sub">A step-by-step guide explaining the full system — from a candidate sending a resume to a calendar event being created — with real code examples. Written so a 15-year-old can follow along.</p>
  <div class="cover-chips">
    <div class="chip"><strong>2</strong>MCP Servers</div>
    <div class="chip"><strong>Ollama</strong>Local AI</div>
    <div class="chip"><strong>Groq</strong>Cloud LLM</div>
    <div class="chip"><strong>Gemini</strong>Video AI</div>
    <div class="chip"><strong>9</strong>Chapters</div>
    <div class="chip"><strong>PostgreSQL</strong>Database</div>
  </div>
</div>


<!-- ══════════════════════════════════════════
  CH1 · WHAT IS THIS SYSTEM
══════════════════════════════════════════ -->
<div class="page">
  <div class="sec-tag purple">Chapter 1</div>
  <h2>What Is This System?</h2>
  <p class="lead">A fully automated hiring assistant. When a candidate applies for a job, this system handles <em>everything</em> by itself — no human needs to click anything.</p>

  <div class="analogy">
    <div class="a-label">🎮 Video game analogy</div>
    <p>Imagine an RPG game where a new player (candidate) submits their character sheet (resume). The game engine automatically checks if the character is unique, rates their stats, sends them a quest (video interview), reviews the quest recording, finds the best dungeon boss (interviewer) to fight them, and locks in a battle time (calendar event). <strong>All automatically.</strong></p>
  </div>

  <div class="card-row col3" style="margin-top:14px">
    <div class="card purple"><div class="c-icon">📄</div><h4>Step 1 — Resume In</h4><p>Candidate uploads PDF via website or sends it by email</p></div>
    <div class="card yellow"><div class="c-icon">🤖</div><h4>Step 2 — AI Reads It</h4><p>Local AI (Ollama) + Cloud AI (Groq) score the resume 0–100</p></div>
    <div class="card green"><div class="c-icon">🎥</div><h4>Step 3 — Video Quiz</h4><p>Candidate records a short video. AI watches and scores confidence</p></div>
    <div class="card pink"><div class="c-icon">📅</div><h4>Step 4 — Auto-Schedule</h4><p>System picks the best interviewer + time slot and confirms it</p></div>
    <div class="card cyan"><div class="c-icon">🗓️</div><h4>Step 5 — Calendar Event</h4><p>Real calendar event created on Google/Yahoo via MCP server</p></div>
    <div class="card gray"><div class="c-icon">📧</div><h4>Throughout — Emails</h4><p>Candidate and interviewer get emails at every step automatically</p></div>
  </div>

  <h3>The 4 People in the System</h3>
  <div class="card-row col2">
    <div class="card gray"><div class="c-icon">👤</div><h4>Candidate</h4><p>The job applicant. Uploads resume, records a video, picks an interview time. Sees their own dashboard.</p></div>
    <div class="card gray"><div class="c-icon">🧑‍💼</div><h4>Interviewer</h4><p>The person who conducts the interview. Sets their free time slots, gets notified when a slot is booked.</p></div>
    <div class="card gray"><div class="c-icon">👑</div><h4>Admin (HR)</h4><p>Controls all settings. Creates job postings, reviews results, approves tricky assignments.</p></div>
    <div class="card gray"><div class="c-icon">🤖</div><h4>AI (silent worker)</h4><p>Runs 24/7 in the background. Scores, schedules, emails — never complains, never sleeps.</p></div>
  </div>

  <div class="page-foot"><span>InterviewAssist — Architecture Guide</span><span>Chapter 1 / 9</span></div>
</div>


<!-- ══════════════════════════════════════════
  CH2 · WHAT IS MCP
══════════════════════════════════════════ -->
<div class="page">
  <div class="sec-tag purple">Chapter 2</div>
  <h2>What is MCP?</h2>
  <p class="lead"><strong>Model Context Protocol</strong> — a standard language that lets AI systems talk to tools. Think of it as a universal remote control for AI-powered tools.</p>

  <div class="analogy">
    <div class="a-label">🔌 The USB Cable Analogy</div>
    <p>A <strong>USB cable</strong> connects any device to any computer — keyboard, mouse, webcam, hard drive. You don't need a different cable for each device. <strong>MCP is the "USB cable" for AI tools.</strong> Our system can call Google Calendar, Yahoo Calendar, or any future calendar tool using the <em>exact same code</em> — just plug in a different MCP server URL.</p>
  </div>

  <div class="col2-layout" style="margin-top:14px">
    <div>
      <h3>Without MCP (the old painful way)</h3>
      <div class="hbox red">
        <strong>Google Calendar:</strong> import Google SDK, learn their API, write custom code<br/>
        <strong>Switch to Yahoo:</strong> delete all that code, import Yahoo SDK, learn their API, write new code<br/>
        <strong>Switch to Outlook:</strong> do it all over again 😩
      </div>
    </div>
    <div>
      <h3>With MCP (our way)</h3>
      <div class="hbox green">
        <strong>Google Calendar:</strong> plug in Google MCP URL → done ✓<br/>
        <strong>Switch to Yahoo:</strong> change the URL → done ✓<br/>
        <strong>Switch to Outlook:</strong> change the URL → done ✓<br/>
        <strong>Zero code changes ever again 🎉</strong>
      </div>
    </div>
  </div>

  <h3>How MCP Works — 3 Simple Steps</h3>
  <div class="steps">
    <div class="step">
      <div class="step-left"><div class="step-num purple">1</div><div class="step-line"></div></div>
      <div class="step-body"><h5>🔗 Connect</h5><p>Our app opens a connection to the MCP server (either a child process on the same computer, or an HTTPS URL on the internet)</p><div class="tags"><span class="tag purple">client.connect(transport)</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num purple">2</div><div class="step-line"></div></div>
      <div class="step-body"><h5>🔍 Discover</h5><p>Ask "what tools do you have?" — the MCP server replies with a list of all available tools and what they do</p><div class="tags"><span class="tag purple">client.listTools()</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num purple">3</div></div>
      <div class="step-body"><h5>⚡ Call</h5><p>Pick a tool by name, send the data it needs, get a result back. Done!</p><div class="tags"><span class="tag purple">client.callTool({ name: "create_event", arguments: {...} })</span></div></div>
    </div>
  </div>

  <h3>What Goes Over the Wire — JSON-RPC</h3>
  <p style="color:#64748b;font-size:12px;margin-bottom:8px">Every MCP message is a JSON object. Here's exactly what our system sends and receives:</p>
  <div class="wire">
    <div class="wire-side">
      <div class="wire-head send">→ Our App SENDS</div>
      <pre><span class="obj">"method"</span>: <span class="str">"tools/call"</span>,
<span class="obj">"params"</span>: {
  <span class="obj">"name"</span>: <span class="str">"create_event"</span>,
  <span class="obj">"arguments"</span>: {
    <span class="obj">"summary"</span>: <span class="str">"Interview"</span>,
    <span class="obj">"start"</span>: <span class="str">"2026-05-01T10:00Z"</span>
  }
}</pre>
    </div>
    <div class="wire-side">
      <div class="wire-head recv">← MCP Server REPLIES</div>
      <pre><span class="obj">"result"</span>: {
  <span class="obj">"content"</span>: [{
    <span class="obj">"type"</span>: <span class="str">"text"</span>,
    <span class="obj">"text"</span>: <span class="str">"Event created!"</span>
  }]
}</pre>
    </div>
  </div>

  <div class="page-foot"><span>InterviewAssist — Architecture Guide</span><span>Chapter 2 / 9</span></div>
</div>


<!-- ══════════════════════════════════════════
  CH3 · THE TWO MCPs
══════════════════════════════════════════ -->
<div class="page">
  <div class="sec-tag green">Chapter 3</div>
  <h2>Our Two MCP Servers</h2>
  <p class="lead">This system runs exactly <strong>2 MCP connections</strong>. One lives on the same computer (internal), one talks to the internet (external calendar).</p>

  <div class="col2-layout">
    <div class="mcp-side local">
      <h4>🔧 MCP #1 — Local Node Tools</h4>
      <div class="mcp-prop"><span>Location</span><strong>Same computer as app</strong></div>
      <div class="mcp-prop"><span>Transport</span><strong>stdio (pipes)</strong></div>
      <div class="mcp-prop"><span>Always on?</span><strong>Yes — starts with app</strong></div>
      <div class="mcp-prop"><span>Auth needed?</span><strong>No</strong></div>
      <div class="mcp-prop"><span>Purpose</span><strong>Resume, scheduling, HR</strong></div>
      <div class="mcp-prop"><span>Tools count</span><strong>10 tools</strong></div>
    </div>
    <div class="mcp-side remote">
      <h4>🗓️ MCP #2 — External Calendar</h4>
      <div class="mcp-prop"><span>Location</span><strong>Cloud (Google/Yahoo/etc)</strong></div>
      <div class="mcp-prop"><span>Transport</span><strong>StreamableHTTP (HTTPS)</strong></div>
      <div class="mcp-prop"><span>Always on?</span><strong>No — called per event</strong></div>
      <div class="mcp-prop"><span>Auth needed?</span><strong>Yes — Bearer token</strong></div>
      <div class="mcp-prop"><span>Purpose</span><strong>Create calendar events</strong></div>
      <div class="mcp-prop"><span>Tools count</span><strong>1 tool (create_event)</strong></div>
    </div>
  </div>

  <h3>stdio vs StreamableHTTP — What's the Difference?</h3>
  <div class="analogy">
    <div class="a-label">📞 Phone analogy</div>
    <p><strong>stdio (MCP #1)</strong> = talking to your friend in the same room through a tin-can telephone — fast, private, no internet needed.<br/>
    <strong>StreamableHTTP (MCP #2)</strong> = calling someone overseas on WhatsApp — goes through the internet, needs authentication, slightly slower but reaches anywhere.</p>
  </div>

  <h3>MCP #1 — Code: How It Starts at Boot</h3>
  <div class="code-box">
    <div class="code-top"><div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div><span class="fname">src/services/mcp.js — app startup</span></div>
    <pre><span class="kw">const</span> transport = <span class="kw">new</span> <span class="ty">StdioClientTransport</span>({
  command: process.execPath,       <span class="cm">// runs "node"</span>
  args: [NODE_TOOLS_SERVER_PATH],  <span class="cm">// starts mcp-node-tools-server.js as child process</span>
});
<span class="cm">// The MCP server is now a separate process talking through stdin/stdout</span>
<span class="kw">await</span> client.<span class="fn">connect</span>(transport);
console.<span class="fn">log</span>(<span class="str">"MCP #1 ready ✓"</span>);</pre>
  </div>

  <h3>MCP #2 — Code: How It Connects Per Calendar Event</h3>
  <div class="code-box">
    <div class="code-top"><div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div><span class="fname">src/services/calendar-mcp.js — buildMCPClient()</span></div>
    <pre><span class="kw">const</span> transport = <span class="kw">new</span> <span class="ty">StreamableHTTPClientTransport</span>(
  <span class="kw">new</span> <span class="ty">URL</span>(mcpUrl),    <span class="cm">// e.g. "https://calendarmcp.googleapis.com/mcp/v1"</span>
  {
    requestInit: {
      headers: { Authorization: <span class="str">\`Bearer \${mcpKey}\`</span> }  <span class="cm">// your API key</span>
    }
  }
);
<span class="kw">await</span> client.<span class="fn">connect</span>(transport);
<span class="cm">// Now call the tool — works for Google, Yahoo, or ANY MCP calendar server</span>
<span class="kw">await</span> client.<span class="fn">callTool</span>({ name: <span class="str">"create_event"</span>, arguments: eventArgs });</pre>
  </div>

  <div class="hbox blue"><strong>Key Point:</strong> The <code>client.callTool()</code> line is <strong>identical</strong> whether you use Google or Yahoo. The MCP protocol is the same — only the URL changes. That's the whole magic.</div>

  <div class="page-foot"><span>InterviewAssist — Architecture Guide</span><span>Chapter 3 / 9</span></div>
</div>


<!-- ══════════════════════════════════════════
  CH4 · HOW OLLAMA WORKS
══════════════════════════════════════════ -->
<div class="page">
  <div class="sec-tag orange">Chapter 4</div>
  <h2>How Ollama Connects</h2>
  <p class="lead">Ollama is a local AI model that runs on your own computer. It converts text into numbers (called <em>vectors</em> or <em>embeddings</em>) so the system can measure how similar two pieces of text are.</p>

  <div class="analogy">
    <div class="a-label">📍 GPS Coordinates Analogy</div>
    <p>Every city on Earth has GPS coordinates (latitude, longitude). London: <strong>(51.5, -0.1)</strong>. Paris: <strong>(48.8, 2.3)</strong>. They're close! New York: <strong>(40.7, -74.0)</strong>. Far away.<br/><br/>
    Ollama does the same for text. "Experienced Python developer" and "5 years coding in Python" get <strong>similar numbers</strong>. "Loves surfing" gets <strong>very different numbers</strong>. This lets us answer: <em>"How well does this resume match this job description?"</em></p>
  </div>

  <div class="col2-layout" style="margin-top:14px">
    <div class="card yellow">
      <div class="c-icon">🦙</div>
      <h4>Ollama — NOT MCP</h4>
      <p>Ollama uses a simple REST HTTP call — not the MCP protocol. It runs at <strong>localhost:11434</strong> and we just POST text to it. No API key needed.</p>
    </div>
    <div class="card green">
      <div class="c-icon">🔢</div>
      <h4>Model: nomic-embed-text</h4>
      <p>Converts any text into a list of <strong>768 numbers</strong>. This list is called a "vector". Similar texts get similar vectors. Runs 100% offline.</p>
    </div>
  </div>

  <h3>The Code — Calling Ollama</h3>
  <div class="code-box">
    <div class="code-top"><div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div><span class="fname">src/services/embeddings.js — embedOllama()</span></div>
    <pre><span class="kw">async function</span> <span class="fn">embedOllama</span>(text, baseUrl) {
  <span class="cm">// Simple HTTP POST — plain REST, NOT MCP</span>
  <span class="kw">const</span> res = <span class="kw">await</span> <span class="fn">fetch</span>(<span class="str">\`\${baseUrl}/api/embeddings\`</span>, {
    method: <span class="str">"POST"</span>,
    headers: { <span class="str">"Content-Type"</span>: <span class="str">"application/json"</span> },
    body: <span class="ty">JSON</span>.<span class="fn">stringify</span>({
      model: <span class="str">"nomic-embed-text"</span>,  <span class="cm">// the local AI model</span>
      prompt: text               <span class="cm">// text to convert into numbers</span>
    })
  });
  <span class="kw">const</span> data = <span class="kw">await</span> res.<span class="fn">json</span>();
  <span class="kw">return</span> data.embedding;
  <span class="cm">// returns: [0.12, -0.54, 0.98, 0.03, -0.71, ...] — 768 numbers</span>
}</pre>
  </div>

  <h3>Ollama is Triggered TWICE in the System</h3>
  <div class="steps">
    <div class="step">
      <div class="step-left"><div class="step-num orange">1</div><div class="step-line"></div></div>
      <div class="step-body">
        <h5>When Admin saves a Job Description</h5>
        <p>The job description text is split into 500-character chunks. Each chunk → Ollama → vector → saved into PostgreSQL. This builds the "knowledge base" for this job.</p>
        <div class="tags"><span class="tag yellow">storeJDChunks()</span><span class="tag yellow">Trigger: Admin saves JD</span></div>
      </div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num orange">2</div></div>
      <div class="step-body">
        <h5>When a Candidate Resume Arrives</h5>
        <p>Resume text → Ollama → vector → compare against all JD vectors → find top 5 most relevant JD sections → pass those + resume to Groq for scoring.</p>
        <div class="tags"><span class="tag yellow">retrieveRelevantChunks()</span><span class="tag yellow">Trigger: Resume upload</span></div>
      </div>
    </div>
  </div>

  <div class="code-box">
    <div class="code-top"><div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div><span class="fname">src/services/embeddings.js — Finding best JD matches for a resume</span></div>
    <pre><span class="kw">export async function</span> <span class="fn">retrieveRelevantChunks</span>(resumeText, interviewId) {
  <span class="cm">// 1. Turn resume text into a vector (768 numbers)</span>
  <span class="kw">const</span> queryVec = <span class="kw">await</span> <span class="fn">embedText</span>(resumeText);

  <span class="cm">// 2. Find top 5 JD chunks whose vectors are closest to the resume vector</span>
  <span class="kw">const</span> result = <span class="kw">await</span> <span class="fn">query</span>(<span class="str">\`
    SELECT chunk_text FROM jd_chunks
    WHERE interview_id = $1
    ORDER BY embedding &lt;=&gt; $2   -- &lt;=&gt; is "cosine distance" in pgvector
    LIMIT 5
  \`</span>, [interviewId, queryVec]);

  <span class="kw">return</span> result.rows.<span class="fn">map</span>(r => r.chunk_text);
  <span class="cm">// e.g. returns the 5 JD sections most relevant to this resume</span>
}</pre>
  </div>

  <div class="page-foot"><span>InterviewAssist — Architecture Guide</span><span>Chapter 4 / 9</span></div>
</div>


<!-- ══════════════════════════════════════════
  CH5 · FULL END-TO-END FLOW
══════════════════════════════════════════ -->
<div class="page">
  <div class="sec-tag blue">Chapter 5</div>
  <h2>Full Journey — Resume to Calendar Event</h2>
  <p class="lead">Every single step, in order. Numbers match the code explanations in the next chapters.</p>

  <div class="steps">
    <div class="step">
      <div class="step-left"><div class="step-num blue">1</div><div class="step-line"></div></div>
      <div class="step-body"><h5>📥 Resume Arrives</h5><p>Candidate uploads PDF on the website (POST /upload) OR emails it to the company inbox (IMAP poller checks every 60 seconds)</p><div class="tags"><span class="tag blue">POST /upload</span><span class="tag blue">IMAP polling</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num blue">2</div><div class="step-line"></div></div>
      <div class="step-body"><h5>🔍 Duplicate Check</h5><p>System checks: has this email or this exact file been submitted before for this job? If yes → reject immediately. If no → save to database with status "Screening".</p><div class="tags"><span class="tag blue">checkDomainAndDuplicate()</span><span class="tag blue">PostgreSQL query</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num orange">3</div><div class="step-line"></div></div>
      <div class="step-body"><h5>📝 Text Extraction</h5><p>The PDF or DOCX file is opened and all text is pulled out. PDF → pdf-parse library. DOCX → mammoth library.</p><div class="tags"><span class="tag yellow">pdf-parse</span><span class="tag yellow">mammoth (DOCX)</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num orange">4</div><div class="step-line"></div></div>
      <div class="step-body"><h5>🦙 Ollama Embedding — Local AI</h5><p>Resume text is sent to Ollama running locally. Ollama returns 768 numbers. pgvector finds the top 5 most similar job description sections.</p><div class="tags"><span class="tag yellow">POST localhost:11434/api/embeddings</span><span class="tag yellow">pgvector cosine search</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num purple">5</div><div class="step-line"></div></div>
      <div class="step-body"><h5>⚡ Groq LLM Scoring — Cloud AI</h5><p>The 5 relevant JD sections + the full resume text are sent to Groq (cloud). Groq scores the candidate 0–100. Score saved to database.</p><div class="tags"><span class="tag purple">llama-3.3-70b via Groq API</span><span class="tag purple">score → PostgreSQL</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num purple">6</div><div class="step-line"></div></div>
      <div class="step-body"><h5>📧 Video Invite Email</h5><p>If score ≥ pass threshold → candidate gets an email with a link to record a short video interview. Status → "AwaitingVideo".</p><div class="tags"><span class="tag purple">sendInvitationEmail()</span><span class="tag purple">nodemailer</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num pink">7</div><div class="step-line"></div></div>
      <div class="step-body"><h5>🎥 Video Analysis — Gemini AI</h5><p>Candidate records video. Groq Whisper transcribes speech to text. Gemini 2.5 Flash watches the video → scores confidence, communication, body language.</p><div class="tags"><span class="tag pink">Groq Whisper → transcript</span><span class="tag pink">Gemini 2.5 Flash → score</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num green">8</div><div class="step-line"></div></div>
      <div class="step-body"><h5>⏱️ Auto-Schedule Background Worker</h5><p>Every few minutes, a background timer checks for candidates with status "Done" and no scheduled interview. These get auto-assigned.</p><div class="tags"><span class="tag green">setInterval → runAutoScheduleTick()</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num green">9</div><div class="step-line"></div></div>
      <div class="step-body"><h5>🧑‍💼 Interviewer Matching</h5><p>Groq AI scores each available interviewer's skills vs job requirements. If best match score &lt; 40% → HR review request. If ≥ 40% → auto-assign.</p><div class="tags"><span class="tag green">suggestInterviewersForCandidate()</span><span class="tag yellow">HR gate: &lt;40% → human review</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num green">10</div><div class="step-line"></div></div>
      <div class="step-body"><h5>✅ Slot Confirmed + Emails</h5><p>Best available slot is booked. A database row is created (status = confirmed). Candidate + Interviewer both receive a confirmation email with the meeting link.</p><div class="tags"><span class="tag green">scheduled_interviews table</span><span class="tag green">sendScheduleConfirmedEmails()</span></div></div>
    </div>
    <div class="step">
      <div class="step-left"><div class="step-num pink">11</div></div>
      <div class="step-body"><h5>🗓️ Calendar MCP Event — External AI</h5><p>If a calendar MCP server is configured in admin settings → our app connects via HTTPS and calls <code>create_event</code> tool. Works with Google, Yahoo, or any MCP-compliant calendar. If nothing configured → emails only, no crash.</p><div class="tags"><span class="tag pink">StreamableHTTP → external MCP</span><span class="tag green">fire-and-forget (non-blocking)</span></div></div>
    </div>
  </div>

  <div class="page-foot"><span>InterviewAssist — Architecture Guide</span><span>Chapter 5 / 9</span></div>
</div>


<!-- ══════════════════════════════════════════
  CH6 · CODE: LOCAL MCP TOOL CALL
══════════════════════════════════════════ -->
<div class="page">
  <div class="sec-tag purple">Chapter 6</div>
  <h2>Code Walkthrough — Local MCP Tool Call</h2>
  <p class="lead">Let's trace exactly what happens when the system calls <code>analyze_resume</code> through MCP #1. Three files work together.</p>

  <h3>File 1: The Caller — mcp.js</h3>
  <p style="color:#64748b;font-size:12px;margin-bottom:6px">The main app sends a tool call request through the stdio pipe to the child process.</p>
  <div class="code-box">
    <div class="code-top"><div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div><span class="fname">src/services/mcp.js</span></div>
    <pre><span class="cm">// Generic tool caller — works for any tool name</span>
<span class="kw">export async function</span> <span class="fn">callMCPTool</span>(name, args = {}) {
  <span class="kw">const</span> result = <span class="kw">await</span> nodeToolsClient.<span class="fn">callTool</span>({ name, arguments: args });
  <span class="kw">const</span> parsed = <span class="fn">parseToolResult</span>(result); <span class="cm">// unwrap the JSON text</span>
  <span class="kw">return</span> parsed;
}

<span class="cm">// Specific helper for resume analysis</span>
<span class="kw">export async function</span> <span class="fn">analyzeResumeOnlyViaMCP</span>(payload) {
  <span class="kw">return</span> <span class="fn">callMCPTool</span>(<span class="str">"analyze_resume_only"</span>, payload);
}</pre>
  </div>

  <h3>File 2: The Server — mcp-node-tools-server.js</h3>
  <p style="color:#64748b;font-size:12px;margin-bottom:6px">The child process receives the call, validates inputs, runs the logic, sends back the result.</p>
  <div class="code-box">
    <div class="code-top"><div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div><span class="fname">src/services/mcp-node-tools-server.js</span></div>
    <pre>server.<span class="fn">tool</span>(
  <span class="str">"analyze_resume_only"</span>,
  <span class="str">"Score a resume against the job description"</span>,
  {
    threadId:     z.<span class="fn">string</span>().<span class="fn">min</span>(<span class="num">1</span>),   <span class="cm">// Zod validates inputs automatically</span>
    interviewId:  z.<span class="fn">string</span>().<span class="fn">uuid</span>(),
    resumeBase64: z.<span class="fn">string</span>().<span class="fn">min</span>(<span class="num">1</span>),
  },
  <span class="kw">async</span> ({ threadId, interviewId, resumeBase64 }) => {
    <span class="kw">const</span> resumeBuffer = <span class="ty">Buffer</span>.<span class="fn">from</span>(resumeBase64, <span class="str">"base64"</span>);
    <span class="kw">const</span> analysis = <span class="kw">await</span> <span class="fn">analyzeResume</span>({ threadId, interviewId, resumeBuffer });
    <span class="kw">return</span> {
      content: [{ type: <span class="str">"text"</span>, text: <span class="ty">JSON</span>.<span class="fn">stringify</span>({ ok: <span class="kw">true</span>, ...analysis }) }]
    };
  }
);</pre>
  </div>

  <h3>File 3: The Logic — nodes.js (with smart fallback)</h3>
  <p style="color:#64748b;font-size:12px;margin-bottom:6px">The actual business logic. Tries MCP first, falls back to direct code if MCP is unavailable.</p>
  <div class="code-box">
    <div class="code-top"><div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div><span class="fname">src/graph/nodes.js — analyzeResume()</span></div>
    <pre><span class="kw">export async function</span> <span class="fn">analyzeResume</span>(state) {
  <span class="cm">// Try MCP first</span>
  <span class="kw">if</span> (<span class="fn">isMCPAvailable</span>()) {
    <span class="kw">try</span> {
      <span class="kw">const</span> result = <span class="kw">await</span> <span class="fn">analyzeResumeOnlyViaMCP</span>({ threadId, interviewId, resumeBase64 });
      <span class="kw">if</span> (result?.resumeScore) <span class="kw">return</span> result; <span class="cm">// ✓ MCP worked</span>
    } <span class="kw">catch</span> (err) {
      console.<span class="fn">warn</span>(<span class="str">"MCP failed, using direct logic"</span>); <span class="cm">// graceful fallback</span>
    }
  }
  <span class="cm">// Fallback: run directly without MCP (same result, different path)</span>
  <span class="cm">// Ollama → embeddings → pgvector search → Groq → score</span>
  <span class="kw">const</span> chunks = <span class="kw">await</span> <span class="fn">retrieveRelevantChunks</span>(resumeText, interviewId);
  <span class="kw">return</span> <span class="kw">await</span> <span class="fn">scoreWithGroq</span>(resumeText, chunks);
}</pre>
  </div>

  <div class="hbox green"><strong>Why the fallback?</strong> If MCP server crashes → app still works perfectly. The fallback runs the exact same logic directly. This is called "graceful degradation" — the system never goes down just because one piece fails.</div>

  <div class="page-foot"><span>InterviewAssist — Architecture Guide</span><span>Chapter 6 / 9</span></div>
</div>


<!-- ══════════════════════════════════════════
  CH7 · CODE: CALENDAR MCP
══════════════════════════════════════════ -->
<div class="page">
  <div class="sec-tag pink">Chapter 7</div>
  <h2>Code Walkthrough — Calendar MCP</h2>
  <p class="lead">How the system creates a real Google/Yahoo/custom calendar event when an interview is confirmed. Three steps, three code blocks.</p>

  <h3>Step 1 — Interview confirmed → fire calendar call</h3>
  <div class="code-box">
    <div class="code-top"><div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div><span class="fname">src/services/scheduler.js — end of sendScheduleConfirmedEmails()</span></div>
    <pre><span class="kw">export async function</span> <span class="fn">sendScheduleConfirmedEmails</span>(scheduledId) {
  <span class="cm">// ... send email to candidate ...</span>
  <span class="cm">// ... send email to interviewer ...</span>
  <span class="cm">// ... update candidate status to "Scheduled" in DB ...</span>

  <span class="cm">// Fire calendar event — background, won't block emails if it fails</span>
  <span class="fn">createCalendarEventForScheduledInterview</span>(scheduledId)
    .<span class="fn">catch</span>((err) => console.<span class="fn">warn</span>(<span class="str">\`CalendarMCP failed: \${err.message}\`</span>));
  <span class="cm">//  ↑ .catch() means: if calendar fails, just log it — emails already sent ✓</span>
}</pre>
  </div>

  <h3>Step 2 — Read config + decide whether to run</h3>
  <div class="code-box">
    <div class="code-top"><div class="dot dr"></div><div class="dot dy"></div><div class="dot dg"></div><span class="fname">src/services/calendar-mcp.js — createCalendarEventForScheduledInterview()</span></div>
    <pre><span class="kw">export async function</span> <span class="fn">createCalendarEventForScheduledInterview</span>(scheduledId) {
  <span class="cm">// Read settings the admin set in the UI</span>
  <span class="kw">const</span> cfg = <span class="kw">await</span> <span class="fn">getCalendarConfig</span>();
  <span class="cm">// cfg = { provider: "google", mcpUrl: "https://...", mcpKey: "abc123", toolName: "create_event" }</span>

  <span class="cm">// If admin set "None" or left URL/key blank → do nothing, return early</span>
  <span class="kw">if</span> (!<span class="fn">isCalendarConfigured</span>(cfg)) <span class="kw">return</span> { ok: <span class="kw">false</span>, reason: <span class="str">"not_configured"</span> };

  <span class="cm">// Fetch interview details from database (who, when, meeting link)</span>
  <span class="kw">const</span> { slot_start, slot_end, meet_link, cemail, iname, iemail } = si;

  <span class="cm">// Connect to the MCP server (Google or Yahoo — doesn't matter)</span>
  <span class="kw">const</span> client = <span class="kw">await</span> <span class="fn">buildMCPClient</span>(cfg.mcpUrl, cfg.mcpKey);

  <span class="cm">// Call the tool — same code for any provider!</span>
  <span class="kw">await</span> client.<span class="fn">callTool</span>({
    name: cfg.toolName,   <span class="cm">// "create_event" (configurable in admin UI)</span>
    arguments: {
      summary:   <span class="str">\`Interview — \${cemail}\`</span>,
      start:     { dateTime: <span class="kw">new</span> <span class="ty">Date</span>(slot_start).<span class="fn">toISOString</span>() },
      end:       { dateTime: <span class="kw">new</span> <span class="ty">Date</span>(slot_end).<span class="fn">toISOString</span>() },
      attendees: [{ email: cemail }, { email: iemail }]
    }
  });
}</pre>
  </div>

  <h3>Plug-and-Play Switching</h3>
  <div class="card-row col3">
    <div class="card green"><div class="c-icon">🔵</div><h4>Google Calendar</h4><p>Set URL = Google MCP endpoint<br/>Set Key = Google OAuth token<br/><strong>Done ✓</strong></p></div>
    <div class="card yellow"><div class="c-icon">🟣</div><h4>Yahoo Calendar</h4><p>Change URL = Yahoo MCP endpoint<br/>Change Key = Yahoo token<br/><strong>Zero code change ✓</strong></p></div>
    <div class="card gray"><div class="c-icon">⚫</div><h4>None (default)</h4><p>Leave provider = None<br/>Emails still sent normally<br/><strong>System doesn't crash ✓</strong></p></div>
  </div>

  <div class="page-foot"><span>InterviewAssist — Architecture Guide</span><span>Chapter 7 / 9</span></div>
</div>


<!-- ══════════════════════════════════════════
  CH8 · ALL TOOLS REFERENCE
══════════════════════════════════════════ -->
<div class="page">
  <div class="sec-tag green">Chapter 8</div>
  <h2>All MCP Tools — Quick Reference</h2>
  <p class="lead">Every tool in MCP #1 (Local Node Tools Server). These can be called by our app internally, or by any external agent (Claude Desktop, custom scripts).</p>

  <table>
    <thead><tr><th>Tool Name</th><th>What It Does (plain English)</th><th>Who calls it</th></tr></thead>
    <tbody>
      <tr><td><span class="badge bg-purple">analyze_resume</span></td><td>Full pipeline: checks for duplicates, then scores the resume</td><td>Upload route, email ingest</td></tr>
      <tr><td><span class="badge bg-purple">analyze_resume_only</span></td><td>Scores resume only — skips duplicate check</td><td>When duplicate check already done</td></tr>
      <tr><td><span class="badge bg-green">send_invite</span></td><td>Emails the candidate their video interview link</td><td>After resume passes scoring</td></tr>
      <tr><td><span class="badge bg-cyan">candidate_lookup</span></td><td>Search candidates for a job by email or list all recent ones</td><td>Admin, external agents</td></tr>
      <tr><td><span class="badge bg-cyan">candidate_benchmarks</span></td><td>Get stats: average score, total count, rejected count, etc.</td><td>Admin dashboard, reports</td></tr>
      <tr><td><span class="badge bg-yellow">schedule_candidate</span></td><td>Find available slots and email candidate time options to pick from</td><td>Auto-scheduler</td></tr>
      <tr><td><span class="badge bg-yellow">auto_assign_and_confirm</span></td><td>Full auto: find best interviewer + slot + confirm + send emails</td><td>Background timer every N minutes</td></tr>
      <tr><td><span class="badge bg-pink">list_hr_assignment_requests</span></td><td>Show all cases where HR needs to manually pick an interviewer</td><td>HR dashboard, admin</td></tr>
      <tr><td><span class="badge bg-pink">approve_hr_assignment</span></td><td>HR picks an interviewer and the system confirms the booking</td><td>HR admin page</td></tr>
      <tr><td><span class="badge bg-pink">reject_hr_assignment</span></td><td>HR rejects the request (wrong skills, unavailable, etc.)</td><td>HR admin page</td></tr>
    </tbody>
  </table>

  <h3>Technology Stack — All Pieces</h3>
  <table>
    <thead><tr><th>Component</th><th>Technology</th><th>Runs where</th><th>Job</th></tr></thead>
    <tbody>
      <tr><td>Web Server</td><td><span class="badge bg-green">Express.js (Node.js)</span></td><td>Your server</td><td>Routes, file uploads, sessions, HTML pages</td></tr>
      <tr><td>Database</td><td><span class="badge bg-cyan">PostgreSQL + pgvector</span></td><td>Your server</td><td>Stores everything + does vector similarity search</td></tr>
      <tr><td>Local AI (Embeddings)</td><td><span class="badge bg-yellow">Ollama — nomic-embed-text</span></td><td>Your machine (offline)</td><td>Text → 768 numbers. Powers similarity search.</td></tr>
      <tr><td>Cloud AI (Reasoning)</td><td><span class="badge bg-purple">Groq — llama-3.3-70b</span></td><td>Groq cloud</td><td>Resume scoring, interviewer matching, slot ranking</td></tr>
      <tr><td>Video Analysis</td><td><span class="badge bg-pink">Gemini 2.5 Flash</span></td><td>Google cloud</td><td>Watch video → score confidence & communication</td></tr>
      <tr><td>Transcription</td><td><span class="badge bg-pink">Groq Whisper</span></td><td>Groq cloud</td><td>Convert speech to text from video recording</td></tr>
      <tr><td>MCP #1 (internal)</td><td><span class="badge bg-purple">stdio transport</span></td><td>Your server</td><td>Internal tool server — resume, scheduling, HR ops</td></tr>
      <tr><td>MCP #2 (calendar)</td><td><span class="badge bg-green">StreamableHTTP</span></td><td>Cloud provider</td><td>Create calendar events — pluggable (Google/Yahoo/etc.)</td></tr>
      <tr><td>Email Sending</td><td><span class="badge bg-gray">nodemailer</span></td><td>Your server</td><td>Sends all emails via SMTP</td></tr>
      <tr><td>Email Receiving</td><td><span class="badge bg-gray">imapflow</span></td><td>Your server</td><td>Polls inbox for new resume attachments</td></tr>
    </tbody>
  </table>

  <div class="page-foot"><span>InterviewAssist — Architecture Guide</span><span>Chapter 8 / 9</span></div>
</div>


<!-- ══════════════════════════════════════════
  CH9 · VISUAL SYSTEM MAP
══════════════════════════════════════════ -->
<div class="page">
  <div class="sec-tag blue">Chapter 9</div>
  <h2>Full System Map</h2>
  <p class="lead">Everything on one page. Follow the arrows from top to bottom to trace a candidate's full journey.</p>

  <!-- Entry points row -->
  <div class="arch">
    <div class="arch-title">Entry Points (how data gets in)</div>
    <div style="display:flex;gap:10px;margin-bottom:10px">
      <div class="arch-box-sm purple" style="flex:1;text-align:center">🌐 Web Upload<br/><span style="font-size:9px;font-weight:400">POST /upload</span></div>
      <div class="arch-box-sm purple" style="flex:1;text-align:center">📧 Email Inbox<br/><span style="font-size:9px;font-weight:400">IMAP polling</span></div>
      <div class="arch-box-sm purple" style="flex:1;text-align:center">🤖 External Agent<br/><span style="font-size:9px;font-weight:400">MCP client (Claude etc.)</span></div>
    </div>
    <div style="text-align:center;font-size:18px;color:#94a3b8">↓</div>

    <div class="arch-title" style="margin-top:10px">Main App</div>
    <div class="arch-box-sm dark" style="width:100%;text-align:center;padding:10px">
      ⚙️ <strong>Express.js App</strong> — Routes / Auth / File Upload / Sessions
    </div>
    <div style="text-align:center;font-size:18px;color:#94a3b8">↓ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↓</div>

    <div style="display:flex;gap:14px;margin-top:4px">
      <!-- Left: MCP #1 -->
      <div style="flex:1;background:#eef2ff;border:1.5px solid #a5b4fc;border-radius:10px;padding:12px">
        <div style="font-size:10px;font-weight:800;color:#4f46e5;letter-spacing:1px;margin-bottom:8px">MCP #1 — LOCAL (stdio)</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <div class="arch-box-sm purple" style="font-size:10px">analyze_resume</div>
          <div class="arch-box-sm purple" style="font-size:10px">schedule_candidate</div>
          <div class="arch-box-sm purple" style="font-size:10px">auto_assign_and_confirm</div>
          <div class="arch-box-sm purple" style="font-size:10px">send_invite + HR tools</div>
        </div>
        <div style="text-align:center;font-size:16px;color:#94a3b8;margin:6px 0">↓</div>
        <div style="font-size:10px;font-weight:800;color:#4f46e5;margin-bottom:6px">Graph Nodes (nodes.js)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <div class="arch-box-sm yellow" style="font-size:9px">🦙 Ollama<br/>embeddings</div>
          <div class="arch-box-sm green" style="font-size:9px">⚡ Groq<br/>scoring</div>
          <div class="arch-box-sm pink" style="font-size:9px">🎬 Gemini<br/>video</div>
        </div>
        <div style="text-align:center;font-size:16px;color:#94a3b8;margin:6px 0">↓</div>
        <div class="arch-box-sm cyan" style="font-size:10px;width:100%;text-align:center">🗄️ PostgreSQL + pgvector</div>
      </div>

      <!-- Right: Scheduler + MCP #2 -->
      <div style="flex:1;background:#f0fdf4;border:1.5px solid #6ee7b7;border-radius:10px;padding:12px">
        <div style="font-size:10px;font-weight:800;color:#059669;letter-spacing:1px;margin-bottom:8px">Scheduler (scheduler.js)</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <div class="arch-box-sm green" style="font-size:10px">⏱ Background timer</div>
          <div class="arch-box-sm green" style="font-size:10px">🧑‍💼 Match interviewers (Groq)</div>
          <div class="arch-box-sm yellow" style="font-size:10px">⚠️ HR gate if match &lt;40%</div>
          <div class="arch-box-sm green" style="font-size:10px">✅ Confirm slot + send emails</div>
        </div>
        <div style="text-align:center;font-size:16px;color:#94a3b8;margin:6px 0">↓</div>
        <div style="font-size:10px;font-weight:800;color:#059669;margin-bottom:6px">MCP #2 — CALENDAR (HTTPS)</div>
        <div style="display:flex;gap:6px">
          <div class="arch-box-sm green" style="font-size:9px;flex:1;text-align:center">🔵 Google<br/>Calendar MCP</div>
          <div class="arch-box-sm green" style="font-size:9px;flex:1;text-align:center">🟣 Yahoo<br/>Calendar MCP</div>
          <div class="arch-box-sm gray" style="font-size:9px;flex:1;text-align:center">⚫ None<br/>(email only)</div>
        </div>
        <div style="margin-top:8px;font-size:10px;color:#059669;font-style:italic;text-align:center">← swap URL to switch provider →</div>
      </div>
    </div>
  </div>

  <h3>The Golden Rules of This Architecture</h3>
  <div class="card-row col2">
    <div class="hbox green" style="margin:0"><strong>🛡️ Nothing breaks silently.</strong> If MCP #1 crashes → app falls back to direct logic. If Calendar MCP fails → emails already sent, .catch() logs the error. System keeps running.</div>
    <div class="hbox blue" style="margin:0"><strong>🔄 Fully pluggable.</strong> Change calendar provider by changing one URL in admin settings. No code changes. No restarts. No redeployment needed.</div>
    <div class="hbox yellow" style="margin:0"><strong>🦙 Ollama stays private.</strong> Text embedding never leaves your machine. Only the scoring (Groq) and video (Gemini) go to the cloud.</div>
    <div class="hbox red" style="margin:0"><strong>⚡ MCP is not REST.</strong> It's JSON-RPC over stdio or HTTPS. The SDK handles the protocol — you just call <code>client.callTool()</code> and get a result.</div>
  </div>

  <div class="page-foot"><span>InterviewAssist — Architecture Guide</span><span>Chapter 9 / 9</span></div>
</div>

</body>
</html>`;

async function main() {
  const outPath = path.join(process.cwd(), "InterviewAssist-Architecture.pdf");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    console.log(`PDF saved: ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
