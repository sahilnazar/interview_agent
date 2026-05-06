import "dotenv/config";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { initDB } from "../config/db.js";
import { scheduleCandidate, autoAssignAndConfirmCandidate } from "./scheduler.js";

function textResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function errorResult(message) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
    isError: true,
  };
}

const server = new McpServer({ name: "interview-scheduling-server", version: "1.0.0" });

server.tool(
  "schedule_candidate",
  "Create pending candidate schedule slots via scheduler service.",
  {
    candidateId: z.string().min(1),
    interviewId: z.string().uuid(),
  },
  async ({ candidateId, interviewId }) => {
    try {
      const result = await scheduleCandidate(candidateId, interviewId);
      return textResult({ ok: true, ...result });
    } catch (err) {
      return errorResult(err.message || String(err));
    }
  },
);

server.tool(
  "auto_assign_and_confirm_candidate",
  "Run auto-assignment and auto-confirmation flow for a candidate.",
  {
    candidateId: z.string().min(1),
    interviewId: z.string().uuid(),
  },
  async ({ candidateId, interviewId }) => {
    try {
      const result = await autoAssignAndConfirmCandidate(candidateId, interviewId);
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
