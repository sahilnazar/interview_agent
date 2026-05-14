"use strict";
const PptxGenJS = require("pptxgenjs");
const path = require("path");

const OUT = path.join(__dirname, "TrenHire-Technical-Architecture.pptx");
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 inches
pptx.title = "TrenHire Interview Assistant – Technical Architecture";

// ── colour tokens (no # prefix for pptxgenjs) ────────────────────────────────
const C = {
  http:  { line:"3B82F6", fill:"EFF6FF", text:"1D4ED8" },
  mcp:   { line:"F59E0B", fill:"FFFBEB", text:"B45309" },
  sql:   { line:"8B5CF6", fill:"F5F3FF", text:"6D28D9" },
  https: { line:"10B981", fill:"ECFDF5", text:"065F46" },
  smtp:  { line:"EF4444", fill:"FEF2F2", text:"991B1B" },
  mem:   { line:"64748B", fill:"F8FAFC", text:"334155" },
};

const h = s => s.replace("#",""); // strip # if accidentally included

// ── primitive helpers ─────────────────────────────────────────────────────────

function rect(slide, x, y, w, hh, fill, border, radius = 0.07, shadow = true) {
  const opts = {
    x, y, w, h: hh,
    fill: { color: h(fill) },
    line: { color: h(border), pt: 1.3 },
    rectRadius: radius,
  };
  if (shadow) opts.shadow = { type:"outer", color:"000000", blur:3, offset:1, angle:45 };
  slide.addShape(pptx.ShapeType.roundRect, opts);
}

function txt(slide, text, x, y, w, hh, opts = {}) {
  slide.addText(text, {
    x, y, w, h: hh,
    align: opts.align || "center",
    valign: opts.valign || "middle",
    fontSize: opts.size || 8,
    bold: opts.bold || false,
    color: h(opts.color || "0F172A"),
    fontFace: opts.mono ? "Courier New" : "Calibri",
    wrap: true,
  });
}

function line(slide, x1, y1, x2, y2, color, ptW = 1.5, dash = false, arrow = true) {
  slide.addShape(pptx.ShapeType.line, {
    x: x1, y: y1, w: x2 - x1, h: y2 - y1,
    line: {
      color: h(color),
      pt: ptW,
      dashType: dash ? "dash" : "solid",
      endArrowType: arrow ? "arrow" : "none",
    },
  });
}

function badge(slide, cx, cy, label, fillColor, borderColor, textColor) {
  const bw = Math.max(0.45, label.length * 0.068 + 0.12), bh = 0.2;
  rect(slide, cx - bw/2, cy - bh/2, bw, bh, fillColor, borderColor, 0.08, false);
  txt(slide, label, cx - bw/2, cy - bh/2, bw, bh, { size:6.5, bold:true, color:textColor });
}

// ── component box ─────────────────────────────────────────────────────────────
function comp(slide, x, y, emoji, label, sub = "", borderColor = "CBD5E1") {
  const w = 1.05, hh = sub ? 0.72 : 0.58;
  rect(slide, x, y, w, hh, "FFFFFF", borderColor);
  const items = [
    { text: emoji + " ", options:{ fontSize:13 } },
    { text: label,       options:{ fontSize:8, bold:true, color:"0F172A" } },
  ];
  if (sub) items.push({ text:"\n"+sub, options:{ fontSize:6.5, color:"64748B" } });
  slide.addText(items, { x, y, w, h: hh, align:"center", valign:"middle", wrap:true });
}

// ── horizontal arrow with protocol badge ─────────────────────────────────────
function harrow(slide, x1, ay, x2, proto, dashed = false) {
  const col = C[proto] || C.mem;
  line(slide, x1, ay, x2, ay, col.line, 1.5, dashed, true);
  badge(slide, (x1+x2)/2, ay, proto.toUpperCase(), col.fill, col.line, col.text);
}

// ── payload data box ──────────────────────────────────────────────────────────
function payloadBox(slide, cx, y, lines) {
  const maxLen = Math.max(...lines.map(l => l.length));
  const bw = Math.max(1.1, maxLen * 0.057 + 0.15);
  const bh = lines.length * 0.145 + 0.1;
  rect(slide, cx - bw/2, y, bw, bh, "F8FAFC", "CBD5E1", 0.04, false);
  lines.forEach((l, i) =>
    txt(slide, l, cx - bw/2 + 0.05, y + 0.05 + i*0.145, bw-0.1, 0.145,
        { size:6.5, color:"334155", mono:true, align:"left" }));
}

// ── note box (right side) ─────────────────────────────────────────────────────
function noteBox(slide, x, y, w, hh, lines) {
  rect(slide, x, y, w, hh, "FFF7ED", "FED7AA", 0.06, false);
  txt(slide, "📌 Detail", x+0.06, y+0.06, w-0.12, 0.18,
      { size:7.5, bold:true, color:"92400E", align:"left" });
  lines.forEach((l, i) =>
    txt(slide, l, x+0.06, y+0.26+i*0.145, w-0.12, 0.145,
        { size:7, color:"78350F", align:"left" }));
}

// ── step number badge ─────────────────────────────────────────────────────────
function stepBadge(slide, x, y, n) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x, y, w:0.32, h:0.32,
    fill:{ color:"FF6B35" }, line:{ color:"E55B25", pt:1 },
  });
  txt(slide, String(n), x, y, 0.32, 0.32,
      { size:10, bold:true, color:"FFFFFF" });
}

// ── slide header ──────────────────────────────────────────────────────────────
function header(slide, title, sub) {
  slide.addShape(pptx.ShapeType.rect, {
    x:0, y:0, w:13.33, h:0.65,
    fill:{ color:"0F172A" }, line:{ color:"0F172A", pt:0 },
  });
  txt(slide, sub, 0.15, 0.03, 13, 0.22,
      { size:7, bold:true, color:"94A3B8", align:"left" });
  txt(slide, title, 0.15, 0.25, 13, 0.36,
      { size:14, bold:true, color:"FFFFFF", align:"left" });
}

// ── slide footer with legend ──────────────────────────────────────────────────
function footer(slide, pageNum, total = 10) {
  slide.addShape(pptx.ShapeType.rect, {
    x:0, y:7.12, w:13.33, h:0.38,
    fill:{ color:"F1F5F9" }, line:{ color:"E2E8F0", pt:1 },
  });
  const protos = [
    ["HTTP/POST","3B82F6"],["JSON-RPC stdio","F59E0B"],["SQL/pgvector","8B5CF6"],
    ["StreamableHTTP","10B981"],["SMTP","EF4444"],["In-process JSON","64748B"],
  ];
  protos.forEach(([lbl, col], i) => {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.18 + i*2.1, y:7.24, w:0.12, h:0.12,
      fill:{ color:col }, line:{ color:col, pt:0 },
    });
    txt(slide, lbl, 0.34+i*2.1, 7.22, 1.9, 0.18,
        { size:7, color:"475569", align:"left" });
  });
  txt(slide, `${pageNum} / ${total}`, 12.2, 7.22, 1.0, 0.18,
      { size:8, color:"94A3B8", align:"right" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 1 — COVER
// ═══════════════════════════════════════════════════════════════════════════════
function buildCover() {
  const s = pptx.addSlide();
  s.background = { color:"0F172A" };

  const gradCols = ["3B82F6","6366F1","8B5CF6","F59E0B","10B981","EF4444"];
  const sw = 13.33 / gradCols.length;
  gradCols.forEach((c,i) => {
    s.addShape(pptx.ShapeType.rect,
      { x:i*sw, y:0, w:sw, h:0.1, fill:{color:c}, line:{color:c,pt:0} });
    s.addShape(pptx.ShapeType.rect,
      { x:i*sw, y:7.4, w:sw, h:0.1, fill:{color:c}, line:{color:c,pt:0} });
  });

  txt(s,"TECHNICAL ARCHITECTURE",1.5,1.6,10,0.38,
      {size:13,bold:true,color:"3B82F6"});
  txt(s,"TrenHire",1.5,2.1,10,1.1,{size:56,bold:true,color:"FFFFFF"});
  txt(s,"Interview Assistant",1.5,3.3,10,0.55,{size:26,color:"94A3B8"});
  txt(s,"Step-by-step component interaction  ·  MCP microservice architecture  ·  LangGraph.js workflow",
      1.5,4.15,10,0.35,{size:11,color:"64748B"});

  const badges=[["LangGraph.js","6366F1"],["MCP Protocol","F59E0B"],
    ["PostgreSQL+pgvector","336791"],["Groq LLM","10B981"],
    ["Gemini AI","EA4335"],["Node.js ESM","68A063"]];
  badges.forEach(([lbl,col],i)=>{
    const bx = 3.2+(i%3)*2.35, by = 5.05+Math.floor(i/3)*0.52;
    rect(s,bx,by,1.65,0.32, "1E293B", col, 0.14, false);
    txt(s,lbl,bx,by,1.65,0.32,{size:9,bold:true,color:col});
  });

  txt(s,"10 slides  ·  31 technical steps  ·  4 MCP microservers  ·  6 protocol types",
      1.5,6.65,10,0.25,{size:9,color:"475569"});
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 2 — MCP ROUTING OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
function buildOverview() {
  const s = pptx.addSlide();
  header(s,"MCP Routing Architecture — How Each Request Is Dispatched",
         "OVERVIEW  ·  INPUTS → EXPRESS → LANGGRAPH → MCP MANAGER → MCP SERVERS → SERVICES");

  const CX_IN=0.52, BUS=1.05, CX_BK=1.62;
  const HL=2.38, HR=4.72, HCX=(HL+HR)/2;
  const CX_MCP=5.82, CX_SL=7.85, CX_SR=9.3, CX_SC=8.57;
  const Y=[0.87,1.82,2.77,3.72,4.57];
  const RCY=Y.map(y=>y+0.32);
  const HT=0.75, HH=5.52, IW=HR-HL;

  // column labels
  [  [CX_IN,"INPUTS"],[CX_BK,"BACKEND"],[HCX,"MCP CLIENT MANAGER"],
     [CX_MCP,"MCP SERVERS"],[(CX_SL+CX_SR)/2,"AI / SERVICES"],
  ].forEach(([x,lbl])=>
    txt(s,lbl,x-0.65,0.67,1.3,0.16,{size:6.5,bold:true,color:"94A3B8"}));

  // ── Hub box ──
  rect(s,HL,HT,IW,HH,"FFFBEB","F59E0B",0.1);
  s.addShape(pptx.ShapeType.roundRect,
    {x:HL,y:HT,w:IW,h:0.44,rectRadius:0.1,fill:{color:"D97706"},line:{color:"D97706",pt:0}});
  txt(s,"🔀  MCP Client Manager",HL+0.05,HT+0.04,IW-0.1,0.22,
      {size:10,bold:true,color:"FFFFFF"});
  txt(s,"mcp-client-manager.js",HL+0.05,HT+0.25,IW-0.1,0.16,
      {size:7,color:"FEF3C7"});
  rect(s,HL+0.08,HT+0.47,IW-0.16,0.19,"FEF3C7","F59E0B",0.04,false);
  txt(s,"TOOL_REGISTRY — routes by tool name",HL+0.08,HT+0.47,IW-0.16,0.19,
      {size:7.5,bold:true,color:"92400E"});

  const routes=[
    {tools:["analyze_resume","analyze_resume_only","send_invite"],
     server:"→ resume server",    color:"3B82F6", row:0},
    {tools:["candidate_lookup","candidate_benchmarks"],
     server:"→ candidate server", color:"10B981", row:1},
    {tools:["schedule_candidate","auto_assign_and_confirm"],
     server:"→ scheduling server",color:"8B5CF6", row:2},
    {tools:["list_hr_requests","approve_hr","reject_hr"],
     server:"→ hr server",        color:"EF4444", row:3},
    {tools:["create_event"],
     server:"→ calendar (ext)",   color:"EC4899", row:4},
  ];
  routes.forEach(rb=>{
    const bh=rb.tools.length*0.155+0.2;
    const bt=RCY[rb.row]-bh/2;
    rect(s,HL+0.08,bt,IW-0.16,bh,"FFFFFF",rb.color,0.05,false);
    const items=rb.tools.map(t=>({
      text:t+"\n",options:{fontSize:6.5,color:"475569",fontFace:"Courier New"},
    }));
    items.push({text:rb.server,options:{fontSize:7.5,bold:true,color:rb.color}});
    s.addText(items,{x:HL+0.12,y:bt+0.05,w:IW-0.24,h:bh-0.1,valign:"top"});
  });

  // auto-respawn note
  const ny=RCY[4]+0.45;
  rect(s,HL+0.08,ny,IW-0.16,0.3,"EFF6FF","BFDBFE",0.05,false);
  txt(s,"⟳ Auto-respawn on close · Per-server stats · isMCPToolAvailable()",
      HL+0.08,ny,IW-0.16,0.3,{size:6.5,color:"1D4ED8"});

  // ── inputs ──
  [{e:"🌐",l:"Web Upload",  sb:"POST /upload"},
   {e:"📧",l:"Email IMAP",  sb:"imapflow"},
   {e:"🕵️",l:"Folder Watch",sb:"chokidar"},
   {e:"👩‍💼",l:"Admin Panel", sb:"HR Dashboard"},
   {e:"📋",l:"Interviewer",  sb:"Portal"},
  ].forEach(({e,l,sb},i)=>comp(s,CX_IN-0.52,Y[i],e,l,sb));

  // ── Express + LangGraph ──
  comp(s,CX_BK-0.52,1.7, "⚡","Express.js","API Router");
  comp(s,CX_BK-0.52,2.92,"🔄","LangGraph", "Workflow");

  // ── MCP server icons ──
  const mcps=[
    {c:"3B82F6",e:"📄⚙️",l:"MCP Resume",    sb:"mcp-resume-server"},
    {c:"10B981",e:"👤⚙️",l:"MCP Candidate", sb:"mcp-candidate-server"},
    {c:"8B5CF6",e:"📅⚙️",l:"MCP Scheduling",sb:"mcp-scheduling-server"},
    {c:"EF4444",e:"👥⚙️",l:"MCP HR",        sb:"mcp-hr-server"},
    {c:"EC4899",e:"🌐⚙️",l:"Calendar MCP",  sb:"StreamableHTTP (ext)"},
  ];
  mcps.forEach((m,i)=>comp(s,CX_MCP-0.55,Y[i],m.e,m.l,m.sb,m.c));

  // ── services ──
  comp(s,CX_SL-0.97,Y[0]-0.08,"🧠","Ollama",    "nomic-embed");
  comp(s,CX_SL+0.12,Y[0]-0.08,"⚡","Groq LLM", "scorer");
  comp(s,CX_SC-0.52,Y[0]+0.72,"🗄️","PostgreSQL","+pgvector");
  comp(s,CX_SC-0.52,Y[1],      "🗄️","PostgreSQL","candidates");
  comp(s,CX_SL-0.5, Y[2],      "🗄️","PostgreSQL","slots");
  comp(s,CX_SR-0.5, Y[2],      "📮","Nodemailer","SMTP");
  comp(s,CX_SL-0.5, Y[3],      "🗄️","PostgreSQL","requests");
  comp(s,CX_SR-0.5, Y[3],      "📮","Nodemailer","SMTP");
  comp(s,CX_SC-0.52,Y[4],      "📅","Google/Yahoo","Calendar");

  // ── arrows ──
  // vertical bus
  line(s,BUS,RCY[0],BUS,RCY[4],"CBD5E1",1,true,false);
  Y.forEach((_,i)=>line(s,CX_IN+0.52,RCY[i],BUS,RCY[i],"CBD5E1",1,false,false));

  // bus → express
  const eCY=1.7+0.32;
  line(s,BUS,eCY,CX_BK-0.52,eCY,"3B82F6",1.5,false,true);
  badge(s,(BUS+CX_BK-0.52)/2,eCY-0.13,"HTTP","EFF6FF","3B82F6","1D4ED8");

  // express → langgraph
  line(s,CX_BK,1.7+0.65,CX_BK,2.92,"64748B",1.5,false,true);

  // langgraph → hub
  const lgAY=2.92+0.32;
  line(s,CX_BK+0.52,lgAY,HL,lgAY,"F59E0B",2,false,true);
  badge(s,(CX_BK+0.52+HL)/2,lgAY-0.12,"callMCPTool()","FFFBEB","F59E0B","B45309");

  // hub → mcp servers
  mcps.forEach((m,i)=>{
    const ay=RCY[i];
    line(s,HR,ay,CX_MCP-0.55,ay,m.c,2,false,true);
    const proto=m.sb.includes("HTTP")?"HTTPS":"stdio";
    badge(s,(HR+CX_MCP-0.55)/2,ay-0.11,proto,"FFFFFF",m.c,m.c);
  });

  // mcp → services (thin dashed)
  const da=(x1,y1,x2,y2)=>line(s,x1,y1,x2,y2,"94A3B8",0.8,true,true);
  da(CX_MCP+0.5,RCY[0]-0.08, CX_SL-0.97+1.05, Y[0]-0.08+0.32);
  da(CX_MCP+0.5,RCY[0]+0.08, CX_SL+0.12,      Y[0]-0.08+0.32);
  da(CX_MCP+0.5,RCY[0]+0.2,  CX_SC-0.52+0.52, Y[0]+0.72+0.32);
  da(CX_MCP+0.5,RCY[1],      CX_SC-0.52,       RCY[1]);
  da(CX_MCP+0.5,RCY[2]-0.07, CX_SL-0.5,        RCY[2]);
  da(CX_MCP+0.5,RCY[2]+0.07, CX_SR-0.5,        RCY[2]);
  da(CX_MCP+0.5,RCY[3]-0.07, CX_SL-0.5,        RCY[3]);
  da(CX_MCP+0.5,RCY[3]+0.07, CX_SR-0.5,        RCY[3]);
  da(CX_MCP+0.5,RCY[4],      CX_SC-0.52,        RCY[4]);

  footer(s,2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP SLIDE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
function stepSlide(title, sub, steps, pageNum) {
  const s = pptx.addSlide();
  header(s, title, sub);

  const ROWS = steps.length;
  const ROW_H = (7.12 - 0.7) / ROWS;
  const COMP_W = 1.05, COMP_H = 0.68;
  const NOTE_X = 9.85, NOTE_W = 3.3;

  steps.forEach((step, si) => {
    const rowTop = 0.7 + si * ROW_H;
    const compY  = rowTop + (ROW_H - COMP_H) / 2;
    const arrowY = compY + COMP_H / 2;

    // divider
    if (si > 0)
      line(s,0,rowTop-0.03,13.33,rowTop-0.03,"E2E8F0",0.6,true,false);

    // step badge
    stepBadge(s, 0.1, rowTop + ROW_H/2 - 0.16, step.n);

    // compute component X positions dynamically
    const n = step.comps.length;
    const avail = NOTE_X - 0.55 - 0.05;   // space between badge and note box
    const stride = Math.min(3.2, avail / (n - 0.1));
    const BASE_X = 0.55;

    step.comps.forEach((c, ci) => {
      const cx = BASE_X + ci * stride;
      comp(s, cx, compY, c.emoji, c.label, c.sub || "");

      if (step.arrows[ci]) {
        const x1 = cx + COMP_W;
        const x2 = BASE_X + (ci+1)*stride;
        harrow(s, x1, arrowY, x2, step.arrows[ci].proto, step.arrows[ci].dashed);

        if (step.payloads?.[ci]) {
          const mx = (x1+x2)/2;
          const py = arrowY + 0.13;
          if (py + 0.4 < rowTop + ROW_H - 0.04)
            payloadBox(s, mx, py, step.payloads[ci]);
        }
      }
    });

    // note box
    if (step.note) {
      const lines = step.note.split("|");
      const nh = Math.max(COMP_H, 0.28 + lines.length * 0.145);
      noteBox(s, NOTE_X, compY, NOTE_W, nh, lines);
    }
  });

  footer(s, pageNum);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALL STEP SLIDES
// ═══════════════════════════════════════════════════════════════════════════════
function buildSteps() {

  // ── Slide 3 ──────────────────────────────────────────────────────────────
  stepSlide("Resume Upload & Request Handling",
            "STEPS 1–4  ·  ENTRY POINTS → EXPRESS → MULTER → LANGGRAPH INIT",
  [
    { n:1,
      comps:[{emoji:"🌐",label:"Web Browser",sub:"CV Upload UI"},
             {emoji:"⚡",label:"Express.js", sub:"/upload route"},
             {emoji:"📦",label:"multer",     sub:"memStorage"},
             {emoji:"💾",label:"File Buffer",sub:"Uint8Array"}],
      arrows:[{proto:"http"},{proto:"mem"},{proto:"mem"}],
      payloads:[["POST /upload","multipart/form-data"],["req.file.buffer"],["Buffer + mimetype"]],
      note:"multer memoryStorage|file stays in RAM|never written to disk" },
    { n:2,
      comps:[{emoji:"⚡",label:"Express.js",sub:"upload.js"},
             {emoji:"🆔",label:"UUID v4",   sub:"threadId gen"},
             {emoji:"🗄️",label:"PostgreSQL",sub:"candidates"},
             {emoji:"📬",label:"LangGraph", sub:"graph.invoke()"}],
      arrows:[{proto:"mem"},{proto:"sql"},{proto:"mem"}],
      payloads:[["threadId = uuid()"],["INSERT candidates","(thread_id, email...)"],["state:{threadId,resumeBuffer}"]],
      note:"LangGraph compiled|once on startup|invoke() = new run" },
    { n:3,
      comps:[{emoji:"🔄",label:"LangGraph",  sub:"Workflow"},
             {emoji:"💾",label:"PostgresSaver",sub:"Checkpoint"},
             {emoji:"🗄️",label:"PostgreSQL", sub:"lg_checkpoints"}],
      arrows:[{proto:"mem"},{proto:"sql"}],
      payloads:[["checkpoint.put()","state snapshot"],["INSERT lg_checkpoints"]],
      note:"State persisted at|each node boundary|allows resumption" },
    { n:4,
      comps:[{emoji:"🔄",label:"LangGraph",  sub:"routes"},
             {emoji:"🔷",label:"check_domain",sub:"_and_duplicate"}],
      arrows:[{proto:"mem"}],
      payloads:[["first node call"]],
      note:"graph.invoke() calls|first node in the|compiled workflow" },
  ], 3);

  // ── Slide 4 ──────────────────────────────────────────────────────────────
  stepSlide("Duplicate Check Node & PostgreSQL",
            "STEPS 5–7  ·  NODE: check_domain_and_duplicate → SHA-256 → DB QUERY → INSERT",
  [
    { n:5,
      comps:[{emoji:"🔷",label:"check_domain",sub:"_and_duplicate"},
             {emoji:"#️⃣",label:"crypto",      sub:"SHA-256"},
             {emoji:"💠",label:"resumeHash",  sub:"hex 64 chars"}],
      arrows:[{proto:"mem"},{proto:"mem"}],
      payloads:[["createHash('sha256')",".update(buf).digest('hex')"],["'a3f9bc...'"]],
      note:"SHA-256 detects exact|duplicate files even|if email changes" },
    { n:6,
      comps:[{emoji:"🔷",label:"check_domain",sub:"node"},
             {emoji:"🗄️",label:"PostgreSQL", sub:"candidates"},
             {emoji:"❓",label:"Duplicate?",  sub:"hash OR email"}],
      arrows:[{proto:"sql"},{proto:"mem"}],
      payloads:[["SELECT thread_id FROM candidates","WHERE interview_id=$1","AND (resume_hash=$2 OR email=$3)"],
                ["rows.length>0 → Rejected","else → continue"]],
      note:"Scoped per interview|Same candidate can|apply to multiple jobs" },
    { n:7,
      comps:[{emoji:"🔷",label:"check_domain",sub:"new candidate"},
             {emoji:"🗄️",label:"PostgreSQL", sub:"INSERT"},
             {emoji:"✅",label:"State Update",sub:"Screening"},
             {emoji:"🔄",label:"LangGraph",  sub:"→ analyze_resume"}],
      arrows:[{proto:"sql"},{proto:"mem"},{proto:"mem"}],
      payloads:[["INSERT INTO candidates","(thread_id, interview_id,","email, resume_hash,","status='Screening')"],
                ["{resumeHash,status}"],["routes to analyze_resume"]],
      note:"" },
  ], 4);

  // ── Slide 5 ──────────────────────────────────────────────────────────────
  stepSlide("MCP Call & Text Extraction",
            "STEPS 8–11  ·  analyze_resume NODE → MCP JSON-RPC → TEXT EXTRACTION → OLLAMA EMBED → PGVECTOR",
  [
    { n:8,
      comps:[{emoji:"🧩",label:"analyze_resume",sub:"LG Node"},
             {emoji:"🔀",label:"MCP Manager",  sub:"TOOL_REGISTRY"},
             {emoji:"📄⚙️",label:"mcp-resume",  sub:"-server.js"}],
      arrows:[{proto:"mcp"},{proto:"mcp"}],
      payloads:[["isMCPToolAvailable?","encode base64"],
                ["JSON-RPC 2.0 stdio","{name:'analyze_resume_only',","args:{threadId,resumeBase64}}"]],
      note:"TOOL_REGISTRY maps|'analyze_resume_only'|→ 'resume' server|child process" },
    { n:9,
      comps:[{emoji:"📄⚙️",label:"mcp-resume",  sub:"server"},
             {emoji:"🔍",label:"Magic Bytes",  sub:"file type detect"},
             {emoji:"📝",label:"Text Extract", sub:"mammoth/pdf-parse"},
             {emoji:"📃",label:"resumeText",   sub:"plain string"}],
      arrows:[{proto:"mem"},{proto:"mem"},{proto:"mem"}],
      payloads:[["buf[0]===0x50? DOCX","buf[0]===0xD0? DOC","else PDF"],
                ["mammoth / word-extractor","/ pdf-parse / pdfjs-dist"],
                ["text length ≥ 50 chars"]],
      note:"Multi-strategy PDF:|pdf-parse → pdfjs-dist|→ raw regex fallback" },
    { n:10,
      comps:[{emoji:"📃",label:"resumeText",   sub:"candidate text"},
             {emoji:"🧠",label:"Ollama",       sub:"nomic-embed-text"},
             {emoji:"📐",label:"vector[768]",  sub:"embedding"},
             {emoji:"🗄️",label:"pgvector",    sub:"cosine search"}],
      arrows:[{proto:"https"},{proto:"mem"},{proto:"sql"}],
      payloads:[["POST :11434/api/embeddings"],["float32 [768]"],
                ["ORDER BY embedding <=> $2","LIMIT 5 JD chunks"]],
      note:"<=> is pgvector|cosine distance op|Top-5 JD chunks|= RAG context" },
    { n:11,
      comps:[{emoji:"📋",label:"RAG Context",  sub:"top-5 JD chunks"},
             {emoji:"⚡",label:"Groq LLM",    sub:"llama-3 / mixtral"},
             {emoji:"📊",label:"Score JSON",  sub:"{score, matching...}"}],
      arrows:[{proto:"https"},{proto:"mem"}],
      payloads:[["POST api.groq.com/v1/chat"],
                ["{score:82,matching:[..],","missing:[..],summary:'...'}"]],
      note:"callWithRetry() wraps|Groq — retries 3x|on rate-limit errors" },
  ], 5);

  // ── Slide 6 ──────────────────────────────────────────────────────────────
  stepSlide("Score Persistence & Threshold Gate",
            "STEPS 12–15  ·  DB UPDATE → STATE MERGE → CONDITIONAL EDGE → INVITE / REJECT",
  [
    { n:12,
      comps:[{emoji:"⚡",label:"Groq Response",sub:"parsed JSON"},
             {emoji:"🗄️",label:"PostgreSQL",  sub:"candidates"},
             {emoji:"📤",label:"stdio reply",  sub:"to MCP client"}],
      arrows:[{proto:"sql"},{proto:"mcp"}],
      payloads:[["UPDATE candidates SET","resume_score, summary"],
                ["JSON-RPC result:","{ok:true,resumeScore:82}"]],
      note:"If MCP throws,|nodes.js fallback|runs same logic|in-process" },
    { n:13,
      comps:[{emoji:"🧩",label:"analyze_resume",sub:"node return"},
             {emoji:"🔄",label:"LangGraph",    sub:"state merge"},
             {emoji:"💾",label:"PostgresSaver",sub:"checkpoint"}],
      arrows:[{proto:"mem"},{proto:"sql"}],
      payloads:[["{resumeScore:82,","resumeBuffer:null}"],
                ["upsert checkpoint","for thread_id"]],
      note:"resumeBuffer=null|after scoring frees|memory in the graph" },
    { n:14,
      comps:[{emoji:"🔄",label:"LangGraph",    sub:"conditional edge"},
             {emoji:"🗄️",label:"PostgreSQL",  sub:"interviews"},
             {emoji:"◆", label:"Threshold",    sub:"score ≥ threshold?"}],
      arrows:[{proto:"sql"},{proto:"mem"}],
      payloads:[["SELECT score_threshold","FROM interviews WHERE id=$1"],
                ["resumeScore >= threshold?"]],
      note:"Threshold is per-|interview config|set by HR in admin" },
    { n:15,
      comps:[{emoji:"◆", label:"Threshold Gate",sub:"decision"},
             {emoji:"✉️",label:"send_invite",   sub:"YES path"},
             {emoji:"❌",label:"reject_candidate",sub:"NO path"}],
      arrows:[{proto:"mem"},{proto:"mem"}],
      payloads:[["score ≥ N → send_invite"],["score < N → reject"]],
      note:"reject only does|SQL UPDATE — no email|Admin bulk-sends later" },
  ], 6);

  // ── Slide 7 ──────────────────────────────────────────────────────────────
  stepSlide("Invitation Flow — Credentials & Email",
            "STEPS 16–19  ·  send_invite NODE → MCP → BCRYPT → NODEMAILER SMTP",
  [
    { n:16,
      comps:[{emoji:"✉️",label:"send_invite",  sub:"LG Node"},
             {emoji:"🔀",label:"MCP Manager",  sub:"routes tool"},
             {emoji:"📄⚙️",label:"mcp-resume", sub:"-server.js"},
             {emoji:"🔑",label:"Credential",   sub:"Generator"}],
      arrows:[{proto:"mcp"},{proto:"mcp"},{proto:"mem"}],
      payloads:[["tool:'send_invite'"],["JSON-RPC stdio"],
                ["randomBytes(4).toString('hex')","→ loginToken (8 chars)"]],
      note:"Also has in-process|fallback — same cred|gen + email logic" },
    { n:17,
      comps:[{emoji:"🔑",label:"Credential",   sub:"Generator"},
             {emoji:"🔐",label:"bcrypt",       sub:"hash(pw, 10)"},
             {emoji:"🗄️",label:"PostgreSQL",   sub:"candidates"}],
      arrows:[{proto:"mem"},{proto:"sql"}],
      payloads:[["randomBytes(6)",".toString('base64url')","→ plainPassword"],
                ["UPDATE SET login_token,","password_hash,","must_change_password=TRUE"]],
      note:"bcrypt cost=10:|~100ms hash time|Candidate must change|pw on first login" },
    { n:18,
      comps:[{emoji:"📄⚙️",label:"mcp-resume", sub:"server"},
             {emoji:"📮",label:"Nodemailer",   sub:"SMTP transport"},
             {emoji:"📧",label:"SMTP Server",  sub:"Gmail / custom"},
             {emoji:"📬",label:"Candidate",    sub:"Email Inbox"}],
      arrows:[{proto:"mem"},{proto:"smtp"},{proto:"smtp"}],
      payloads:[["sendInvitationEmail()"],["STARTTLS / AUTH LOGIN"],
                ["Subject: Interview Invite"]],
      note:"Email has one-time|login link + temp|password for portal" },
    { n:19,
      comps:[{emoji:"📄⚙️",label:"mcp-resume", sub:"reply"},
             {emoji:"🗄️",label:"PostgreSQL",   sub:"candidates"},
             {emoji:"🔄",label:"LangGraph",    sub:"graph END"}],
      arrows:[{proto:"sql"},{proto:"mcp"}],
      payloads:[["SET status='AwaitingVideo'"],
                ["{ok:true,status:'AwaitingVideo'}"]],
      note:"Graph reaches END|Candidate portal shows|video upload UI" },
  ], 7);

  // ── Slide 8 ──────────────────────────────────────────────────────────────
  stepSlide("Video Submission & AI Analysis",
            "STEPS 20–23  ·  CANDIDATE PORTAL → VIDEO → GEMINI AI → GROQ FALLBACK → FINAL SCORES",
  [
    { n:20,
      comps:[{emoji:"👤",label:"Candidate",   sub:"Browser"},
             {emoji:"⚡",label:"Express.js",  sub:"/candidate/video"},
             {emoji:"📦",label:"multer",      sub:"diskStorage"},
             {emoji:"📁",label:"uploads/",    sub:"video file"}],
      arrows:[{proto:"http"},{proto:"mem"},{proto:"mem"}],
      payloads:[["POST /candidate/video","multipart/form-data"],
                ["req.file → disk"],["uploads/<threadId>.mp4"]],
      note:"diskStorage (not mem)|video can be 100+ MB|stays on disk" },
    { n:21,
      comps:[{emoji:"📁",label:"Video File",  sub:"mp4 / webm"},
             {emoji:"🎬",label:"video-analysis",sub:".js service"},
             {emoji:"✨",label:"Gemini AI",   sub:"gemini-2.0-flash"},
             {emoji:"📊",label:"Analysis JSON",sub:"scores+summary"}],
      arrows:[{proto:"mem"},{proto:"https"},{proto:"mem"}],
      payloads:[["readFileSync → base64"],
                ["POST /v1/models/gemini","inlineData:{mimeType,data}"],
                ["{english_score,confidence,","skills,salary,summary}"]],
      note:"Gemini receives raw|video as base64|no URL needed" },
    { n:22,
      comps:[{emoji:"🎬",label:"video-analysis",sub:"fallback path"},
             {emoji:"🏠",label:"local-video",  sub:"analyze.js"},
             {emoji:"⚡",label:"Groq LLM",    sub:"transcript score"}],
      arrows:[{proto:"mem"},{proto:"https"}],
      payloads:[["if Gemini unavailable","→ local analyzer"],
                ["text-only score","no vision capability"]],
      note:"Graceful fallback|when Gemini API|unavailable or|cost-limited" },
    { n:23,
      comps:[{emoji:"📊",label:"Video Scores",sub:"parsed JSON"},
             {emoji:"🗄️",label:"PostgreSQL",  sub:"candidates"},
             {emoji:"📈",label:"Final Result", sub:"composite score"},
             {emoji:"👩‍💼",label:"Admin Panel",  sub:"shows scores"}],
      arrows:[{proto:"sql"},{proto:"sql"},{proto:"http"}],
      payloads:[["UPDATE SET english_score,","confidence, skills,","video_summary"],
                ["SET final_result,status='Done'"],["GET /admin/candidates"]],
      note:"" },
  ], 8);

  // ── Slide 9 ──────────────────────────────────────────────────────────────
  stepSlide("Scheduling Flow — MCP Scheduling Server",
            "STEPS 24–27  ·  ADMIN TRIGGER → MCP SCHEDULING → SLOT SEARCH → CALENDAR MCP",
  [
    { n:24,
      comps:[{emoji:"👩‍💼",label:"Admin Panel",  sub:"HR dashboard"},
             {emoji:"⚡",label:"Express.js",   sub:"POST /schedule"},
             {emoji:"📅⚙️",label:"mcp-scheduling",sub:"-server.js"}],
      arrows:[{proto:"http"},{proto:"mcp"}],
      payloads:[["POST /candidates/:id/schedule"],
                ["JSON-RPC stdio","tool:'schedule_candidate'"]],
      note:"TOOL_REGISTRY maps|'schedule_candidate'|→ scheduling server" },
    { n:25,
      comps:[{emoji:"📅⚙️",label:"mcp-scheduling",sub:"server"},
             {emoji:"🗄️",label:"PostgreSQL",  sub:"interviewer_slots"},
             {emoji:"⚡",label:"Groq LLM",    sub:"slot priority"},
             {emoji:"📋",label:"Best Slots",  sub:"ordered list"}],
      arrows:[{proto:"sql"},{proto:"https"},{proto:"mem"}],
      payloads:[["SELECT slot_start, slot_end","FROM interviewer_slots","WHERE status='available'"],
                ["Groq ranks by time,","load, seniority"],["slots[0..N] sorted"]],
      note:"Groq ranking optional|falls back to|chronological order" },
    { n:26,
      comps:[{emoji:"📅⚙️",label:"mcp-scheduling",sub:"server"},
             {emoji:"🗄️",label:"PostgreSQL",  sub:"scheduled_interviews"},
             {emoji:"📮",label:"Nodemailer",  sub:"SMTP"},
             {emoji:"📬",label:"Candidate",   sub:"slot choices email"}],
      arrows:[{proto:"sql"},{proto:"mem"},{proto:"smtp"}],
      payloads:[["INSERT scheduled_interviews","status='pending_candidate',","candidate_token,..."],
                ["sendCandidateSlotEmail()"],["Email with slot options"]],
      note:"" },
    { n:27,
      comps:[{emoji:"👤",label:"Candidate",   sub:"confirms slot"},
             {emoji:"🗄️",label:"PostgreSQL",  sub:"status='confirmed'"},
             {emoji:"🌐⚙️",label:"Calendar MCP",sub:"StreamableHTTP"},
             {emoji:"📅",label:"Google/Yahoo", sub:"Calendar API"}],
      arrows:[{proto:"http"},{proto:"https"},{proto:"https"}],
      payloads:[["GET /confirm/:token"],
                ["POST https://cal-mcp/mcp","Authorization: Bearer <key>","tool:'create_event'"],
                ["calendar event created"]],
      note:"Calendar MCP is|external / pluggable|Uses HTTPS not stdio" },
  ], 9);

  // ── Slide 10 ──────────────────────────────────────────────────────────────
  stepSlide("HR Management — MCP HR Server",
            "STEPS 28–31  ·  MCP HR SERVER → APPROVE / REJECT → NOTIFICATIONS → HEALTH CHECK",
  [
    { n:28,
      comps:[{emoji:"👩‍💼",label:"Admin Panel",  sub:"HR Requests"},
             {emoji:"⚡",label:"Express.js",   sub:"GET /hr/requests"},
             {emoji:"👥⚙️",label:"mcp-hr",     sub:"-server.js"},
             {emoji:"🗄️",label:"PostgreSQL",   sub:"assignment_requests"}],
      arrows:[{proto:"http"},{proto:"mcp"},{proto:"sql"}],
      payloads:[["GET /admin/hr-requests"],
                ["tool:'list_hr_assignment_requests'","{status:'pending',limit:50}"],
                ["SELECT ar.*, c.email,","i.name FROM requests..."]],
      note:"" },
    { n:29,
      comps:[{emoji:"👩‍💼",label:"HR Admin",   sub:"approves"},
             {emoji:"👥⚙️",label:"mcp-hr",    sub:"-server.js"},
             {emoji:"🗄️",label:"PostgreSQL",  sub:"UPDATE status"},
             {emoji:"📅⚙️",label:"mcp-scheduling",sub:"auto-assign"}],
      arrows:[{proto:"http"},{proto:"sql"},{proto:"mcp"}],
      payloads:[["tool:'approve_hr_assignment'","{requestId,interviewerId}"],
                ["UPDATE SET status='approved'","interviewer_id=$1"],
                ["autoAssignAndConfirm()","JSON-RPC stdio"]],
      note:"Approval triggers|auto-confirm which|finds best slot and|books the interview" },
    { n:30,
      comps:[{emoji:"👥⚙️",label:"mcp-hr",    sub:"-server.js"},
             {emoji:"📮",label:"Nodemailer",  sub:"SMTP"},
             {emoji:"📬",label:"Interviewer", sub:"notification"},
             {emoji:"📬",label:"Candidate",   sub:"confirmation"}],
      arrows:[{proto:"mem"},{proto:"smtp"},{proto:"smtp"}],
      payloads:[["sendHrApprovalNotification()"],
                ["slot + Google Meet link"],["confirmed slot + meet link"]],
      note:"Both parties get|confirmation with|Google Meet link" },
    { n:31,
      comps:[{emoji:"🔀",label:"MCP Manager", sub:"health stats"},
             {emoji:"⚡",label:"Express.js",  sub:"GET /debug/mcp"},
             {emoji:"👩‍💼",label:"Admin Panel",  sub:"MCP health view"}],
      arrows:[{proto:"mem"},{proto:"http"}],
      payloads:[["getMCPDebugStatus()","{servers:{resume:{available,","totalCalls,failedCalls...}}}"],
                ["JSON response","per-server health"]],
      note:"Auto-respawn fires|3s after drop|Per-server stats for|ops monitoring" },
  ], 10);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════════════════
buildCover();
buildOverview();
buildSteps();

pptx.writeFile({ fileName: OUT })
  .then(() => console.log(`Done → ${OUT}`))
  .catch(err => { console.error(err); process.exit(1); });
