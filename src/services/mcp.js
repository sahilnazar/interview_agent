import path from "node:path";
import { fileURLToPath } from "node:url";

let nodeToolsClient = null;
let nodeToolsTransport = null;
let mcpAvailable = false;
const mcpStats = {
  connectedAt: null,
  lastCall: null,
  totalCalls: 0,
  failedCalls: 0,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NODE_TOOLS_SERVER_PATH = path.join(__dirname, "mcp-node-tools-server.js");

function parseToolResult(result) {
  const first = result?.content?.[0];
  if (!first || typeof first.text !== "string") return null;
  try {
    return JSON.parse(first.text);
  } catch {
    return { ok: true, raw: first.text };
  }
}

export async function initMCPClients() {
  try {
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/stdio.js"),
    ]);

    nodeToolsClient = new Client(
      { name: "interview-node-tools-client", version: "1.0.0" },
      { capabilities: {} },
    );

    nodeToolsTransport = new StdioClientTransport({
      command: process.execPath,
      args: [NODE_TOOLS_SERVER_PATH],
      cwd: path.join(__dirname, "..", ".."),
      stderr: "pipe",
    });

    if (nodeToolsTransport.stderr) {
      nodeToolsTransport.stderr.on("data", (chunk) => {
        const line = String(chunk).trim();
        if (line) console.warn(`[MCP server] ${line}`);
      });
    }

    await nodeToolsClient.connect(nodeToolsTransport);

    mcpAvailable = true;
    mcpStats.connectedAt = new Date().toISOString();
    console.log("MCP connected: local node tools server");
  } catch (err) {
    console.warn(`MCP unavailable, using direct in-process services: ${err.message}`);
    mcpAvailable = false;
    mcpStats.connectedAt = null;
    nodeToolsClient = null;
    nodeToolsTransport = null;
  }

  return { nodeToolsClient, mcpAvailable };
}

export function isMCPAvailable() {
  return mcpAvailable;
}

export function getMCPDebugStatus() {
  return {
    available: mcpAvailable,
    connectedAt: mcpStats.connectedAt,
    serverPath: NODE_TOOLS_SERVER_PATH,
    serverPid: nodeToolsTransport?.pid ?? null,
    totalCalls: mcpStats.totalCalls,
    failedCalls: mcpStats.failedCalls,
    lastCall: mcpStats.lastCall,
  };
}

export async function callMCPTool(name, args = {}) {
  if (!mcpAvailable || !nodeToolsClient) {
    throw new Error(`MCP not available for tool call: ${name}`);
  }

  const started = Date.now();
  mcpStats.totalCalls += 1;

  try {
    const result = await nodeToolsClient.callTool({ name, arguments: args });
    const parsed = parseToolResult(result);
    if (result?.isError || (parsed && parsed.ok === false)) {
      throw new Error(parsed?.error || `MCP tool failed: ${name}`);
    }

    mcpStats.lastCall = {
      name,
      success: true,
      durationMs: Date.now() - started,
      at: new Date().toISOString(),
    };

    return parsed ?? { ok: true };
  } catch (err) {
    mcpStats.failedCalls += 1;
    mcpStats.lastCall = {
      name,
      success: false,
      error: err.message,
      durationMs: Date.now() - started,
      at: new Date().toISOString(),
    };
    throw err;
  }
}

export async function analyzeResumeViaMCP(payload) {
  return callMCPTool("analyze_resume", payload);
}

export async function analyzeResumeOnlyViaMCP(payload) {
  return callMCPTool("analyze_resume_only", payload);
}

export async function sendInviteViaMCP(payload) {
  return callMCPTool("send_invite", payload);
}

export async function candidateLookupViaMCP(payload) {
  return callMCPTool("candidate_lookup", payload);
}

export async function candidateBenchmarksViaMCP(payload) {
  return callMCPTool("candidate_benchmarks", payload);
}

export async function scheduleCandidateViaMCP(payload) {
  return callMCPTool("schedule_candidate", payload);
}

export async function autoAssignAndConfirmViaMCP(payload) {
  return callMCPTool("auto_assign_and_confirm_candidate", payload);
}

export async function listHrAssignmentRequestsViaMCP(payload = {}) {
  return callMCPTool("list_hr_assignment_requests", payload);
}

export async function approveHrAssignmentViaMCP(payload) {
  return callMCPTool("approve_hr_assignment_request", payload);
}

export async function rejectHrAssignmentViaMCP(payload) {
  return callMCPTool("reject_hr_assignment_request", payload);
}

// Backward-compatible placeholders from older MCP scaffolding.
export async function pollInbox(_domainRegex) {
  if (!mcpAvailable) return [];
  console.warn("pollInbox via MCP is not configured in node tools server");
  return [];
}

export async function saveFile(_buffer, _filename, _directory) {
  if (!mcpAvailable) return null;
  console.warn("saveFile via MCP is not configured in node tools server");
  return null;
}
