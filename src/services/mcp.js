let gmailClient = null;
let storageClient = null;
let mcpAvailable = false;

export async function initMCPClients() {
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

    gmailClient = new Client({ name: "interview-gmail-client", version: "1.0.0" });
    storageClient = new Client({ name: "interview-storage-client", version: "1.0.0" });

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

export async function saveFile(buffer, filename, directory) {
  if (!mcpAvailable || !storageClient) return null;
  try {
    const result = await storageClient.callTool({
      name: "save_file",
      arguments: { content: buffer.toString("base64"), filename, directory },
    });
    return JSON.parse(result.content[0].text).path;
  } catch (err) {
    console.error("MCP file storage failed:", err.message);
    return null;
  }
}
