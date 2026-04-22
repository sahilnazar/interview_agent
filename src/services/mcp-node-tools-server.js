import "dotenv/config";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { initDB, query } from "../config/db.js";
import { checkDomainAndDuplicate, analyzeResume, sendInvite } from "../graph/nodes.js";
import {
  getHrAssignmentRequests,
  approveInterviewerAssignmentRequest,
  rejectInterviewerAssignmentRequest,
  scheduleCandidate,
  autoAssignAndConfirmCandidate,
} from "./scheduler.js";

function textResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

function errorResult(message) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
    isError: true,
  };
}

const server = new McpServer({
  name: "interview-agent-node-tools",
  version: "1.0.0",
});

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
  }
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
  }
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
  }
);

server.tool(
  "candidate_lookup",
  "Lookup recent candidates for an interview, optionally filtering by email.",
  {
    interviewId: z.string().uuid(),
    email: z.string().email().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  async ({ interviewId, email, limit }) => {
    try {
      const max = limit || 20;
      let rows;
      if (email) {
        const res = await query(
          `SELECT thread_id, email, status, resume_score, created_at, final_result, assignment_method, match_confidence
           FROM candidates
           WHERE interview_id = $1 AND email = $2
           ORDER BY created_at DESC
           LIMIT $3`,
          [interviewId, email, max],
        );
        rows = res.rows;
      } else {
        const res = await query(
          `SELECT thread_id, email, status, resume_score, created_at, final_result, assignment_method, match_confidence
           FROM candidates
           WHERE interview_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [interviewId, max],
        );
        rows = res.rows;
      }
      return textResult({ ok: true, count: rows.length, candidates: rows });
    } catch (err) {
      return errorResult(err.message || String(err));
    }
  }
);

server.tool(
  "candidate_benchmarks",
  "Get aggregate candidate benchmark metrics for an interview.",
  {
    interviewId: z.string().uuid(),
  },
  async ({ interviewId }) => {
    try {
      const res = await query(
        `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE resume_score IS NOT NULL)::int AS scored,
            ROUND(AVG(resume_score)::numeric, 1) AS avg_resume_score,
            ROUND(MIN(resume_score)::numeric, 1) AS min_resume_score,
            ROUND(MAX(resume_score)::numeric, 1) AS max_resume_score,
            COUNT(*) FILTER (WHERE status = 'Done')::int AS done_count,
            COUNT(*) FILTER (WHERE status = 'Rejected')::int AS rejected_count,
            COUNT(*) FILTER (WHERE status = 'AwaitingVideo')::int AS awaiting_video_count
         FROM candidates
         WHERE interview_id = $1`,
        [interviewId],
      );
      return textResult({ ok: true, benchmarks: res.rows[0] || {} });
    } catch (err) {
      return errorResult(err.message || String(err));
    }
  }
);

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
  }
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
  }
);

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
  }
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
      const result = await approveInterviewerAssignmentRequest(requestId, interviewerId, notes || "Approved via MCP");
      return textResult({ ok: true, approved: true, scheduledInterview: result });
    } catch (err) {
      return errorResult(err.message || String(err));
    }
  }
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
  }
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
