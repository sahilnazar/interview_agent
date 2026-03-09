/**
 * MCP Integration module.
 *
 * Attempts to initialise Gmail and File-Storage MCP clients using
 * @modelcontextprotocol/sdk.  If the SDK is missing or no transports are
 * configured the module falls back gracefully to Nodemailer (email) and
 * local Multer disk storage (files).
 */

let gmailClient = null;
let storageClient = null;
let mcpAvailable = false;

export async function initMCPClients() {
  try {
    const { Client } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );

    gmailClient = new Client({
      name: "interview-gmail-client",
      version: "1.0.0",
    });
    storageClient = new Client({
      name: "interview-storage-client",
      version: "1.0.0",
    });

    // Real MCP transports (SSE / stdio) would be connected here.
    // Without a configured transport the clients are non-functional,
    // so we stay in fallback mode.
    console.warn(
      "MCP: clients created but no transport configured — " +
        "using Nodemailer + local Multer disk storage"
    );
    mcpAvailable = false;
  } catch (err) {
    console.warn(
      `MCP SDK unavailable — falling back to Nodemailer + local Multer disk storage: ${err.message}`
    );
    mcpAvailable = false;
  }

  return { gmailClient, storageClient, mcpAvailable };
}

export function isMCPAvailable() {
  return mcpAvailable;
}

/**
 * Poll a Gmail inbox for PDF attachments matching domainRegex.
 * Returns an empty array when MCP is unavailable.
 */
export async function pollInbox(domainRegex) {
  if (!mcpAvailable || !gmailClient) return [];
  try {
    const result = await gmailClient.callTool({
      name: "gmail_search",
      arguments: { query: "has:attachment filename:pdf", domain: domainRegex },
    });
    return (result.content ?? []).map((item) => JSON.parse(item.text));
  } catch (err) {
    console.error("MCP Gmail poll failed:", err.message);
    return [];
  }
}

/**
 * Save a file via the MCP storage server.
 * Returns null when MCP is unavailable (caller should use local disk).
 */
export async function saveFile(buffer, filename, directory) {
  if (!mcpAvailable || !storageClient) return null;
  try {
    const result = await storageClient.callTool({
      name: "save_file",
      arguments: {
        content: buffer.toString("base64"),
        filename,
        directory,
      },
    });
    return JSON.parse(result.content[0].text).path;
  } catch (err) {
    console.error("MCP file storage failed:", err.message);
    return null;
  }
}
