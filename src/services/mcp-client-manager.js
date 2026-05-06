import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Maps every tool name to the server that owns it
const TOOL_REGISTRY = {
  analyze_resume: "resume",
  analyze_resume_only: "resume",
  send_invite: "resume",
  candidate_lookup: "candidate",
  candidate_benchmarks: "candidate",
  schedule_candidate: "scheduling",
  auto_assign_and_confirm_candidate: "scheduling",
  list_hr_assignment_requests: "hr",
  approve_hr_assignment_request: "hr",
  reject_hr_assignment_request: "hr",
};

const SERVER_CONFIGS = [
  { name: "resume",     file: "mcp-resume-server.js" },
  { name: "candidate",  file: "mcp-candidate-server.js" },
  { name: "scheduling", file: "mcp-scheduling-server.js" },
  { name: "hr",         file: "mcp-hr-server.js" },
];

// Runtime state for each managed server
const servers = {};
for (const cfg of SERVER_CONFIGS) {
  servers[cfg.name] = {
    name: cfg.name,
    serverPath: path.join(__dirname, cfg.file),
    client: null,
    transport: null,
    available: false,
    stats: { connectedAt: null, totalCalls: 0, failedCalls: 0, lastCall: null },
  };
}

function parseToolResult(result) {
  const first = result?.content?.[0];
  if (!first || typeof first.text !== "string") return null;
  try {
    return JSON.parse(first.text);
  } catch {
    return { ok: true, raw: first.text };
  }
}

async function spawnServer(serverName, Client, StdioClientTransport) {
  const srv = servers[serverName];

  const client = new Client(
    { name: `interview-${serverName}-client`, version: "1.0.0" },
    { capabilities: {} },
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [srv.serverPath],
    cwd: path.join(__dirname, "..", ".."),
    stderr: "pipe",
  });

  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      const line = String(chunk).trim();
      if (line) console.warn(`[MCP:${serverName}] ${line}`);
    });
  }

  // Auto-respawn 3 s after an unexpected drop
  transport.onclose = () => {
    if (!srv.available) return; // already handling a respawn
    console.warn(`[MCP:${serverName}] connection lost — respawning in 3 s`);
    srv.available = false;
    srv.client = null;
    srv.transport = null;
    setTimeout(() => respawnServer(serverName), 3000);
  };

  await client.connect(transport);

  srv.client = client;
  srv.transport = transport;
  srv.available = true;
  srv.stats.connectedAt = new Date().toISOString();
  console.log(`[MCP:${serverName}] connected (pid ${transport.pid ?? "?"})`);
}

async function respawnServer(serverName) {
  try {
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/stdio.js"),
    ]);
    await spawnServer(serverName, Client, StdioClientTransport);
    console.log(`[MCP:${serverName}] respawn successful`);
  } catch (err) {
    console.warn(`[MCP:${serverName}] respawn failed: ${err.message} — will retry in 10 s`);
    setTimeout(() => respawnServer(serverName), 10000);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function initMCPClients() {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);

  const results = await Promise.allSettled(
    SERVER_CONFIGS.map(({ name }) =>
      spawnServer(name, Client, StdioClientTransport),
    ),
  );

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const name = SERVER_CONFIGS[i].name;
      console.warn(`[MCP:${name}] failed to start: ${r.reason?.message}`);
      servers[name].available = false;
    }
  });

  const online = SERVER_CONFIGS.filter((c) => servers[c.name].available).map((c) => c.name);
  const offline = SERVER_CONFIGS.filter((c) => !servers[c.name].available).map((c) => c.name);

  if (online.length) console.log(`MCP servers online: [${online.join(", ")}]`);
  if (offline.length) console.warn(`MCP servers offline (in-process fallback active): [${offline.join(", ")}]`);

  return servers;
}

export function isMCPAvailable(serverName) {
  if (serverName) return servers[serverName]?.available ?? false;
  // true when at least one server is up
  return SERVER_CONFIGS.some((c) => servers[c.name].available);
}

export function isMCPToolAvailable(toolName) {
  const serverName = TOOL_REGISTRY[toolName];
  return serverName ? (servers[serverName]?.available ?? false) : false;
}

export function getMCPDebugStatus() {
  return {
    servers: Object.fromEntries(
      SERVER_CONFIGS.map(({ name }) => {
        const srv = servers[name];
        return [
          name,
          {
            available: srv.available,
            connectedAt: srv.stats.connectedAt,
            serverPath: srv.serverPath,
            serverPid: srv.transport?.pid ?? null,
            totalCalls: srv.stats.totalCalls,
            failedCalls: srv.stats.failedCalls,
            lastCall: srv.stats.lastCall,
          },
        ];
      }),
    ),
    toolRegistry: TOOL_REGISTRY,
  };
}

export async function callMCPTool(name, args = {}) {
  const serverName = TOOL_REGISTRY[name];
  if (!serverName) throw new Error(`Unknown MCP tool: ${name}`);

  const srv = servers[serverName];
  if (!srv?.available || !srv?.client) {
    throw new Error(`MCP server '${serverName}' not available for tool: ${name}`);
  }

  const started = Date.now();
  srv.stats.totalCalls += 1;

  try {
    const result = await srv.client.callTool({ name, arguments: args });
    const parsed = parseToolResult(result);

    if (result?.isError || (parsed && parsed.ok === false)) {
      throw new Error(parsed?.error || `MCP tool failed: ${name}`);
    }

    srv.stats.lastCall = {
      name,
      success: true,
      durationMs: Date.now() - started,
      at: new Date().toISOString(),
    };

    return parsed ?? { ok: true };
  } catch (err) {
    srv.stats.failedCalls += 1;
    srv.stats.lastCall = {
      name,
      success: false,
      error: err.message,
      durationMs: Date.now() - started,
      at: new Date().toISOString(),
    };
    throw err;
  }
}
