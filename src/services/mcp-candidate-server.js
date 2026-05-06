import "dotenv/config";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { initDB, query } from "../config/db.js";

function textResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function errorResult(message) {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
    isError: true,
  };
}

const server = new McpServer({ name: "interview-candidate-server", version: "1.0.0" });

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
  },
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
