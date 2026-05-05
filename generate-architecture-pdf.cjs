const puppeteer = require("puppeteer");
const path = require("path");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1587" height="1123" viewBox="0 0 1580 1060"
     font-family="Arial,Helvetica,sans-serif">
<defs>
  <marker id="ah" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
    <polygon points="0 0,10 3.5,0 7" fill="#475569"/>
  </marker>
  <marker id="ahr" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
    <polygon points="0 0,10 3.5,0 7" fill="#ef4444"/>
  </marker>
  <marker id="ahg" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
    <polygon points="0 0,10 3.5,0 7" fill="#10b981"/>
  </marker>
</defs>

<!-- ═══ TITLE BAR ═══ -->
<rect x="0" y="0" width="1580" height="58" fill="#0f172a"/>
<text x="790" y="20" text-anchor="middle" fill="#94a3b8" font-size="9" font-weight="700" letter-spacing="3">SYSTEM ARCHITECTURE · TRENHIRE INTERVIEW ASSISTANT</text>
<text x="790" y="44" text-anchor="middle" fill="white" font-size="20" font-weight="800">CV Upload → Resume Analysis → MCP Agents → Calendar Event</text>

<!-- ═══ ZONE BACKGROUNDS ═══ -->
<!-- Entry Points Zone -->
<rect x="10" y="62" width="222" height="988" rx="10" fill="#f0f4ff" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="7,4"/>
<text x="121" y="83" text-anchor="middle" fill="#6366f1" font-size="10" font-weight="800" letter-spacing="2">entry points</text>

<!-- Backend Zone -->
<rect x="244" y="62" width="522" height="988" rx="10" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5" stroke-dasharray="7,4"/>
<text x="505" y="83" text-anchor="middle" fill="#10b981" font-size="10" font-weight="800" letter-spacing="2">backend</text>

<!-- MCP Servers Zone -->
<rect x="778" y="62" width="278" height="988" rx="10" fill="#fffbeb" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="7,4"/>
<text x="917" y="83" text-anchor="middle" fill="#f59e0b" font-size="10" font-weight="800" letter-spacing="2">MCP servers</text>

<!-- AI / External Zone -->
<rect x="1068" y="62" width="504" height="988" rx="10" fill="#fdf2f8" stroke="#ec4899" stroke-width="1.5" stroke-dasharray="7,4"/>
<text x="1320" y="83" text-anchor="middle" fill="#ec4899" font-size="10" font-weight="800" letter-spacing="2">AI services &amp; external</text>

<!-- LangGraph Sub-Zone inside Backend -->
<rect x="452" y="100" width="308" height="584" rx="8" fill="#eef2ff" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="5,3"/>
<text x="606" y="120" text-anchor="middle" fill="#4f46e5" font-size="9" font-weight="800" letter-spacing="1.5">🔄  LANGGRAPH WORKFLOW ENGINE</text>

<!-- Data Layer Sub-Zone inside Backend -->
<rect x="254" y="792" width="500" height="180" rx="8" fill="#ecfeff" stroke="#0ea5e9" stroke-width="1.5" stroke-dasharray="5,3"/>
<text x="504" y="810" text-anchor="middle" fill="#0284c7" font-size="9" font-weight="800" letter-spacing="1.5">🗄  DATA LAYER</text>

<!-- ═══ ENTRY COMPONENTS ═══ -->
<!-- 1. CV Web Upload -->
<rect x="18" y="110" width="206" height="72" rx="8" fill="white" stroke="#a5b4fc" stroke-width="1.5"/>
<text x="121" y="135" text-anchor="middle" font-size="18">📄</text>
<text x="121" y="155" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">CV Web Upload</text>
<text x="121" y="170" text-anchor="middle" fill="#64748b" font-size="9">Drag-drop PDF/DOCX portal</text>

<!-- 2. Email Inbox -->
<rect x="18" y="230" width="206" height="72" rx="8" fill="white" stroke="#a5b4fc" stroke-width="1.5"/>
<text x="121" y="255" text-anchor="middle" font-size="18">📧</text>
<text x="121" y="275" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Email Inbox (IMAP)</text>
<text x="121" y="290" text-anchor="middle" fill="#64748b" font-size="9">Auto-ingests resume attachments</text>

<!-- 3. Admin Dashboard -->
<rect x="18" y="350" width="206" height="72" rx="8" fill="white" stroke="#a5b4fc" stroke-width="1.5"/>
<text x="121" y="375" text-anchor="middle" font-size="18">👑</text>
<text x="121" y="395" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Admin Dashboard</text>
<text x="121" y="410" text-anchor="middle" fill="#64748b" font-size="9">Manual trigger / settings</text>

<!-- 4. Candidate Video -->
<rect x="18" y="470" width="206" height="72" rx="8" fill="white" stroke="#a5b4fc" stroke-width="1.5"/>
<text x="121" y="495" text-anchor="middle" font-size="18">🎥</text>
<text x="121" y="515" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Candidate Video Upload</text>
<text x="121" y="530" text-anchor="middle" fill="#64748b" font-size="9">Async video submission</text>

<!-- 5. Interviewer Portal -->
<rect x="18" y="590" width="206" height="72" rx="8" fill="white" stroke="#a5b4fc" stroke-width="1.5"/>
<text x="121" y="615" text-anchor="middle" font-size="18">🧑‍💼</text>
<text x="121" y="635" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Interviewer Portal</text>
<text x="121" y="650" text-anchor="middle" fill="#64748b" font-size="9">Calendar &amp; slot management</text>

<!-- ═══ APP LAYER COMPONENTS ═══ -->
<!-- Express.js Server -->
<rect x="254" y="110" width="186" height="72" rx="8" fill="white" stroke="#6ee7b7" stroke-width="1.5"/>
<text x="347" y="135" text-anchor="middle" font-size="18">⚙️</text>
<text x="347" y="155" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Express.js Server</text>
<text x="347" y="170" text-anchor="middle" fill="#64748b" font-size="9">Routes / Auth / Sessions</text>

<!-- Email Ingest Worker -->
<rect x="254" y="230" width="186" height="72" rx="8" fill="white" stroke="#6ee7b7" stroke-width="1.5"/>
<text x="347" y="255" text-anchor="middle" font-size="18">📥</text>
<text x="347" y="275" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Email Ingest Worker</text>
<text x="347" y="290" text-anchor="middle" fill="#64748b" font-size="9">imapflow · pdf-parse · mammoth</text>

<!-- File Watcher -->
<rect x="254" y="350" width="186" height="72" rx="8" fill="white" stroke="#6ee7b7" stroke-width="1.5"/>
<text x="347" y="375" text-anchor="middle" font-size="18">👁️</text>
<text x="347" y="395" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">File Watcher</text>
<text x="347" y="410" text-anchor="middle" fill="#64748b" font-size="9">chokidar · cvs/ folder</text>

<!-- Video Upload Handler -->
<rect x="254" y="470" width="186" height="72" rx="8" fill="white" stroke="#6ee7b7" stroke-width="1.5"/>
<text x="347" y="495" text-anchor="middle" font-size="18">🎬</text>
<text x="347" y="515" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Video Upload Handler</text>
<text x="347" y="530" text-anchor="middle" fill="#64748b" font-size="9">multer · /upload/:threadId</text>

<!-- Background Workers -->
<rect x="254" y="702" width="498" height="68" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
<text x="503" y="726" text-anchor="middle" fill="#94a3b8" font-size="9" font-weight="700" letter-spacing="1">⏱  BACKGROUND WORKERS</text>
<text x="503" y="744" text-anchor="middle" fill="#e2e8f0" font-size="10">auto-schedule · email-ingest poller · video reminder · no-show monitor · bulk outcome emailer</text>
<text x="503" y="759" text-anchor="middle" fill="#64748b" font-size="9">scheduler.js · email-ingest.js  (setInterval loops)</text>

<!-- PostgreSQL Box -->
<rect x="264" y="820" width="480" height="136" rx="8" fill="white" stroke="#67e8f9" stroke-width="1.5"/>
<text x="504" y="848" text-anchor="middle" font-size="20">🗄️</text>
<text x="504" y="870" text-anchor="middle" fill="#1e293b" font-size="12" font-weight="700">PostgreSQL + pgvector</text>
<text x="504" y="888" text-anchor="middle" fill="#64748b" font-size="9">candidates · interviews · scheduled_interviews · interviewers · admins · sessions · jd_chunks</text>
<text x="504" y="904" text-anchor="middle" fill="#0284c7" font-size="9" font-weight="600">vector(768) embeddings · cosine similarity (&lt;=&gt;) · connect-pg-simple checkpointer</text>
<text x="504" y="920" text-anchor="middle" fill="#64748b" font-size="9">PostgresSaver (LangGraph checkpoint) · pg pool (8 connections)</text>
<text x="504" y="938" text-anchor="middle" fill="#64748b" font-size="9">docker: pgvector/pgvector:pg16 · persistent volume</text>

<!-- ═══ LANGGRAPH NODES ═══ -->
<!-- Node 1: check_domain_duplicate -->
<rect x="462" y="136" width="286" height="68" rx="7" fill="white" stroke="#818cf8" stroke-width="1.5"/>
<text x="605" y="158" text-anchor="middle" font-size="14">🔍</text>
<text x="605" y="176" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">check_domain_and_duplicate</text>
<text x="605" y="191" text-anchor="middle" fill="#64748b" font-size="9">SHA256 hash dedup · domain regex filter · INSERT candidate</text>

<!-- Arrow: checkDomain → analyzeResume -->
<line x1="605" y1="204" x2="605" y2="248" stroke="#475569" stroke-width="1.5" marker-end="url(#ah)"/>

<!-- Node 2: analyze_resume -->
<rect x="462" y="248" width="286" height="68" rx="7" fill="white" stroke="#818cf8" stroke-width="1.5"/>
<text x="605" y="270" text-anchor="middle" font-size="14">📊</text>
<text x="605" y="288" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">analyze_resume</text>
<text x="605" y="303" text-anchor="middle" fill="#64748b" font-size="9">extract text · RAG embed · pgvector search · LLM score</text>

<!-- Arrow: analyzeResume → threshold gate -->
<line x1="605" y1="316" x2="605" y2="352" stroke="#475569" stroke-width="1.5" marker-end="url(#ah)"/>

<!-- Threshold Gate Diamond -->
<polygon points="605,352 643,380 605,408 567,380" fill="white" stroke="#f59e0b" stroke-width="2"/>
<text x="605" y="377" text-anchor="middle" fill="#92400e" font-size="9" font-weight="800">score ≥ threshold?</text>
<text x="605" y="392" text-anchor="middle" fill="#92400e" font-size="8">pass_threshold (0–100)</text>

<!-- Arrow gate→sendInvite (YES/left) -->
<path d="M 573,380 L 530,380 L 530,432" fill="none" stroke="#10b981" stroke-width="1.5" marker-end="url(#ahg)"/>
<text x="548" y="374" text-anchor="middle" fill="#065f46" font-size="8" font-weight="700">YES ✓</text>

<!-- Arrow gate→rejectCandidate (NO/right) -->
<path d="M 637,380 L 678,380 L 678,432" fill="none" stroke="#ef4444" stroke-width="1.5" marker-end="url(#ahr)"/>
<text x="660" y="374" text-anchor="middle" fill="#991b1b" font-size="8" font-weight="700">NO ✗</text>

<!-- Node 3: send_invite -->
<rect x="462" y="432" width="136" height="68" rx="7" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5"/>
<text x="530" y="454" text-anchor="middle" font-size="14">✉️</text>
<text x="530" y="472" text-anchor="middle" fill="#065f46" font-size="10" font-weight="700">send_invite</text>
<text x="530" y="487" text-anchor="middle" fill="#064e3b" font-size="8">video link email</text>

<!-- Node 4: reject_candidate -->
<rect x="610" y="432" width="136" height="68" rx="7" fill="#fff1f2" stroke="#ef4444" stroke-width="1.5"/>
<text x="678" y="454" text-anchor="middle" font-size="14">❌</text>
<text x="678" y="472" text-anchor="middle" fill="#991b1b" font-size="10" font-weight="700">reject_candidate</text>
<text x="678" y="487" text-anchor="middle" fill="#7f1d1d" font-size="8">rejection email</text>

<!-- ═══ MCP #1 SUB-ZONE ═══ -->
<rect x="786" y="100" width="264" height="368" rx="8" fill="#fff8e1" stroke="#f59e0b" stroke-width="1.5"/>
<rect x="792" y="112" width="252" height="56" rx="6" fill="#f59e0b" fill-opacity="0.15" stroke="#f59e0b" stroke-width="1"/>
<text x="918" y="132" text-anchor="middle" fill="#92400e" font-size="8" font-weight="800" letter-spacing="1">🔧  MCP SERVER #1 — LOCAL NODE TOOLS</text>
<text x="918" y="148" text-anchor="middle" fill="#78350f" font-size="9" font-weight="700">Transport: stdio (child_process spawn)</text>
<text x="918" y="162" text-anchor="middle" fill="#64748b" font-size="8">mcp-node-tools-server.js · StdioClientTransport</text>

<!-- MCP#1 Tool Rows -->
<rect x="792" y="178" width="252" height="44" rx="5" fill="white" stroke="#fcd34d" stroke-width="1"/>
<text x="805" y="196" fill="#1e293b" font-size="10" font-weight="700">🔬  analyze_resume_only</text>
<text x="805" y="212" fill="#64748b" font-size="8">PDF extract · embed · pgvector search · Groq score</text>

<rect x="792" y="230" width="252" height="44" rx="5" fill="white" stroke="#fcd34d" stroke-width="1"/>
<text x="805" y="248" fill="#1e293b" font-size="10" font-weight="700">📨  send_invite</text>
<text x="805" y="264" fill="#64748b" font-size="8">Nodemailer SMTP · video upload link</text>

<rect x="792" y="282" width="252" height="44" rx="5" fill="white" stroke="#fcd34d" stroke-width="1"/>
<text x="805" y="300" fill="#1e293b" font-size="10" font-weight="700">📅  schedule_candidate</text>
<text x="805" y="316" fill="#64748b" font-size="8">slot finder · Groq-ranked options · email candidate</text>

<rect x="792" y="334" width="252" height="44" rx="5" fill="white" stroke="#fcd34d" stroke-width="1"/>
<text x="805" y="352" fill="#1e293b" font-size="10" font-weight="700">✅  auto_assign_and_confirm</text>
<text x="805" y="368" fill="#64748b" font-size="8">pgvector match · Groq rank · HR gate if &lt;40%</text>

<rect x="792" y="386" width="252" height="44" rx="5" fill="white" stroke="#fcd34d" stroke-width="1"/>
<text x="805" y="404" fill="#1e293b" font-size="10" font-weight="700">👥  HR Assignment Tools</text>
<text x="805" y="420" fill="#64748b" font-size="8">list · approve · reject hr_assignment_requests</text>

<!-- ═══ MCP #2 SUB-ZONE ═══ -->
<rect x="786" y="488" width="264" height="162" rx="8" fill="#f0fdf4" stroke="#10b981" stroke-width="1.5"/>
<rect x="792" y="500" width="252" height="56" rx="6" fill="#10b981" fill-opacity="0.12" stroke="#10b981" stroke-width="1"/>
<text x="918" y="520" text-anchor="middle" fill="#065f46" font-size="8" font-weight="800" letter-spacing="1">🗓️  MCP SERVER #2 — CALENDAR</text>
<text x="918" y="536" text-anchor="middle" fill="#047857" font-size="9" font-weight="700">Transport: StreamableHTTP (HTTPS)</text>
<text x="918" y="550" text-anchor="middle" fill="#64748b" font-size="8">calendar-mcp.js · Bearer token auth · per-event connect</text>

<rect x="792" y="564" width="252" height="44" rx="5" fill="white" stroke="#6ee7b7" stroke-width="1"/>
<text x="805" y="582" fill="#1e293b" font-size="10" font-weight="700">🔵  create_event</text>
<text x="805" y="598" fill="#64748b" font-size="8">summary · start/end · attendees · meet_link</text>

<!-- ═══ GMAIL SMTP BOX (in MCP zone) ═══ -->
<rect x="786" y="668" width="264" height="72" rx="8" fill="#fff1f2" stroke="#fca5a5" stroke-width="1.5"/>
<text x="918" y="692" text-anchor="middle" font-size="18">📬</text>
<text x="918" y="712" text-anchor="middle" fill="#9f1239" font-size="11" font-weight="700">Gmail SMTP (Nodemailer)</text>
<text x="918" y="727" text-anchor="middle" fill="#be123c" font-size="8">invite · reject · confirm · reminder emails</text>

<!-- ═══ AI SERVICE COMPONENTS ═══ -->
<!-- Groq LLM -->
<rect x="1078" y="110" width="212" height="72" rx="8" fill="white" stroke="#f9a8d4" stroke-width="1.5"/>
<text x="1184" y="135" text-anchor="middle" font-size="18">⚡</text>
<text x="1184" y="155" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Groq LLM</text>
<text x="1184" y="170" text-anchor="middle" fill="#64748b" font-size="9">llama-3.3-70b · resume scoring · IR matching</text>

<!-- Ollama Embeddings -->
<rect x="1078" y="230" width="212" height="72" rx="8" fill="white" stroke="#f9a8d4" stroke-width="1.5"/>
<text x="1184" y="255" text-anchor="middle" font-size="18">🦙</text>
<text x="1184" y="275" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Ollama Embeddings</text>
<text x="1184" y="290" text-anchor="middle" fill="#64748b" font-size="9">nomic-embed-text · 768-dim · localhost:11434</text>

<!-- Groq Whisper -->
<rect x="1078" y="350" width="212" height="72" rx="8" fill="white" stroke="#f9a8d4" stroke-width="1.5"/>
<text x="1184" y="375" text-anchor="middle" font-size="18">🎤</text>
<text x="1184" y="395" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Groq Whisper</text>
<text x="1184" y="410" text-anchor="middle" fill="#64748b" font-size="9">whisper-large-v3 · audio → transcript</text>

<!-- Gemini 2.5 Flash -->
<rect x="1078" y="470" width="212" height="72" rx="8" fill="white" stroke="#f9a8d4" stroke-width="1.5"/>
<text x="1184" y="495" text-anchor="middle" font-size="18">🎬</text>
<text x="1184" y="515" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Gemini 2.5 Flash</text>
<text x="1184" y="530" text-anchor="middle" fill="#64748b" font-size="9">File API · englishScore · confidence · skills[]</text>

<!-- Google Calendar MCP -->
<rect x="1078" y="622" width="212" height="72" rx="8" fill="white" stroke="#86efac" stroke-width="1.5"/>
<text x="1184" y="647" text-anchor="middle" font-size="18">🔵</text>
<text x="1184" y="667" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Google Calendar MCP</text>
<text x="1184" y="682" text-anchor="middle" fill="#64748b" font-size="9">change URL in admin → zero code change</text>

<!-- Yahoo Calendar MCP -->
<rect x="1322" y="622" width="218" height="72" rx="8" fill="white" stroke="#86efac" stroke-width="1.5"/>
<text x="1431" y="647" text-anchor="middle" font-size="18">🟣</text>
<text x="1431" y="667" text-anchor="middle" fill="#1e293b" font-size="11" font-weight="700">Yahoo Calendar MCP</text>
<text x="1431" y="682" text-anchor="middle" fill="#64748b" font-size="9">or any MCP-compliant calendar</text>


<!-- ═══════════════════════════════════════════════
     ARROWS + PROTOCOL LABELS + STEP CIRCLES
═══════════════════════════════════════════════ -->

<!-- ① CV Web Upload → Express.js  (POST /upload) -->
<path d="M 224,146 L 254,146" fill="none" stroke="#475569" stroke-width="1.5" marker-end="url(#ah)"/>
<rect x="192" y="100" width="100" height="16" rx="3" fill="white" stroke="#94a3b8" stroke-width="0.8"/>
<text x="242" y="112" text-anchor="middle" fill="#475569" font-size="8" font-weight="600">POST /upload</text>
<circle cx="224" cy="146" r="9" fill="#ea580c"/>
<text x="224" y="150" text-anchor="middle" fill="white" font-size="9" font-weight="800">1</text>

<!-- ② Email IMAP → Email Ingest (IMAP FETCH) -->
<path d="M 224,266 L 254,266" fill="none" stroke="#475569" stroke-width="1.5" marker-end="url(#ah)"/>
<rect x="192" y="250" width="90" height="16" rx="3" fill="white" stroke="#94a3b8" stroke-width="0.8"/>
<text x="237" y="262" text-anchor="middle" fill="#475569" font-size="8" font-weight="600">IMAP FETCH</text>
<circle cx="224" cy="266" r="9" fill="#ea580c"/>
<text x="224" y="270" text-anchor="middle" fill="white" font-size="9" font-weight="800">2</text>

<!-- ③ Admin → Express.js (bent up, JSON POST) -->
<path d="M 224,386 L 238,386 L 238,146 L 254,146" fill="none" stroke="#475569" stroke-width="1.5" stroke-dasharray="4,2" marker-end="url(#ah)"/>
<rect x="182" y="268" width="112" height="16" rx="3" fill="white" stroke="#94a3b8" stroke-width="0.8"/>
<text x="238" y="280" text-anchor="middle" fill="#475569" font-size="8" font-weight="600">JSON POST /admin/trigger</text>
<circle cx="224" cy="386" r="9" fill="#ea580c"/>
<text x="224" y="390" text-anchor="middle" fill="white" font-size="9" font-weight="800">3</text>

<!-- ④ Candidate Video → Video Handler (multipart form-data) -->
<path d="M 224,506 L 254,506" fill="none" stroke="#475569" stroke-width="1.5" marker-end="url(#ah)"/>
<rect x="178" y="490" width="108" height="16" rx="3" fill="white" stroke="#94a3b8" stroke-width="0.8"/>
<text x="232" y="502" text-anchor="middle" fill="#475569" font-size="8" font-weight="600">POST multipart/form-data</text>
<circle cx="224" cy="506" r="9" fill="#ea580c"/>
<text x="224" y="510" text-anchor="middle" fill="white" font-size="9" font-weight="800">4</text>

<!-- Express.js → LangGraph (short connector) -->
<path d="M 440,150 L 452,165" fill="none" stroke="#475569" stroke-width="1.2" stroke-dasharray="3,2" marker-end="url(#ah)"/>
<!-- Email Ingest → LangGraph (short connector) -->
<path d="M 440,270 L 452,282" fill="none" stroke="#475569" stroke-width="1.2" stroke-dasharray="3,2" marker-end="url(#ah)"/>
<!-- File Watcher → LangGraph (short connector) -->
<path d="M 440,390 L 452,350" fill="none" stroke="#475569" stroke-width="1.2" stroke-dasharray="3,2" marker-end="url(#ah)"/>

<!-- ⑤ analyze_resume → MCP #1 analyze_resume_only  (JSON-RPC stdio) -->
<path d="M 748,282 L 770,282 L 770,200 L 792,200" fill="none" stroke="#f59e0b" stroke-width="2" marker-end="url(#ah)"/>
<rect x="730" y="226" width="100" height="16" rx="3" fill="white" stroke="#f59e0b" stroke-width="0.8"/>
<text x="780" y="238" text-anchor="middle" fill="#92400e" font-size="8" font-weight="700">JSON-RPC stdio</text>
<circle cx="759" cy="282" r="9" fill="#ea580c"/>
<text x="759" y="286" text-anchor="middle" fill="white" font-size="9" font-weight="800">5</text>

<!-- ⑥ MCP #1 → Groq LLM (HTTPS API) -->
<path d="M 1044,200 L 1060,200 L 1060,146 L 1078,146" fill="none" stroke="#475569" stroke-width="1.5" marker-end="url(#ah)"/>
<rect x="1014" y="158" width="82" height="16" rx="3" fill="white" stroke="#94a3b8" stroke-width="0.8"/>
<text x="1055" y="170" text-anchor="middle" fill="#475569" font-size="8" font-weight="600">HTTPS API</text>
<circle cx="1044" cy="200" r="9" fill="#ea580c"/>
<text x="1044" y="204" text-anchor="middle" fill="white" font-size="9" font-weight="800">6</text>

<!-- ⑦ MCP #1 → Ollama (REST POST /api/embeddings) -->
<path d="M 1044,252 L 1060,252 L 1060,266 L 1078,266" fill="none" stroke="#475569" stroke-width="1.5" marker-end="url(#ah)"/>
<rect x="998" y="232" width="148" height="16" rx="3" fill="white" stroke="#94a3b8" stroke-width="0.8"/>
<text x="1072" y="244" text-anchor="middle" fill="#475569" font-size="8" font-weight="600">REST POST /api/embeddings</text>
<circle cx="1044" cy="252" r="9" fill="#ea580c"/>
<text x="1044" y="256" text-anchor="middle" fill="white" font-size="9" font-weight="800">7</text>

<!-- ⑧ LangGraph nodes → PostgreSQL (SQL INSERT/SELECT) -->
<path d="M 748,282 L 770,282 L 770,778 L 504,778 L 504,820" fill="none" stroke="#0ea5e9" stroke-width="1.5" stroke-dasharray="4,2" marker-end="url(#ah)"/>
<rect x="590" y="762" width="112" height="16" rx="3" fill="white" stroke="#0ea5e9" stroke-width="0.8"/>
<text x="646" y="774" text-anchor="middle" fill="#0284c7" font-size="8" font-weight="600">SQL INSERT / SELECT</text>
<circle cx="770" cy="530" r="9" fill="#ea580c"/>
<text x="770" y="534" text-anchor="middle" fill="white" font-size="9" font-weight="800">8</text>

<!-- ⑨ MCP #1 pgvector → PostgreSQL (cosine search) -->
<path d="M 918,468 L 918,784 L 520,784 L 520,820" fill="none" stroke="#0ea5e9" stroke-width="1.5" stroke-dasharray="4,2" marker-end="url(#ah)"/>
<rect x="652" y="768" width="130" height="16" rx="3" fill="white" stroke="#0ea5e9" stroke-width="0.8"/>
<text x="717" y="780" text-anchor="middle" fill="#0284c7" font-size="8" font-weight="600">pgvector cosine search (&lt;=&gt;)</text>
<circle cx="918" cy="620" r="9" fill="#ea580c"/>
<text x="918" y="624" text-anchor="middle" fill="white" font-size="9" font-weight="800">9</text>

<!-- ⑩ sendInvite → MCP #1 send_invite  (JSON-RPC stdio) -->
<path d="M 598,466 L 598,510 L 770,510 L 770,252 L 792,252" fill="none" stroke="#f59e0b" stroke-width="2" marker-end="url(#ah)"/>
<rect x="656" y="494" width="100" height="16" rx="3" fill="white" stroke="#f59e0b" stroke-width="0.8"/>
<text x="706" y="506" text-anchor="middle" fill="#92400e" font-size="8" font-weight="700">JSON-RPC stdio</text>
<circle cx="635" cy="510" r="9" fill="#ea580c"/>
<text x="635" y="514" text-anchor="middle" fill="white" font-size="9" font-weight="800">10</text>

<!-- ⑪ MCP #1 send_invite → Gmail SMTP (in-process / SMTP) -->
<path d="M 792,252 L 782,252 L 782,704 L 786,704" fill="none" stroke="#ef4444" stroke-width="1.5" marker-end="url(#ah)"/>
<rect x="726" y="474" width="118" height="16" rx="3" fill="white" stroke="#ef4444" stroke-width="0.8"/>
<text x="785" y="486" text-anchor="middle" fill="#b91c1c" font-size="8" font-weight="600">SMTP (nodemailer)</text>
<circle cx="782" cy="474" r="9" fill="#ea580c"/>
<text x="782" y="478" text-anchor="middle" fill="white" font-size="9" font-weight="800">11</text>

<!-- ⑫ Video Handler → Groq Whisper (audio transcription) -->
<path d="M 440,510 L 756,510 L 756,930 L 1064,930 L 1064,386 L 1078,386" fill="none" stroke="#8b5cf6" stroke-width="1.5" marker-end="url(#ah)"/>
<rect x="836" y="918" width="138" height="16" rx="3" fill="white" stroke="#8b5cf6" stroke-width="0.8"/>
<text x="905" y="930" text-anchor="middle" fill="#7c3aed" font-size="8" font-weight="600">Whisper API (audio → text)</text>
<circle cx="756" cy="710" r="9" fill="#ea580c"/>
<text x="756" y="714" text-anchor="middle" fill="white" font-size="9" font-weight="800">12</text>

<!-- ⑬ Video Handler → Gemini 2.5 Flash (video analysis) -->
<path d="M 440,530 L 758,530 L 758,948 L 1066,948 L 1066,506 L 1078,506" fill="none" stroke="#8b5cf6" stroke-width="1.5" marker-end="url(#ah)"/>
<rect x="836" y="936" width="132" height="16" rx="3" fill="white" stroke="#8b5cf6" stroke-width="0.8"/>
<text x="902" y="948" text-anchor="middle" fill="#7c3aed" font-size="8" font-weight="600">Gemini File API (video)</text>
<circle cx="758" cy="740" r="9" fill="#ea580c"/>
<text x="758" y="744" text-anchor="middle" fill="white" font-size="9" font-weight="800">13</text>

<!-- ⑭ Workers → MCP #2 Calendar  (StreamableHTTP) -->
<path d="M 754,724 L 770,724 L 770,586 L 792,586" fill="none" stroke="#10b981" stroke-width="2" marker-end="url(#ah)"/>
<rect x="720" y="644" width="128" height="16" rx="3" fill="white" stroke="#10b981" stroke-width="0.8"/>
<text x="784" y="656" text-anchor="middle" fill="#065f46" font-size="8" font-weight="700">StreamableHTTP (HTTPS)</text>
<circle cx="762" cy="644" r="9" fill="#ea580c"/>
<text x="762" y="648" text-anchor="middle" fill="white" font-size="9" font-weight="800">14</text>

<!-- ⑮ MCP #2 → Google Calendar (MCP create_event) -->
<path d="M 1044,586 L 1060,586 L 1060,658 L 1078,658" fill="none" stroke="#10b981" stroke-width="1.5" marker-end="url(#ahg)"/>
<rect x="1008" y="604" width="106" height="16" rx="3" fill="white" stroke="#10b981" stroke-width="0.8"/>
<text x="1061" y="616" text-anchor="middle" fill="#065f46" font-size="8" font-weight="700">MCP create_event</text>
<circle cx="1044" cy="586" r="9" fill="#ea580c"/>
<text x="1044" y="590" text-anchor="middle" fill="white" font-size="9" font-weight="800">15</text>

<!-- MCP #2 → Yahoo Calendar (swap URL only) -->
<path d="M 1044,604 L 1300,604 L 1300,658 L 1322,658" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="4,2" marker-end="url(#ahg)"/>
<rect x="1130" y="588" width="106" height="16" rx="3" fill="white" stroke="#10b981" stroke-width="0.8"/>
<text x="1183" y="600" text-anchor="middle" fill="#065f46" font-size="8" font-weight="600">swap URL → zero code change</text>

<!-- ═══ LEGEND ═══ -->
<rect x="18" y="750" width="206" height="200" rx="8" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>
<text x="121" y="772" text-anchor="middle" fill="#475569" font-size="9" font-weight="800" letter-spacing="1">LEGEND</text>
<line x1="30" y1="784" x2="70" y2="784" stroke="#f59e0b" stroke-width="2"/>
<text x="80" y="788" fill="#64748b" font-size="8">JSON-RPC stdio (MCP #1)</text>
<line x1="30" y1="802" x2="70" y2="802" stroke="#10b981" stroke-width="2"/>
<text x="80" y="806" fill="#64748b" font-size="8">StreamableHTTP (MCP #2)</text>
<line x1="30" y1="820" x2="70" y2="820" stroke="#8b5cf6" stroke-width="2"/>
<text x="80" y="824" fill="#64748b" font-size="8">Direct HTTPS API call</text>
<line x1="30" y1="838" x2="70" y2="838" stroke="#0ea5e9" stroke-width="2" stroke-dasharray="4,2"/>
<text x="80" y="842" fill="#64748b" font-size="8">SQL / pgvector query</text>
<line x1="30" y1="856" x2="70" y2="856" stroke="#ef4444" stroke-width="2"/>
<text x="80" y="860" fill="#64748b" font-size="8">SMTP email send</text>
<line x1="30" y1="874" x2="70" y2="874" stroke="#475569" stroke-width="1.5" stroke-dasharray="3,2"/>
<text x="80" y="878" fill="#64748b" font-size="8">Internal invoke / trigger</text>
<circle cx="42" cy="892" r="7" fill="#ea580c"/>
<text x="42" y="896" text-anchor="middle" fill="white" font-size="7" font-weight="800">N</text>
<text x="80" y="896" fill="#64748b" font-size="8">Numbered step in flow</text>
<text x="121" y="930" text-anchor="middle" fill="#94a3b8" font-size="8">All MCP calls use client.callTool()</text>
<text x="121" y="944" text-anchor="middle" fill="#94a3b8" font-size="8">Graceful fallback: if MCP fails,</text>
<text x="121" y="958" text-anchor="middle" fill="#94a3b8" font-size="8">logic runs in-process directly</text>

<!-- ═══ FOOTER ═══ -->
<rect x="0" y="1022" width="1580" height="38" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>
<text x="20" y="1046" fill="#94a3b8" font-size="9">TrenHire Interview Assistant · Full Architecture · CV-to-Calendar End-to-End Flow</text>
<text x="1560" y="1046" text-anchor="end" fill="#94a3b8" font-size="9">LangGraph.js · MCP SDK · PostgreSQL + pgvector · Groq · Gemini · Ollama</text>

</svg>`;

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: white; width: 1587px; height: 1123px; overflow: hidden; }
</style>
</head>
<body>${svg}</body>
</html>`;

async function main() {
  const outPath = path.join(process.cwd(), "InterviewAssist-Architecture.pdf");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1587, height: 1123 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    await page.pdf({
      path: outPath,
      format: "A3",
      landscape: true,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    console.log(`PDF saved: ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
