/**
 * LangChain tool wrappers for all MCP tools.
 *
 * Each spec maps to a LangChain tool() instance whose implementation
 * calls the corresponding MCP server via callMCPTool().
 *
 * Usage:
 *   const tools = createTools(context, ["analyze_resume_only"]);
 *   // tools is an array of LangChain BaseTool instances ready for .bindTools()
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { callMCPTool, isMCPToolAvailable } from "./mcp-client-manager.js";

// ---------------------------------------------------------------------------
// Tool specifications
// ---------------------------------------------------------------------------
// contextKeys: fields that caller-supplied context will override in the args
// (prevents the LLM from hallucinating wrong threadId / interviewId values).

const TOOL_SPECS = [
  // ── Resume Server ──────────────────────────────────────────────────────────
  {
    name: "analyze_resume_only",
    description:
      "Extract text from a base64-encoded resume (PDF, DOCX, or DOC), embed it with " +
      "Ollama, run a pgvector cosine search against the job description chunks, then " +
      "call Groq LLM to produce a score 0-100, matched skills, missing skills, and a " +
      "summary. Updates the candidate row in the database. Use this when a candidate's " +
      "resume needs to be screened and scored for a specific interview position.",
    schema: z.object({
      threadId: z.string().describe("Candidate thread ID (UUID) — must exist in candidates table"),
      interviewId: z.string().describe("Interview ID (UUID) to score the resume against"),
      resumeBase64: z.string().describe("Base64-encoded resume file buffer (PDF / DOCX / DOC)"),
    }),
    contextKeys: ["threadId", "interviewId", "resumeBase64"],
  },

  {
    name: "send_invite",
    description:
      "Generate secure login credentials (random token + bcrypt-hashed password) for a " +
      "candidate who passed the resume score threshold, save them to the database, and " +
      "send an invitation email with the video-upload link and temporary password. Sets " +
      "candidate status to AwaitingVideo. Use immediately after a resume score meets or " +
      "exceeds the interview pass threshold.",
    schema: z.object({
      threadId: z.string().describe("Candidate thread ID (UUID)"),
      candidateEmail: z.string().email().describe("Candidate email — invitation will be sent here"),
    }),
    contextKeys: ["threadId", "candidateEmail"],
  },

  // ── Scheduling Server ──────────────────────────────────────────────────────
  {
    name: "schedule_candidate",
    description:
      "Find the next best available interviewer slot for a candidate, create a pending " +
      "scheduled_interviews row, mark the slot as booked, and email the candidate with " +
      "slot options to confirm. Use this when a candidate has passed all screening but " +
      "should choose their own interview slot.",
    schema: z.object({
      candidateId: z.string().describe("Candidate thread ID (UUID)"),
      interviewId: z.string().describe("Interview ID (UUID)"),
    }),
    contextKeys: ["candidateId", "interviewId"],
  },

  {
    name: "auto_assign_and_confirm_candidate",
    description:
      "Fully automated end-to-end scheduling: AI-scores available interviewers against the " +
      "job description and candidate skills, checks the HR threshold gate (routes to HR " +
      "manual review when best match score is below 40%), auto-confirms the best slot " +
      "without candidate input, and sends confirmation emails with a Google Meet link to " +
      "both candidate and interviewer. Use immediately after candidate status becomes Done " +
      "following successful video analysis.",
    schema: z.object({
      candidateId: z.string().describe("Candidate thread ID (UUID)"),
      interviewId: z.string().describe("Interview ID (UUID)"),
    }),
    contextKeys: ["candidateId", "interviewId"],
  },

  // ── Candidate Server ───────────────────────────────────────────────────────
  {
    name: "candidate_lookup",
    description:
      "Retrieve a candidate's full profile from the database including status, scores, " +
      "skills, video summary, and scheduling information. Use when you need to inspect or " +
      "verify a candidate's current state before taking an action.",
    schema: z.object({
      threadId: z.string().optional().describe("Candidate thread ID (UUID)"),
      email: z.string().optional().describe("Candidate email (alternative lookup key)"),
    }),
    contextKeys: ["threadId", "email"],
  },

  {
    name: "candidate_benchmarks",
    description:
      "Return aggregate score statistics (average, min, max, percentile bands) for all " +
      "candidates in a given interview. Use to understand how a specific candidate compares " +
      "to others who applied for the same position.",
    schema: z.object({
      interviewId: z.string().describe("Interview ID (UUID) to compute benchmarks for"),
    }),
    contextKeys: ["interviewId"],
  },

  // ── HR Server ──────────────────────────────────────────────────────────────
  {
    name: "list_hr_assignment_requests",
    description:
      "List all interviewer assignment requests pending HR manual approval. These are cases " +
      "where the AI interviewer-match score fell below the 40% threshold and automatic " +
      "scheduling was blocked. Returns request ID, candidate info, suggested interviewers " +
      "with AI scores, and the reason for HR escalation.",
    schema: z.object({}),
    contextKeys: [],
  },

  {
    name: "approve_hr_assignment_request",
    description:
      "HR approves a specific interviewer from the suggested list for a pending assignment " +
      "request. Books the interviewer's next available slot, updates the request status to " +
      "approved, and emails the candidate their slot options.",
    schema: z.object({
      requestId: z.string().describe("Assignment request ID (UUID)"),
      interviewerId: z.string().describe("Interviewer ID (UUID) to approve from the suggested list"),
      notes: z.string().optional().describe("Optional HR approval notes"),
    }),
    contextKeys: ["requestId", "interviewerId"],
  },

  {
    name: "reject_hr_assignment_request",
    description:
      "HR rejects a pending interviewer assignment request without booking anyone. Sets " +
      "request status to rejected. No scheduling or emails are sent to the candidate.",
    schema: z.object({
      requestId: z.string().describe("Assignment request ID (UUID)"),
      notes: z.string().optional().describe("Reason for rejection"),
    }),
    contextKeys: ["requestId"],
  },
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build LangChain tool instances for the tools that are currently online.
 *
 * @param {object}   context   Caller-supplied values merged into tool args.
 *                             These take priority over LLM-chosen values.
 * @param {string[]|null} allowList  Whitelist of tool names. null = all tools.
 * @returns {BaseTool[]}
 */
export function createTools(context = {}, allowList = null) {
  return TOOL_SPECS.filter((spec) => {
    if (allowList && !allowList.includes(spec.name)) return false;
    return isMCPToolAvailable(spec.name);
  }).map((spec) =>
    tool(
      async (args) => {
        // Merge: caller-supplied context overrides LLM-chosen args
        const merged = { ...args };
        for (const k of spec.contextKeys) {
          if (context[k] != null) merged[k] = context[k];
        }
        const result = await callMCPTool(spec.name, merged);
        return JSON.stringify(result);
      },
      { name: spec.name, description: spec.description, schema: spec.schema },
    ),
  );
}
