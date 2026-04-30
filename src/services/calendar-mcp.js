import { query } from "../config/db.js";

export async function getCalendarConfig() {
  const result = await query(
    "SELECT key, value FROM settings WHERE key LIKE 'calendar_%'"
  );
  const cfg = {};
  for (const r of result.rows) cfg[r.key] = r.value;
  return {
    provider: cfg.calendar_provider || "none",
    mcpUrl: cfg.calendar_mcp_url || "",
    mcpKey: cfg.calendar_mcp_key || "",
    toolName: cfg.calendar_mcp_tool || "create_event",
  };
}

export function isCalendarConfigured(cfg) {
  return cfg.provider !== "none" && Boolean(cfg.mcpUrl) && Boolean(cfg.mcpKey);
}

async function buildMCPClient(mcpUrl, mcpKey) {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);

  const client = new Client(
    { name: "interview-calendar-client", version: "1.0.0" },
    { capabilities: {} }
  );

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: { Authorization: `Bearer ${mcpKey}` },
    },
  });

  await client.connect(transport);
  return client;
}

export async function testCalendarConnection(mcpUrl, mcpKey) {
  const client = await buildMCPClient(mcpUrl, mcpKey);
  try {
    const { tools } = await client.listTools();
    return { ok: true, tools: tools.map((t) => t.name) };
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Create a calendar event for a confirmed scheduled interview.
 * Looks up all details by scheduledId so callers don't need to pass extra data.
 */
export async function createCalendarEventForScheduledInterview(scheduledId) {
  const cfg = await getCalendarConfig();
  if (!isCalendarConfigured(cfg)) return { ok: false, reason: "not_configured" };

  const result = await query(
    `SELECT si.slot_start, si.slot_end, si.meet_link,
            i.name AS iname, i.email AS iemail,
            c.email AS cemail
     FROM scheduled_interviews si
     JOIN interviewers i ON i.id = si.interviewer_id
     JOIN candidates   c ON c.thread_id = si.candidate_id
     WHERE si.id = $1`,
    [scheduledId]
  );
  if (!result.rows.length) return { ok: false, reason: "not_found" };

  const si = result.rows[0];

  const args = {
    summary: `Interview — ${si.cemail}`,
    description: `Scheduled interview session.\nCandidate: ${si.cemail}\nInterviewer: ${si.iname}`,
    start: { dateTime: new Date(si.slot_start).toISOString() },
    end: { dateTime: new Date(si.slot_end).toISOString() },
    attendees: [{ email: si.cemail }, { email: si.iemail }],
    ...(si.meet_link
      ? { conferenceData: { entryPoints: [{ entryPointType: "video", uri: si.meet_link }] } }
      : {}),
  };

  const client = await buildMCPClient(cfg.mcpUrl, cfg.mcpKey);
  try {
    const mcpResult = await client.callTool({ name: cfg.toolName, arguments: args });
    const isError = mcpResult?.isError;
    if (isError) {
      const msg = mcpResult?.content?.[0]?.text || "MCP tool returned an error";
      console.warn(`[CalendarMCP] ${cfg.toolName} error: ${msg}`);
      return { ok: false, reason: msg };
    }
    console.log(`[CalendarMCP] Event created for scheduled interview ${scheduledId}`);
    return { ok: true };
  } catch (err) {
    console.warn(`[CalendarMCP] createCalendarEvent failed: ${err.message}`);
    return { ok: false, reason: err.message };
  } finally {
    await client.close().catch(() => {});
  }
}
