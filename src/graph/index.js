import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";

import { query } from "../config/db.js";
import { checkDomainAndDuplicate, analyzeResume, markScreened, rejectCandidate } from "./nodes.js";

// ---------------------------------------------------------------------------
// State Annotation
// ---------------------------------------------------------------------------

const InterviewState = Annotation.Root({
  candidateEmail: Annotation({ reducer: (_, v) => v, default: () => "" }),
  resumeBuffer:   Annotation({ reducer: (_, v) => v, default: () => null }),
  resumeHash:     Annotation({ reducer: (_, v) => v, default: () => "" }),
  resumeScore:    Annotation({ reducer: (_, v) => v, default: () => 0 }),
  videoUrl:       Annotation({ reducer: (_, v) => v, default: () => "" }),
  videoAnalysis:  Annotation({ reducer: (_, v) => v, default: () => ({ englishScore: 0, skills: [] }) }),
  status:         Annotation({ reducer: (_, v) => v, default: () => "Screening" }),
  messages:       Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  threadId:       Annotation({ reducer: (_, v) => v, default: () => "" }),
});

// ---------------------------------------------------------------------------
// Conditional routers
// ---------------------------------------------------------------------------

function domainGate(state) {
  return state.status === "Rejected" ? END : "analyze_resume";
}

async function thresholdGate(state) {
  if (state.status === "Error") return END;
  const row = await query("SELECT value FROM settings WHERE key = 'passThreshold'");
  const threshold = parseFloat(row.rows[0].value);
  return state.resumeScore >= threshold ? "mark_screened" : "reject_candidate";
}

// ---------------------------------------------------------------------------
// Graph definition
// ---------------------------------------------------------------------------

const workflow = new StateGraph(InterviewState)
  .addNode("check_domain_and_duplicate", checkDomainAndDuplicate)
  .addNode("analyze_resume", analyzeResume)
  .addNode("mark_screened", markScreened)
  .addNode("reject_candidate", rejectCandidate)
  .addEdge(START, "check_domain_and_duplicate")
  .addConditionalEdges("check_domain_and_duplicate", domainGate)
  .addConditionalEdges("analyze_resume", thresholdGate)
  .addEdge("mark_screened", END)
  .addEdge("reject_candidate", END);

// ---------------------------------------------------------------------------
// createGraph — compile with PostgresSaver (falls back to MemorySaver)
// ---------------------------------------------------------------------------

export async function createGraph() {
  let checkpointer;

  try {
    const mod = await import("@langchain/langgraph-checkpoint-postgres");
    const PostgresSaver = mod.PostgresSaver;
    const connString = `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
    checkpointer = PostgresSaver.fromConnString(connString);
    await checkpointer.setup();
    console.log("Using PostgresSaver checkpointer");
  } catch (err) {
    console.warn("PostgresSaver unavailable, falling back to MemorySaver:", err.message);
    checkpointer = new MemorySaver();
  }

  return workflow.compile({ checkpointer });
}
