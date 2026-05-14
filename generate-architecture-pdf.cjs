"use strict";
const puppeteer = require("puppeteer");
const path = require("path");

const OUT = path.join(__dirname, "TrenHire-Technical-Architecture.pdf");

// ─── colour tokens ────────────────────────────────────────────────────────────
const C = {
  http:   { stroke: "#3B82F6", badge: "#EFF6FF", text: "#1D4ED8" },
  mcp:    { stroke: "#F59E0B", badge: "#FFFBEB", text: "#B45309" },
  sql:    { stroke: "#8B5CF6", badge: "#F5F3FF", text: "#6D28D9" },
  https:  { stroke: "#10B981", badge: "#ECFDF5", text: "#065F46" },
  smtp:   { stroke: "#EF4444", badge: "#FEF2F2", text: "#991B1B" },
  mem:    { stroke: "#64748B", badge: "#F8FAFC", text: "#334155" },
  grpc:   { stroke: "#EC4899", badge: "#FDF2F8", text: "#9D174D" },
};

// ─── reusable SVG building blocks ─────────────────────────────────────────────

function shadow() {
  return `<defs>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#00000018"/>
    </filter>
    <marker id="ah"  markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#64748B"/></marker>
    <marker id="ahB" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#3B82F6"/></marker>
    <marker id="ahO" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#F59E0B"/></marker>
    <marker id="ahP" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#8B5CF6"/></marker>
    <marker id="ahG" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#10B981"/></marker>
    <marker id="ahR" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#EF4444"/></marker>
    <marker id="ahK" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#EC4899"/></marker>
  </defs>`;
}

// component box: small icon + label
function comp(x, y, emoji, label, sub = "", w = 80) {
  const h = sub ? 58 : 50;
  return `<g transform="translate(${x},${y})">
    <rect x="${-w/2}" y="0" width="${w}" height="${h}" rx="7" fill="white" stroke="#CBD5E1" stroke-width="1.5" filter="url(#s)"/>
    <text x="0" y="18" text-anchor="middle" font-size="18" dominant-baseline="central">${emoji}</text>
    <text x="0" y="35" text-anchor="middle" font-size="8.5" font-weight="700" fill="#0F172A">${label}</text>
    ${sub ? `<text x="0" y="48" text-anchor="middle" font-size="7.5" fill="#64748B">${sub}</text>` : ""}
  </g>`;
}

// diamond decision node
function diamond(x, y, label1, label2 = "") {
  return `<g transform="translate(${x},${y})">
    <polygon points="0,-28 36,0 0,28 -36,0" fill="#FEF3C7" stroke="#F59E0B" stroke-width="1.5" filter="url(#s)"/>
    <text x="0" y="${label2 ? -5 : 3}" text-anchor="middle" font-size="8" font-weight="700" fill="#92400E">${label1}</text>
    ${label2 ? `<text x="0" y="9" text-anchor="middle" font-size="8" font-weight="700" fill="#92400E">${label2}</text>` : ""}
  </g>`;
}

// horizontal arrow from (x1) to (x2) at vertical y, with protocol label
function arrow(x1, y, x2, proto, col = "ah", dashed = false) {
  const { stroke, badge, text } = C[proto] || C.mem;
  const mx = (x1 + x2) / 2;
  const markerId = { http:"ahB", mcp:"ahO", sql:"ahP", https:"ahG", smtp:"ahR", mem:"ah", grpc:"ahK" }[proto] || "ah";
  const dash = dashed ? `stroke-dasharray="6,3"` : "";
  return `
    <line x1="${x1}" y1="${y}" x2="${x2 - 8}" y2="${y}" stroke="${stroke}" stroke-width="1.8" ${dash} marker-end="url(#${markerId})"/>
    <rect x="${mx - 30}" y="${y - 9}" width="60" height="18" rx="9" fill="${badge}" stroke="${stroke}" stroke-width="1"/>
    <text x="${mx}" y="${y + 1}" text-anchor="middle" font-size="8" font-weight="700" fill="${text}">${proto.toUpperCase()}</text>`;
}

// vertical arrow
function varrow(x, y1, y2, proto, dashed = false) {
  const { stroke, badge, text } = C[proto] || C.mem;
  const my = (y1 + y2) / 2;
  const markerId = { http:"ahB", mcp:"ahO", sql:"ahP", https:"ahG", smtp:"ahR", mem:"ah", grpc:"ahK" }[proto] || "ah";
  const dash = dashed ? `stroke-dasharray="6,3"` : "";
  return `
    <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - 6}" stroke="${stroke}" stroke-width="1.8" ${dash} marker-end="url(#${markerId})"/>
    <rect x="${x - 28}" y="${my - 9}" width="56" height="18" rx="9" fill="${badge}" stroke="${stroke}" stroke-width="1"/>
    <text x="${x}" y="${my + 1}" text-anchor="middle" font-size="8" font-weight="700" fill="${text}">${proto.toUpperCase()}</text>`;
}

// data payload label (below arrow midpoint)
function payload(x, y, lines) {
  const lineH = 12;
  const h = lines.length * lineH + 10;
  const maxW = Math.max(...lines.map(l => l.length)) * 5.5 + 16;
  return `<g>
    <rect x="${x - maxW/2}" y="${y}" width="${maxW}" height="${h}" rx="4" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>
    ${lines.map((l,i) => `<text x="${x}" y="${y + 12 + i*lineH}" text-anchor="middle" font-size="8" fill="#334155" font-family="monospace">${l}</text>`).join("")}
  </g>`;
}

// step number badge
function stepBadge(x, y, n) {
  return `<circle cx="${x}" cy="${y}" r="14" fill="#FF6B35"/>
    <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="800" fill="white">${n}</text>`;
}

// page header
function pageHeader(title, sub, w = 1090) {
  return `<rect x="0" y="0" width="${w}" height="52" rx="8" fill="#0F172A"/>
    <text x="16" y="20" font-size="10" fill="#94A3B8" font-weight="700" letter-spacing="2">${sub}</text>
    <text x="16" y="40" font-size="18" font-weight="800" fill="white">${title}</text>`;
}

// page footer with legend items
function pageFooter(pageNum, total, y = 740, w = 1090) {
  const protocols = [
    ["HTTP/POST", "#3B82F6"], ["JSON-RPC stdio (MCP)", "#F59E0B"],
    ["SQL / pgvector", "#8B5CF6"], ["StreamableHTTP (MCP)", "#10B981"],
    ["SMTP", "#EF4444"], ["In-process / JSON", "#64748B"],
  ];
  const dotR = 5, spacing = 145;
  const startX = 12;
  return `<rect x="0" y="${y}" width="${w}" height="40" rx="8" fill="#F1F5F9"/>
    ${protocols.map((p, i) => `
      <circle cx="${startX + dotR + i * spacing}" cy="${y + 20}" r="${dotR}" fill="${p[1]}"/>
      <text x="${startX + dotR * 2 + 4 + i * spacing}" y="${y + 24}" font-size="8.5" fill="#475569">${p[0]}</text>
    `).join("")}
    <text x="${w - 12}" y="${y + 24}" text-anchor="end" font-size="9" fill="#94A3B8">Page ${pageNum} / ${total}</text>`;
}

// wrap SVG into a page div
function page(svgContent, w = 1090, h = 770) {
  return `<div class="page">
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"
         font-family="'Segoe UI',Arial,Helvetica,sans-serif">
      ${shadow()}
      <rect width="${w}" height="${h}" fill="#F8FAFC"/>
      ${svgContent}
    </svg>
  </div>`;
}

// ─── PAGE BUILDERS ────────────────────────────────────────────────────────────

function buildOverviewPage() {
  // ── Column / hub geometry ───────────────────────────────────────────────
  const CX_IN  = 65;     // input icons centre-x
  const BUS_X  = 128;    // vertical gathering bus
  const CX_BK  = 200;    // Express + LangGraph centre-x
  const HUB_L  = 262;    // hub box left edge
  const HUB_R  = 494;    // hub box right edge
  const HUB_CX = (HUB_L + HUB_R) / 2;  // 378
  const CX_MCP = 655;    // MCP server icon centre-x
  const CX_SL  = 855;    // services left col
  const CX_SR  = 985;    // services right col
  const CX_SC  = 920;    // services single-col centre

  // 5 data rows — inputs, hub routing blocks, MCP servers all share the same Y
  const Y = [132, 252, 370, 488, 572];  // icon-top Y for each row
  const rowCY = Y.map(y => y + 27);     // icon vertical centre

  const HUB_TOP = 78;
  const HUB_BOT = 638;
  const IW = HUB_R - HUB_L;  // 232

  let b = ``;  // body accumulator

  // ── Header & column labels ───────────────────────────────────────────────
  b += pageHeader("MCP Routing Architecture — How Each Request Is Dispatched",
                  "OVERVIEW  ·  INPUT → EXPRESS → LANGGRAPH → MCP MANAGER → MCP SERVER → SERVICES");
  b += `
    <text x="${CX_IN}"  y="73" text-anchor="middle" font-size="7" font-weight="700" fill="#94A3B8" letter-spacing="1">INPUTS</text>
    <text x="${CX_BK}"  y="73" text-anchor="middle" font-size="7" font-weight="700" fill="#94A3B8" letter-spacing="1">BACKEND</text>
    <text x="${HUB_CX}" y="73" text-anchor="middle" font-size="7" font-weight="700" fill="#D97706" letter-spacing="1">MCP CLIENT MANAGER</text>
    <text x="${CX_MCP}" y="73" text-anchor="middle" font-size="7" font-weight="700" fill="#94A3B8" letter-spacing="1">MCP SERVERS</text>
    <text x="${(CX_SL+CX_SR)/2}" y="73" text-anchor="middle" font-size="7" font-weight="700" fill="#94A3B8" letter-spacing="1">AI / SERVICES</text>
  `;

  // ── MCP Client Manager hub box ──────────────────────────────────────────
  b += `
    <rect x="${HUB_L}" y="${HUB_TOP}" width="${IW}" height="${HUB_BOT - HUB_TOP}" rx="12"
          fill="#FFFBEB" stroke="#F59E0B" stroke-width="2" filter="url(#s)"/>
    <!-- amber header bar -->
    <rect x="${HUB_L}" y="${HUB_TOP}" width="${IW}" height="34" rx="12" fill="#D97706"/>
    <rect x="${HUB_L}" y="${HUB_TOP+22}" width="${IW}" height="12" fill="#D97706"/>
    <text x="${HUB_CX}" y="${HUB_TOP+14}" text-anchor="middle" font-size="11" font-weight="800" fill="white">🔀  MCP Client Manager</text>
    <text x="${HUB_CX}" y="${HUB_TOP+28}" text-anchor="middle" font-size="7.5" fill="#FEF3C7">mcp-client-manager.js</text>
    <!-- TOOL_REGISTRY banner -->
    <rect x="${HUB_L+8}" y="${HUB_TOP+38}" width="${IW-16}" height="17" rx="4"
          fill="#FEF3C7" stroke="#F59E0B" stroke-width="1"/>
    <text x="${HUB_CX}" y="${HUB_TOP+50}" text-anchor="middle" font-size="8" font-weight="700" fill="#92400E">TOOL_REGISTRY — routes by tool name</text>
  `;

  // Routing blocks inside hub — each vertically centred on its row
  const routeBlocks = [
    { tools:["analyze_resume","analyze_resume_only","send_invite"],    server:"→ resume server",    color:"#3B82F6", row:0 },
    { tools:["candidate_lookup","candidate_benchmarks"],               server:"→ candidate server", color:"#10B981", row:1 },
    { tools:["schedule_candidate","auto_assign_and_confirm"],          server:"→ scheduling server",color:"#8B5CF6", row:2 },
    { tools:["list_hr_requests","approve_hr","reject_hr"],             server:"→ hr server",        color:"#EF4444", row:3 },
    { tools:["create_event"],                                          server:"→ calendar (ext)",   color:"#EC4899", row:4 },
  ];
  routeBlocks.forEach(rb => {
    const bH  = rb.tools.length * 13 + 20;
    const bTop = rowCY[rb.row] - bH / 2;
    b += `<rect x="${HUB_L+8}" y="${bTop}" width="${IW-16}" height="${bH}" rx="5"
               fill="white" stroke="${rb.color}60" stroke-width="1.5"/>`;
    rb.tools.forEach((t, i) =>
      b += `<text x="${HUB_L+14}" y="${bTop+13+i*13}" font-size="7.5"
                  fill="#475569" font-family="'Courier New',monospace">${t}</text>`);
    b += `<text x="${HUB_L+14}" y="${bTop+bH-5}" font-size="8" font-weight="700" fill="${rb.color}">${rb.server}</text>`;
  });

  // Auto-respawn / stats badge at bottom of hub
  const notY = rowCY[4] + 50;
  b += `
    <rect x="${HUB_L+8}" y="${notY}" width="${IW-16}" height="30" rx="5"
          fill="#EFF6FF" stroke="#BFDBFE" stroke-width="1"/>
    <text x="${HUB_CX}" y="${notY+12}" text-anchor="middle" font-size="7" font-weight="700" fill="#1D4ED8">⟳ Auto-respawn on transport.onclose (3 s)</text>
    <text x="${HUB_CX}" y="${notY+23}" text-anchor="middle" font-size="6.5" fill="#3B82F6">Per-server: totalCalls · failedCalls · lastCall</text>
  `;

  // ── Input components ────────────────────────────────────────────────────
  const inputs = [
    { emoji:"🌐", label:"Web Upload",    sub:"POST /upload" },
    { emoji:"📧", label:"Email IMAP",    sub:"imapflow" },
    { emoji:"🕵️",label:"Folder Watch",  sub:"chokidar" },
    { emoji:"👩‍💼", label:"Admin Panel",  sub:"HR Dashboard" },
    { emoji:"📋", label:"Interviewer",   sub:"Portal" },
  ];
  inputs.forEach((inp, i) => b += comp(CX_IN, Y[i], inp.emoji, inp.label, inp.sub, 78));

  // ── Backend: Express + LangGraph ────────────────────────────────────────
  b += comp(CX_BK, 188, "⚡", "Express.js", "API Router", 82);
  b += comp(CX_BK, 348, "🔄", "LangGraph",  "Workflow",   82);

  // ── MCP server icons (right of hub) ─────────────────────────────────────
  const mcps = [
    { color:"#3B82F6", emoji:"📄⚙️", label:"MCP Resume",     sub:"mcp-resume-server",     ext:false },
    { color:"#10B981", emoji:"👤⚙️", label:"MCP Candidate",  sub:"mcp-candidate-server",  ext:false },
    { color:"#8B5CF6", emoji:"📅⚙️", label:"MCP Scheduling", sub:"mcp-scheduling-server", ext:false },
    { color:"#EF4444", emoji:"👥⚙️", label:"MCP HR",         sub:"mcp-hr-server",         ext:false },
    { color:"#EC4899", emoji:"🌐⚙️", label:"Calendar MCP",   sub:"StreamableHTTP (ext)",  ext:true  },
  ];
  mcps.forEach((m, i) => b += comp(CX_MCP, Y[i], m.emoji, m.label, m.sub, 104));

  // ── Services column ──────────────────────────────────────────────────────
  // Row 0 — Ollama, Groq, PostgreSQL+pgvector
  b += comp(CX_SL - 50, Y[0] - 10, "🧠", "Ollama",    "nomic-embed", 70);
  b += comp(CX_SL + 55, Y[0] - 10, "⚡", "Groq LLM", "scorer",      70);
  b += comp(CX_SC,      Y[0] + 62, "🗄️", "PostgreSQL","+pgvector",   76);
  // Row 1 — PostgreSQL
  b += comp(CX_SC, Y[1], "🗄️", "PostgreSQL", "candidates", 82);
  // Row 2 — PostgreSQL + Nodemailer
  b += comp(CX_SL, Y[2], "🗄️", "PostgreSQL", "slots",  72);
  b += comp(CX_SR, Y[2], "📮", "Nodemailer", "SMTP",   70);
  // Row 3 — PostgreSQL + Nodemailer
  b += comp(CX_SL, Y[3], "🗄️", "PostgreSQL", "requests", 72);
  b += comp(CX_SR, Y[3], "📮", "Nodemailer", "SMTP",     70);
  // Row 4 — Calendar API
  b += comp(CX_SC, Y[4], "📅", "Google/Yahoo", "Calendar API", 86);

  // ── Arrows ───────────────────────────────────────────────────────────────
  const ln = (x1,y1,x2,y2,color="#94A3B8",dash="",w=1.2) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"
           ${dash} marker-end="url(#ah)"/>`;
  const badge = (x, y, label, bg, border, tc) =>
    `<rect x="${x-20}" y="${y-8}" width="40" height="16" rx="8" fill="${bg}" stroke="${border}" stroke-width="1"/>
     <text x="${x}" y="${y+1}" text-anchor="middle" font-size="7" font-weight="700" fill="${tc}">${label}</text>`;

  // 1. Vertical gathering bus
  b += `<line x1="${BUS_X}" y1="${rowCY[0]}" x2="${BUS_X}" y2="${rowCY[4]}"
              stroke="#CBD5E1" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  inputs.forEach((_, i) =>
    b += `<line x1="${CX_IN+39}" y1="${rowCY[i]}" x2="${BUS_X}" y2="${rowCY[i]}"
                stroke="#CBD5E1" stroke-width="1.2"/>`);

  // 2. Bus → Express (HTTP badge)
  const expCY = 188 + 27;
  b += `<line x1="${BUS_X}" y1="${expCY}" x2="${CX_BK-41}" y2="${expCY}"
              stroke="#3B82F6" stroke-width="1.6" marker-end="url(#ahB)"/>`;
  b += badge((BUS_X+CX_BK-41)/2, expCY, "HTTP", "#EFF6FF", "#3B82F6", "#1D4ED8");

  // 3. Express → LangGraph (vertical)
  b += `<line x1="${CX_BK}" y1="${188+50}" x2="${CX_BK}" y2="${348}"
              stroke="#64748B" stroke-width="1.5" marker-end="url(#ah)"/>`;
  b += badge(CX_BK, (188+50+348)/2, "state", "#F8FAFC", "#CBD5E1", "#64748B");

  // 4. LangGraph → Hub (callMCPTool)
  const lgAY = 348 + 27;
  b += `<line x1="${CX_BK+41}" y1="${lgAY}" x2="${HUB_L}" y2="${lgAY}"
              stroke="#F59E0B" stroke-width="2" marker-end="url(#ahO)"/>`;
  b += `<rect x="${(CX_BK+41+HUB_L)/2-26}" y="${lgAY-9}" width="52" height="18" rx="9"
              fill="#FFFBEB" stroke="#F59E0B" stroke-width="1"/>
        <text x="${(CX_BK+41+HUB_L)/2}" y="${lgAY+1}" text-anchor="middle"
              font-size="7.5" font-weight="700" fill="#B45309">callMCPTool()</text>`;

  // 5. Hub right edge → each MCP server (one per row, coloured per server)
  mcps.forEach((m, i) => {
    const ay = rowCY[i];
    const x1 = HUB_R, x2 = CX_MCP - 52;
    const mx = (x1+x2)/2;
    const proto = m.ext ? "HTTPS" : "stdio";
    b += `<line x1="${x1}" y1="${ay}" x2="${x2}" y2="${ay}"
                stroke="${m.color}" stroke-width="2" marker-end="url(#ahB)"/>`;
    b += `<rect x="${mx-18}" y="${ay-9}" width="36" height="18" rx="9"
                fill="${m.color}18" stroke="${m.color}" stroke-width="1"/>
          <text x="${mx}" y="${ay+1}" text-anchor="middle" font-size="7.5" font-weight="700" fill="${m.color}">${proto}</text>`;
  });

  // 6. MCP servers → services (thin dashed)
  const ds = "stroke-dasharray='3,2'";
  // Row 0 – Resume → Ollama, Groq, PG
  b += ln(CX_MCP+52, rowCY[0]+10, CX_SL-50-35, Y[0]-10+25, "#64748B", ds);
  b += ln(CX_MCP+52, rowCY[0]+25, CX_SL+55-35, Y[0]-10+25, "#64748B", ds);
  b += ln(CX_MCP+52, rowCY[0]+38, CX_SC-38,    Y[0]+62+25, "#64748B", ds);
  // Row 1 – Candidate → PG
  b += ln(CX_MCP+52, rowCY[1], CX_SC-41, rowCY[1], "#64748B", ds);
  // Row 2 – Scheduling → PG, SMTP
  b += ln(CX_MCP+52, rowCY[2]-8, CX_SL-36, rowCY[2], "#64748B", ds);
  b += ln(CX_MCP+52, rowCY[2]+8, CX_SR-35, rowCY[2], "#64748B", ds);
  // Row 3 – HR → PG, SMTP
  b += ln(CX_MCP+52, rowCY[3]-8, CX_SL-36, rowCY[3], "#64748B", ds);
  b += ln(CX_MCP+52, rowCY[3]+8, CX_SR-35, rowCY[3], "#64748B", ds);
  // Row 4 – Calendar → Google
  b += ln(CX_MCP+52, rowCY[4], CX_SC-43, rowCY[4], "#64748B", ds);

  b += pageFooter(2, 10);
  return page(b);
}

// ─── STEP PAGE HELPER ─────────────────────────────────────────────────────────
// Each step row: stepN, from-icon, arrow, to-icon, optional payload
// steps = [{n, row, fromX, comps: [{emoji,label,sub}], arrows:[{proto}], payloads:[{lines}]}]

function buildStepPage(pageTitle, pageSub, steps, pageNum, totalPages) {
  const rowH = 140;
  const baseY = 70;

  let body = "";
  steps.forEach((step, si) => {
    const y = baseY + si * rowH;
    const { n, comps, arrows: arrs, payloads = [], note = "" } = step;

    // step badge
    body += stepBadge(22, y + 40, n);

    // separator line
    if (si > 0) {
      body += `<line x1="0" y1="${y - 5}" x2="1090" y2="${y - 5}" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4,3"/>`;
    }

    // components + arrows
    comps.forEach((c, ci) => {
      const cx = 50 + ci * 170 + 50; // center x of component
      const compY = y + 10;
      body += comp(cx, compY, c.emoji, c.label, c.sub || "", c.w || 88);

      if (arrs[ci]) {
        const ax1 = cx + (c.w || 88) / 2;
        const ax2 = 50 + (ci + 1) * 170 + 50 - (comps[ci + 1]?.w || 88) / 2;
        body += arrow(ax1, compY + 27, ax2, arrs[ci].proto, "ahB", arrs[ci].dashed);

        if (payloads[ci]) {
          const mx = (ax1 + ax2) / 2;
          body += payload(mx, compY + 45, payloads[ci]);
        }
      }
    });

    // decision branches (YES/NO labels)
    if (step.branches) {
      step.branches.forEach(b => {
        body += `<text x="${b.x}" y="${b.y}" text-anchor="middle" font-size="9" font-weight="700" fill="${b.color}">${b.label}</text>`;
      });
    }

    // side note
    if (note) {
      body += `<rect x="900" y="${y + 8}" width="175" height="80" rx="6" fill="#FFF7ED" stroke="#FED7AA" stroke-width="1"/>
        <text x="988" y="${y + 22}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#92400E">📌 Detail</text>
        ${note.split("|").map((l, i) => `<text x="988" y="${y + 36 + i * 12}" text-anchor="middle" font-size="7.5" fill="#78350F">${l}</text>`).join("")}`;
    }
  });

  return page(`
    ${pageHeader(pageTitle, pageSub)}
    ${body}
    ${pageFooter(pageNum, totalPages)}
  `);
}

// ─── DEFINE ALL STEP PAGES ────────────────────────────────────────────────────

function buildPage2() {
  return buildStepPage(
    "Resume Upload & Request Handling",
    "STEPS 1 – 4  ·  ENTRY POINTS → EXPRESS → LANGGRAPH INIT",
    [
      {
        n: 1,
        comps: [
          { emoji: "🌐", label: "Web Browser", sub: "React / Pug UI", w: 88 },
          { emoji: "⚡", label: "Express.js", sub: "/upload route", w: 88 },
          { emoji: "📦", label: "multer", sub: "memStorage", w: 80 },
          { emoji: "💾", label: "File Buffer", sub: "Uint8Array", w: 80 },
        ],
        arrows: [
          { proto: "http" },
          { proto: "mem" },
          { proto: "mem" },
        ],
        payloads: [
          ["POST /upload", "Content-Type:", "multipart/form-data", "file: <binary>", "interviewId: UUID"],
          ["req.file"],
          ["buffer: Buffer", "mimetype, size"],
        ],
        note: "multer uses memoryStorage|so file never touches|disk — stays in RAM|as Buffer object",
      },
      {
        n: 2,
        comps: [
          { emoji: "⚡", label: "Express.js", sub: "upload.js route", w: 88 },
          { emoji: "🆔", label: "UUID v4", sub: "threadId gen", w: 80 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "candidates", w: 80 },
          { emoji: "📬", label: "LangGraph", sub: "graph.invoke()", w: 88 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "sql" },
          { proto: "mem" },
        ],
        payloads: [
          ["threadId = uuid()"],
          ["INSERT candidates", "thread_id, interview_id", "email, status='Screening'"],
          ["state: {threadId,", "interviewId, email,", "resumeBuffer}"],
        ],
        note: "LangGraph compiles|graph once on server|start; invoke() creates|a new thread run",
      },
      {
        n: 3,
        comps: [
          { emoji: "🔄", label: "LangGraph", sub: "Workflow Engine", w: 90 },
          { emoji: "💾", label: "PostgresSaver", sub: "Checkpoint", w: 88 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "langgraph_*", w: 80 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "sql" },
        ],
        payloads: [
          ["checkpoint.put()", "state snapshot"],
          ["INSERT INTO", "langgraph_checkpoints"],
        ],
        note: "Each state transition|is persisted — allows|resume if server|restarts mid-flow",
      },
      {
        n: 4,
        comps: [
          { emoji: "🔄", label: "LangGraph", sub: "Graph Router", w: 90 },
          { emoji: "📧", label: "Email Ingest", sub: "IMAP / imapflow", w: 90 },
          { emoji: "🕵️", label: "chokidar", sub: "Folder Watcher", w: 88 },
        ],
        arrows: [
          { proto: "http" },
          { proto: "mem" },
        ],
        payloads: [
          ["IMAP IDLE poll", "fetch attachments"],
          ["fs.watch() trigger", "file → buffer"],
        ],
        note: "Alternative entry:|IMAP ingest and|folder watcher also|funnel into graph.invoke()",
      },
    ],
    2, 10,
  );
}

function buildPage3() {
  return buildStepPage(
    "Duplicate Check Node & PostgreSQL Interaction",
    "STEPS 5 – 7  ·  LANGGRAPH NODE: check_domain_and_duplicate",
    [
      {
        n: 5,
        comps: [
          { emoji: "🔄", label: "LangGraph", sub: "routes to node", w: 88 },
          { emoji: "🔷", label: "check_domain", sub: "_and_duplicate", w: 90 },
          { emoji: "#️⃣", label: "crypto.SHA-256", sub: "hash(buffer)", w: 90 },
          { emoji: "💠", label: "resumeHash", sub: "hex string", w: 80 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "mem" },
          { proto: "mem" },
        ],
        payloads: [
          ["state.resumeBuffer"],
          ["Buffer.from()", "createHash('sha256')", ".update(buf)", ".digest('hex')"],
          ["hash: 'a3f9...'"],
        ],
        note: "SHA-256 detects|exact duplicate files|even if candidate|changes their email",
      },
      {
        n: 6,
        comps: [
          { emoji: "🔷", label: "check_domain", sub: "node", w: 88 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "candidates table", w: 88 },
          { emoji: "❓", label: "Duplicate?", sub: "hash OR email", w: 80 },
        ],
        arrows: [
          { proto: "sql" },
          { proto: "mem" },
        ],
        payloads: [
          ["SELECT thread_id", "FROM candidates", "WHERE interview_id=$1", "AND (resume_hash=$2", "OR email=$3)"],
          ["rows.length > 0?", "YES → {status:'Rejected'}", "NO → continue"],
        ],
        note: "Scoped per interview|so same candidate|can apply to multiple|job openings",
      },
      {
        n: 7,
        comps: [
          { emoji: "🔷", label: "check_domain", sub: "node (new candidate)", w: 90 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "candidates", w: 80 },
          { emoji: "✅", label: "State Update", sub: "{status:'Screening'}", w: 90 },
          { emoji: "🔄", label: "LangGraph", sub: "→ analyze_resume", w: 88 },
        ],
        arrows: [
          { proto: "sql" },
          { proto: "mem" },
          { proto: "mem" },
        ],
        payloads: [
          ["INSERT INTO candidates", "(thread_id, interview_id,", "email, resume_hash,", "status, assignment_method)"],
          ["return {resumeHash,", "status:'Screening'}"],
          ["graph routes to", "analyze_resume node"],
        ],
      },
    ],
    3, 10,
  );
}

function buildPage4() {
  return buildStepPage(
    "MCP Resume Server Call & Text Extraction",
    "STEPS 8 – 11  ·  analyze_resume NODE → MCP JSON-RPC → TEXT PIPELINE",
    [
      {
        n: 8,
        comps: [
          { emoji: "🧩", label: "analyze_resume", sub: "LG Node", w: 88 },
          { emoji: "🔀", label: "MCP Client", sub: "Manager", w: 88 },
          { emoji: "📄⚙️", label: "mcp-resume", sub: "-server.js", w: 88 },
        ],
        arrows: [
          { proto: "mcp" },
          { proto: "mcp" },
        ],
        payloads: [
          ["isMCPToolAvailable", "('analyze_resume_only')?", "YES → encode base64"],
          ["JSON-RPC 2.0 stdio", "{method:'tools/call',", "params:{name:", "'analyze_resume_only',", "arguments:{threadId,", "interviewId,resumeBase64}}}"],
        ],
        note: "MCPClientManager.TOOL|_REGISTRY routes the|call to 'resume' server|child process via stdio",
      },
      {
        n: 9,
        comps: [
          { emoji: "📄⚙️", label: "mcp-resume", sub: "-server.js", w: 88 },
          { emoji: "🔍", label: "Magic Bytes", sub: "file detection", w: 88 },
          { emoji: "📝", label: "Text Extractor", sub: "mammoth/pdf-parse", w: 90 },
          { emoji: "📃", label: "resumeText", sub: "plain string", w: 80 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "mem" },
          { proto: "mem" },
        ],
        payloads: [
          ["buf[0]===0x50? DOCX", "buf[0]===0xD0? DOC", "else PDF"],
          ["DOCX→mammoth", "DOC→word-extractor", "PDF→pdf-parse", "     +pdfjs-dist"],
          ["text ≥ 50 chars?", "else score=0,Rejected"],
        ],
        note: "Multi-strategy PDF:|pdf-parse → pdfjs-dist|→ raw regex fallback|for scanned PDFs",
      },
      {
        n: 10,
        comps: [
          { emoji: "📃", label: "resumeText", sub: "candidate text", w: 88 },
          { emoji: "🧠", label: "Ollama", sub: "nomic-embed-text", w: 90 },
          { emoji: "📐", label: "Vector [768]", sub: "embedding dims", w: 88 },
          { emoji: "🗄️", label: "pgvector", sub: "jd_chunks table", w: 80 },
        ],
        arrows: [
          { proto: "https" },
          { proto: "mem" },
          { proto: "sql" },
        ],
        payloads: [
          ["POST :11434/api", "/embeddings", "{model:'nomic-embed", "-text',prompt:text}"],
          ["embedding: [0.12,", "-0.34, ... x768]"],
          ["SELECT content", "FROM jd_chunks", "WHERE interview_id=$1", "ORDER BY embedding", "  <=> $2::vector", "LIMIT 5"],
        ],
        note: "Cosine distance <=>|is pgvector operator.|Top-5 JD chunks form|the RAG context",
      },
      {
        n: 11,
        comps: [
          { emoji: "📋", label: "RAG Context", sub: "top-5 JD chunks", w: 88 },
          { emoji: "⚡", label: "Groq LLM", sub: "llama-3 / mixtral", w: 88 },
          { emoji: "📊", label: "Score JSON", sub: "0-100 + analysis", w: 88 },
        ],
        arrows: [
          { proto: "https" },
          { proto: "mem" },
        ],
        payloads: [
          ["POST api.groq.com", "/v1/chat/completions", "{model, messages:[", "{role:'user',", "content:JD+resume}]}"],
          ["{score:82,", "matching:['React','TS'],", "missing:['AWS'],", "summary:'Strong...'}"],
        ],
        note: "callWithRetry()|wraps Groq call —|retries up to 3x on|rate-limit errors",
      },
    ],
    4, 10,
  );
}

function buildPage5() {
  return buildStepPage(
    "Score Persistence & LangGraph Threshold Gate",
    "STEPS 12 – 15  ·  DB UPDATE → CONDITIONAL EDGE → INVITE / REJECT",
    [
      {
        n: 12,
        comps: [
          { emoji: "⚡", label: "Groq Response", sub: "parsed JSON", w: 88 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "candidates", w: 80 },
          { emoji: "📤", label: "stdio reply", sub: "to MCP client", w: 88 },
          { emoji: "🔀", label: "MCP Client", sub: "Manager", w: 88 },
        ],
        arrows: [
          { proto: "sql" },
          { proto: "mcp" },
          { proto: "mcp" },
        ],
        payloads: [
          ["UPDATE candidates SET", "resume_score=$1,", "summary=$2,", "status='Screening'", "WHERE thread_id=$3"],
          ["JSON-RPC result:", "{ok:true,resumeScore:82}", "via stdout pipe"],
          ["parseToolResult()", "→ {resumeScore:82}"],
        ],
        note: "If MCP call throws,|nodes.js catch block|runs same logic|in-process (fallback)",
      },
      {
        n: 13,
        comps: [
          { emoji: "🧩", label: "analyze_resume", sub: "node return", w: 88 },
          { emoji: "🔄", label: "LangGraph", sub: "state merge", w: 88 },
          { emoji: "💾", label: "PostgresSaver", sub: "checkpoint", w: 88 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "lg_checkpoints", w: 88 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "sql" },
          { proto: "sql" },
        ],
        payloads: [
          ["{resumeScore:82,", "resumeBuffer:null}"],
          ["state snapshot saved"],
          ["upsert checkpoint", "for thread_id"],
        ],
        note: "resumeBuffer set to|null after scoring to|free memory — graph|no longer needs it",
      },
      {
        n: 14,
        comps: [
          { emoji: "🔄", label: "LangGraph", sub: "conditional edge", w: 88 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "interviews", w: 80 },
          { emoji: "◆", label: "Threshold", sub: "score ≥ threshold?", w: 88 },
        ],
        arrows: [
          { proto: "sql" },
          { proto: "mem" },
        ],
        payloads: [
          ["SELECT score_threshold", "FROM interviews", "WHERE id=$1"],
          ["state.resumeScore", ">= threshold?"],
        ],
        note: "Threshold is per-|interview config.|HR sets it in the|Admin dashboard",
      },
      {
        n: 15,
        comps: [
          { emoji: "◆", label: "Threshold Gate", sub: "decision", w: 88 },
          { emoji: "✉️", label: "send_invite", sub: "node (YES path)", w: 90 },
          { emoji: "❌", label: "reject_candidate", sub: "node (NO path)", w: 90 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "mem" },
        ],
        payloads: [
          ["score ≥ N → invite", "route:send_invite"],
          ["score < N → reject", "route:reject_candidate"],
        ],
        note: "reject_candidate only|does SQL UPDATE —|no email sent here.|Admin bulk-sends later",
      },
    ],
    5, 10,
  );
}

function buildPage6() {
  return buildStepPage(
    "Invitation Flow — Credentials & Email Delivery",
    "STEPS 16 – 19  ·  send_invite NODE → MCP → BCRYPT → SMTP",
    [
      {
        n: 16,
        comps: [
          { emoji: "✉️", label: "send_invite", sub: "LG Node", w: 88 },
          { emoji: "🔀", label: "MCP Client", sub: "Manager", w: 88 },
          { emoji: "📄⚙️", label: "mcp-resume", sub: "-server.js", w: 88 },
          { emoji: "🔑", label: "Credential", sub: "Generator", w: 80 },
        ],
        arrows: [
          { proto: "mcp" },
          { proto: "mcp" },
          { proto: "mem" },
        ],
        payloads: [
          ["tool: 'send_invite'", "{threadId,candidateEmail}"],
          ["JSON-RPC stdio", "child process call"],
          ["crypto.randomBytes(4)", ".toString('hex')", "→ loginToken (8 chars)"],
        ],
        note: "send_invite also|has in-process fallback|— same credential|gen + email logic",
      },
      {
        n: 17,
        comps: [
          { emoji: "🔑", label: "Credential", sub: "Generator", w: 88 },
          { emoji: "🔐", label: "bcrypt", sub: "hash(pw, 10)", w: 80 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "candidates", w: 80 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "sql" },
        ],
        payloads: [
          ["plainPassword =", "randomBytes(6)", ".toString('base64url')", "passwordHash =", "bcrypt.hash(pw,10)"],
          ["UPDATE candidates SET", "login_token=$1,", "password_hash=$2,", "must_change_password=TRUE", "WHERE thread_id=$3"],
        ],
        note: "bcrypt cost=10:|~100ms hash time.|Candidate must change|password on first login",
      },
      {
        n: 18,
        comps: [
          { emoji: "📄⚙️", label: "mcp-resume", sub: "-server.js", w: 88 },
          { emoji: "📮", label: "Nodemailer", sub: "SMTP transport", w: 88 },
          { emoji: "📧", label: "SMTP Server", sub: "Gmail / custom", w: 88 },
          { emoji: "📬", label: "Candidate", sub: "Email Inbox", w: 80 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "smtp" },
          { proto: "smtp" },
        ],
        payloads: [
          ["sendInvitationEmail()", "{to, subject,", "html: loginLink", "+ tempPassword}"],
          ["STARTTLS / TLS", "AUTH LOGIN", "EHLO handshake"],
          ["Subject: Interview Invite", "Body: link + credentials"],
        ],
        note: "Email has one-time|login link with token.|Candidate logs in,|changes password",
      },
      {
        n: 19,
        comps: [
          { emoji: "📄⚙️", label: "mcp-resume", sub: "server reply", w: 88 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "candidates", w: 80 },
          { emoji: "🔄", label: "LangGraph", sub: "graph END", w: 88 },
        ],
        arrows: [
          { proto: "sql" },
          { proto: "mcp" },
        ],
        payloads: [
          ["UPDATE candidates SET", "status='AwaitingVideo'"],
          ["stdio response:", "{ok:true,", "status:'AwaitingVideo'}"],
        ],
        note: "Graph reaches END|node. Thread is done.|Candidate portal now|shows video upload UI",
      },
    ],
    6, 10,
  );
}

function buildPage7() {
  return buildStepPage(
    "Video Submission & AI Analysis",
    "STEPS 20 – 23  ·  CANDIDATE PORTAL → VIDEO UPLOAD → GEMINI / LOCAL ANALYZER",
    [
      {
        n: 20,
        comps: [
          { emoji: "👤", label: "Candidate", sub: "Browser", w: 80 },
          { emoji: "⚡", label: "Express.js", sub: "/candidate/video", w: 90 },
          { emoji: "📦", label: "multer", sub: "diskStorage", w: 80 },
          { emoji: "📁", label: "uploads/", sub: "video file", w: 80 },
        ],
        arrows: [
          { proto: "http" },
          { proto: "mem" },
          { proto: "mem" },
        ],
        payloads: [
          ["POST /candidate/video", "Content-Type:", "multipart/form-data", "video: <binary>"],
          ["req.file"],
          ["video saved to disk", "uploads/<threadId>.mp4"],
        ],
        note: "Video uses diskStorage|(not memStorage) —|files can be hundreds|of MB",
      },
      {
        n: 21,
        comps: [
          { emoji: "📁", label: "Video File", sub: "mp4 / webm", w: 80 },
          { emoji: "🎬", label: "video-analysis", sub: ".js service", w: 90 },
          { emoji: "✨", label: "Gemini AI", sub: "gemini-2.0-flash", w: 90 },
          { emoji: "📊", label: "Analysis", sub: "JSON result", w: 80 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "https" },
          { proto: "mem" },
        ],
        payloads: [
          ["fs.readFileSync(path)", "→ Buffer → base64"],
          ["POST /v1/models/gemini", "-2.0-flash:generateContent", "{contents:[{parts:[", "{inlineData:", "{mimeType,data}}]}]}"],
          ["{english_score,", "confidence_score,", "skills:[], salary,", "video_summary,", "transcript}"],
        ],
        note: "Gemini receives raw|video as base64.|Extracts language,|confidence & skills",
      },
      {
        n: 22,
        comps: [
          { emoji: "🎬", label: "video-analysis", sub: "fallback path", w: 90 },
          { emoji: "🏠", label: "local-video", sub: "-analyze.js", w: 90 },
          { emoji: "⚡", label: "Groq LLM", sub: "transcript scorer", w: 90 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "https" },
        ],
        payloads: [
          ["if Gemini fails or", "not configured →", "local analyzer"],
          ["POST api.groq.com", "score from transcript", "text only (no vision)"],
        ],
        note: "Local analyzer is a|graceful fallback for|when Gemini API is|unavailable / cost-limited",
      },
      {
        n: 23,
        comps: [
          { emoji: "📊", label: "Video Scores", sub: "parsed JSON", w: 88 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "candidates", w: 80 },
          { emoji: "📈", label: "Final Result", sub: "composite score", w: 88 },
          { emoji: "👩‍💼", label: "Admin Panel", sub: "shows result", w: 88 },
        ],
        arrows: [
          { proto: "sql" },
          { proto: "sql" },
          { proto: "http" },
        ],
        payloads: [
          ["UPDATE candidates SET", "english_score, confidence,", "skills, salary_expectation,", "video_summary, video_path"],
          ["UPDATE candidates SET", "final_result, status='Done'"],
          ["GET /admin/candidates", "→ renders scores"],
        ],
      },
    ],
    7, 10,
  );
}

function buildPage8() {
  return buildStepPage(
    "Scheduling Flow — MCP Scheduling Server",
    "STEPS 24 – 27  ·  ADMIN TRIGGER → MCP SCHEDULING → SLOTS → CALENDAR MCP",
    [
      {
        n: 24,
        comps: [
          { emoji: "👩‍💼", label: "Admin Panel", sub: "HR dashboard", w: 88 },
          { emoji: "⚡", label: "Express.js", sub: "POST /schedule", w: 90 },
          { emoji: "📅⚙️", label: "mcp-scheduling", sub: "-server.js", w: 90 },
        ],
        arrows: [
          { proto: "http" },
          { proto: "mcp" },
        ],
        payloads: [
          ["POST /candidates/:id", "/schedule", "{candidateId,interviewId}"],
          ["JSON-RPC stdio", "tool:'schedule_candidate'", "{candidateId,interviewId}"],
        ],
        note: "MCPClientManager routes|'schedule_candidate'|→ scheduling server|child process",
      },
      {
        n: 25,
        comps: [
          { emoji: "📅⚙️", label: "mcp-scheduling", sub: "server", w: 90 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "interviewer_slots", w: 90 },
          { emoji: "⚡", label: "Groq LLM", sub: "slot priority", w: 88 },
          { emoji: "📋", label: "Best Slots", sub: "ordered list", w: 80 },
        ],
        arrows: [
          { proto: "sql" },
          { proto: "https" },
          { proto: "mem" },
        ],
        payloads: [
          ["SELECT s.slot_start,", "s.slot_end, s.interviewer_id", "FROM interviewer_slots s", "JOIN interviewers i ...", "WHERE s.status='available'"],
          ["Groq ranks slots by|time-of-day, load,|interviewer seniority"],
          ["slots[0..N] sorted"],
        ],
        note: "Groq slot ranking is|optional — falls back|to chronological order|if LLM unavailable",
      },
      {
        n: 26,
        comps: [
          { emoji: "📅⚙️", label: "mcp-scheduling", sub: "server", w: 90 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "scheduled_interviews", w: 100 },
          { emoji: "📮", label: "Nodemailer", sub: "SMTP", w: 80 },
          { emoji: "📬", label: "Candidate", sub: "slot choices email", w: 90 },
        ],
        arrows: [
          { proto: "sql" },
          { proto: "mem" },
          { proto: "smtp" },
        ],
        payloads: [
          ["INSERT scheduled_interviews", "(candidate_id, interviewer_id,", "slot_start, slot_end,", "status='pending_candidate',", "candidate_token, interviewer_token)"],
          ["sendCandidateSlotEmail()", "{slots, confirmLinks}"],
          ["Email with slot options", "candidate clicks to confirm"],
        ],
      },
      {
        n: 27,
        comps: [
          { emoji: "👤", label: "Candidate", sub: "confirms slot", w: 80 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "status='confirmed'", w: 90 },
          { emoji: "🌐⚙️", label: "Calendar MCP", sub: "StreamableHTTP", w: 95 },
          { emoji: "📅", label: "Google/Yahoo", sub: "Calendar Event", w: 90 },
        ],
        arrows: [
          { proto: "http" },
          { proto: "https" },
          { proto: "https" },
        ],
        payloads: [
          ["GET /confirm/:token", "UPDATE status", "='confirmed'"],
          ["POST https://cal-mcp/mcp", "Authorization: Bearer <key>", "tool:'create_event'", "{summary,start,end,", "attendees:[cand,itvr]}"],
          ["Google Calendar API", "or Yahoo Calendar API", "event created"],
        ],
        note: "Calendar MCP is|external / pluggable.|Uses StreamableHTTP,|not stdio transport",
      },
    ],
    8, 10,
  );
}

function buildPage9() {
  return buildStepPage(
    "HR Management — MCP HR Server & Assignment Flow",
    "STEPS 28 – 31  ·  MCP HR SERVER → APPROVE / REJECT → NOTIFICATIONS",
    [
      {
        n: 28,
        comps: [
          { emoji: "👩‍💼", label: "Admin Panel", sub: "HR Requests", w: 88 },
          { emoji: "⚡", label: "Express.js", sub: "GET /hr/requests", w: 90 },
          { emoji: "👥⚙️", label: "mcp-hr", sub: "-server.js", w: 84 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "assignment_requests", w: 100 },
        ],
        arrows: [
          { proto: "http" },
          { proto: "mcp" },
          { proto: "sql" },
        ],
        payloads: [
          ["GET /admin/hr-requests"],
          ["JSON-RPC stdio", "tool:'list_hr_assignment", "_requests'", "{status:'pending',limit:50}"],
          ["SELECT ar.*, c.email,", "i.name, iv.title", "FROM assignment_requests ar", "JOIN candidates c ..."],
        ],
        note: "MCPClientManager.TOOL|_REGISTRY maps|'list_hr_assignment|_requests' → 'hr' server",
      },
      {
        n: 29,
        comps: [
          { emoji: "👩‍💼", label: "HR Admin", sub: "approves request", w: 90 },
          { emoji: "👥⚙️", label: "mcp-hr", sub: "-server.js", w: 84 },
          { emoji: "🗄️", label: "PostgreSQL", sub: "UPDATE status", w: 88 },
          { emoji: "📅⚙️", label: "mcp-scheduling", sub: "(auto-assign)", w: 95 },
        ],
        arrows: [
          { proto: "http" },
          { proto: "sql" },
          { proto: "mcp" },
        ],
        payloads: [
          ["POST /hr/approve", "{requestId, interviewerId}", "tool:'approve_hr", "_assignment_request'"],
          ["UPDATE assignment_requests", "SET status='approved',", "interviewer_id=$1"],
          ["autoAssignAnd", "ConfirmCandidate()", "→ JSON-RPC stdio"],
        ],
        note: "Approval triggers|auto-confirm which|finds best slot and|books interview",
      },
      {
        n: 30,
        comps: [
          { emoji: "👥⚙️", label: "mcp-hr", sub: "-server.js", w: 84 },
          { emoji: "📮", label: "Nodemailer", sub: "SMTP", w: 80 },
          { emoji: "📬", label: "Interviewer", sub: "notification email", w: 90 },
          { emoji: "📬", label: "Candidate", sub: "confirmation email", w: 90 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "smtp" },
          { proto: "smtp" },
        ],
        payloads: [
          ["sendHrApproval", "RequestNotification()", "{interviewerEmail,", "candidateEmail, slot}"],
          ["Interviewer email:|slot + meet link"],
          ["Candidate email:|confirmed slot details"],
        ],
        note: "Both parties get|confirmation with|Google Meet link|embedded in email",
      },
      {
        n: 31,
        comps: [
          { emoji: "🔀", label: "MCP Client", sub: "Manager — stats", w: 90 },
          { emoji: "⚡", label: "Express.js", sub: "GET /debug/mcp", w: 90 },
          { emoji: "👩‍💼", label: "Admin Panel", sub: "MCP health view", w: 90 },
        ],
        arrows: [
          { proto: "mem" },
          { proto: "http" },
        ],
        payloads: [
          ["getMCPDebugStatus()", "{servers:{resume:{", "available,totalCalls,", "failedCalls,lastCall},", "candidate:{...},...}}"],
          ["JSON response", "per-server health"],
        ],
        note: "Auto-respawn fires|3s after drop.|getMCPDebugStatus()|shows live stats",
      },
    ],
    9, 10,
  );
}

// ─── ASSEMBLE HTML ────────────────────────────────────────────────────────────

function buildHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#fff; }
  .page {
    width: 1122px;
    height: 794px;
    overflow: hidden;
    page-break-after: always;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .page:last-child { page-break-after: auto; }
  @page { size: A4 landscape; margin: 0; }
</style>
</head>
<body>
${buildCoverPage()}
${buildOverviewPage()}
${buildPage2()}
${buildPage3()}
${buildPage4()}
${buildPage5()}
${buildPage6()}
${buildPage7()}
${buildPage8()}
${buildPage9()}
</body>
</html>`;
}

function buildCoverPage() {
  const W = 1090, H = 770;
  return page(`
    <rect width="${W}" height="${H}" fill="#0F172A"/>

    <!-- gradient accent bar -->
    <defs>
      <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#3B82F6"/>
        <stop offset="33%" stop-color="#8B5CF6"/>
        <stop offset="66%" stop-color="#F59E0B"/>
        <stop offset="100%" stop-color="#10B981"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="8" fill="url(#grad)"/>

    <!-- Title block -->
    <text x="${W/2}" y="200" text-anchor="middle" font-size="14" font-weight="700" fill="#3B82F6" letter-spacing="4">TECHNICAL ARCHITECTURE</text>
    <text x="${W/2}" y="270" text-anchor="middle" font-size="52" font-weight="900" fill="white">TrenHire</text>
    <text x="${W/2}" y="330" text-anchor="middle" font-size="28" font-weight="300" fill="#94A3B8">Interview Assistant</text>

    <!-- subtitle -->
    <text x="${W/2}" y="410" text-anchor="middle" font-size="14" fill="#64748B">Step-by-step component interaction · MCP microservice architecture · LangGraph.js workflow</text>

    <!-- tech pill badges -->
    ${[
      ["LangGraph.js", 240, "#6366F1"],
      ["MCP Protocol", 360, "#F59E0B"],
      ["PostgreSQL + pgvector", 510, "#336791"],
      ["Groq LLM", 660, "#10B981"],
      ["Gemini AI", 760, "#EA4335"],
      ["Node.js ESM", 870, "#68A063"],
    ].map(([label, x, color]) => `
      <rect x="${x - label.length * 4 - 8}" y="460" width="${label.length * 8 + 16}" height="28" rx="14" fill="${color}22" stroke="${color}" stroke-width="1"/>
      <text x="${x}" y="479" text-anchor="middle" font-size="11" font-weight="600" fill="${color}">${label}</text>
    `).join("")}

    <!-- page count note -->
    <text x="${W/2}" y="580" text-anchor="middle" font-size="12" fill="#475569">10 pages  ·  31 technical steps  ·  4 MCP microservers  ·  6 protocol types</text>

    <rect x="0" y="${H - 8}" width="${W}" height="8" fill="url(#grad)"/>
  `);
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

(async () => {
  console.log("Launching Chromium...");
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  const p = await browser.newPage();
  await p.setViewport({ width: 1122, height: 794 });
  await p.setContent(buildHTML(), { waitUntil: "networkidle0" });

  console.log("Rendering PDF...");
  await p.pdf({
    path: OUT,
    format: "A4",
    landscape: true,
    printBackground: true,
    margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
  });

  await browser.close();
  console.log(`Done → ${OUT}`);
})();
