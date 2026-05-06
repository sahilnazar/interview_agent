import "dotenv/config";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { initDB } from "../config/db.js";
import {
  getHrAssignmentRequests,
  approveInterviewerAssignmentRequest,
  rejectInterviewerAssignmentRequest,
} from "./scheduler.js";

function textResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function errorResult(message) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
    isError: true,
  };
}

const server = new McpServer({ name: "interview-hr-server", version: "1.0.0" });

server.tool(
  "list_hr_assignment_requests",
  "List HR assignment requests with their status and metadata.",
  {
    status: z.enum(["pending", "approved", "rejected"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  async ({ status, limit }) => {
    try {
      let requests = await getHrAssignmentRequests();
      if (status) requests = requests.filter((r) => r.status === status);
      const capped = requests.slice(0, limit || 50);
      return textResult({ ok: true, count: capped.length, requests: capped });
    } catch (err) {
      return errorResult(err.message || String(err));
    }
  },
);

server.tool(
  "approve_hr_assignment_request",
  "Approve an HR assignment request with selected interviewer.",
  {
    requestId: z.string().uuid(),
    interviewerId: z.string().uuid(),
    notes: z.string().optional(),
  },
  async ({ requestId, interviewerId, notes }) => {
    try {
      const result = await approveInterviewerAssignmentRequest(
        requestId,
        interviewerId,
        notes || "Approved via MCP",
      );
      return textResult({ ok: true, approved: true, scheduledInterview: result });
    } catch (err) {
      return errorResult(err.message || String(err));
    }
  },
);

server.tool(
  "reject_hr_assignment_request",
  "Reject an HR assignment request with notes.",
  {
    requestId: z.string().uuid(),
    notes: z.string().optional(),
  },
  async ({ requestId, notes }) => {
    try {
      await rejectInterviewerAssignmentRequest(requestId, notes || "Rejected via MCP");
      return textResult({ ok: true, rejected: true });
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
