import "dotenv/config";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { initDB } from "../config/db.js";
import { checkDomainAndDuplicate, analyzeResume, sendInvite } from "../graph/nodes.js";

function textResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function errorResult(message) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
    isError: true,
  };
}

const server = new McpServer({ name: "interview-resume-server", version: "1.0.0" });

server.tool(
  "analyze_resume",
  "Run duplicate check and resume analysis for a candidate using existing graph node logic.",
  {
    threadId: z.string().min(1),
    interviewId: z.string().uuid(),
    candidateEmail: z.string().email(),
    resumeBase64: z.string().min(1),
    assignmentMethod: z.string().optional(),
    matchConfidence: z.number().nullable().optional(),
  },
  async ({ threadId, interviewId, candidateEmail, resumeBase64, assignmentMethod, matchConfidence }) => {
    try {
      const resumeBuffer = Buffer.from(resumeBase64, "base64");
      const dupResult = await checkDomainAndDuplicate({
        threadId,
        interviewId,
        candidateEmail,
        resumeBuffer,
        assignmentMethod: assignmentMethod || "mcp",
        matchConfidence: matchConfidence ?? null,
      });

      if (dupResult?.status === "Rejected") {
        return textResult({
          ok: true,
          duplicate: true,
          status: "Rejected",
          reason: "duplicate",
          resumeHash: dupResult.resumeHash,
        });
      }

      const analysis = await analyzeResume({ threadId, interviewId, resumeBuffer });
      return textResult({ ok: true, duplicate: false, ...analysis });
    } catch (err) {
      return errorResult(err.message || String(err));
    }
  },
);

server.tool(
  "analyze_resume_only",
  "Run resume analysis only (no duplicate check) using existing node logic.",
  {
    threadId: z.string().min(1),
    interviewId: z.string().uuid(),
    resumeBase64: z.string().min(1),
  },
  async ({ threadId, interviewId, resumeBase64 }) => {
    try {
      const resumeBuffer = Buffer.from(resumeBase64, "base64");
      const analysis = await analyzeResume({ threadId, interviewId, resumeBuffer });
      return textResult({ ok: true, ...analysis });
    } catch (err) {
      return errorResult(err.message || String(err));
    }
  },
);

server.tool(
  "send_invite",
  "Send candidate invitation email and move candidate to AwaitingVideo using existing node logic.",
  {
    threadId: z.string().min(1),
    candidateEmail: z.string().email(),
  },
  async ({ threadId, candidateEmail }) => {
    try {
      const result = await sendInvite({ threadId, candidateEmail });
      return textResult({ ok: true, ...result });
    } catch (err) {
      return errorResult(err.message || String(err));
    }
  },
);

async function main() {
  await initDB();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  const payload = {
    ok: false,
    error: err.message || String(err),
    stack: err.stack || "",
    timestamp: new Date().toISOString(),
    crashId: crypto.randomUUID(),
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(1);
});
