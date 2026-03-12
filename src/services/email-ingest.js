import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import fs from "node:fs";
import path from "node:path";
import { query } from "../config/db.js";

const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx"];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB

let pollingTimer = null;
let isRunning = false;

/** Read IMAP settings from the settings table */
async function getImapSettings() {
  const result = await query("SELECT key, value FROM settings WHERE key LIKE 'imap_%'");
  const settings = {};
  for (const r of result.rows) settings[r.key] = r.value;
  return {
    enabled: settings.imap_enabled === "true",
    host: settings.imap_host || "",
    port: parseInt(settings.imap_port || "993", 10),
    user: settings.imap_user || "",
    password: settings.imap_password || "",
    pollInterval: parseInt(settings.imap_poll_interval || "60", 10), // seconds
    folder: settings.imap_folder || "INBOX",
  };
}

/** Fetch unread emails with resume attachments and save to cvs/auto/ */
async function pollInbox(cvsAutoDir) {
  if (isRunning) return;
  isRunning = true;

  let client;
  try {
    const cfg = await getImapSettings();
    if (!cfg.enabled || !cfg.host || !cfg.user || !cfg.password) return;

    client = new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 993,
      auth: { user: cfg.user, pass: cfg.password },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock(cfg.folder);

    try {
      // Search for unseen messages
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids.length) return;

      console.log(`Email ingest: Found ${uids.length} unread email(s)`);
      let saved = 0;

      for (const uid of uids) {
        try {
          const raw = await client.download(uid.toString(), undefined, { uid: true });
          const chunks = [];
          for await (const chunk of raw.content) chunks.push(chunk);
          const rawBuffer = Buffer.concat(chunks);
          const parsed = await simpleParser(rawBuffer);

          const senderEmail = parsed.from?.value?.[0]?.address || "";
          if (!senderEmail) {
            console.warn(`Email ingest: UID ${uid} — no sender address, skipping`);
            await client.messageFlagsAdd(uid.toString(), ["\\Seen"], { uid: true });
            continue;
          }

          const attachments = (parsed.attachments || []).filter((att) => {
            const ext = path.extname(att.filename || "").toLowerCase();
            return ALLOWED_EXTENSIONS.includes(ext) && att.size <= MAX_ATTACHMENT_SIZE;
          });

          if (!attachments.length) {
            console.log(`Email ingest: UID ${uid} from ${senderEmail} — no resume attachments, marking read`);
            await client.messageFlagsAdd(uid.toString(), ["\\Seen"], { uid: true });
            continue;
          }

          for (const att of attachments) {
            // Use sender email as filename prefix for the watcher to pick up
            const ext = path.extname(att.filename).toLowerCase();
            const safeEmail = senderEmail.replace(/[^a-zA-Z0-9.@_-]/g, "_");
            const filename = `${safeEmail}${ext}`;
            const destPath = path.join(cvsAutoDir, filename);

            // Avoid overwriting if same file already there (append timestamp)
            const finalPath = fs.existsSync(destPath)
              ? path.join(cvsAutoDir, `${safeEmail}-${Date.now()}${ext}`)
              : destPath;

            fs.writeFileSync(finalPath, att.content);
            saved++;
            console.log(`Email ingest: Saved ${att.filename} from ${senderEmail} → ${path.basename(finalPath)}`);
          }

          // Mark email as read
          await client.messageFlagsAdd(uid.toString(), ["\\Seen"], { uid: true });
        } catch (err) {
          console.error(`Email ingest: Error processing UID ${uid}:`, err.message);
        }
      }

      if (saved > 0) {
        console.log(`Email ingest: Saved ${saved} resume(s) to cvs/auto/`);
      }

      // Update last poll timestamp
      await query(
        "INSERT INTO settings (key, value) VALUES ('imap_last_poll', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [new Date().toISOString()]
      );
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    console.error("Email ingest: Poll error:", err.message);
  } finally {
    isRunning = false;
    if (client) {
      try { await client.logout(); } catch { /* already closed */ }
    }
  }
}

/** Start the email ingestion polling loop */
export async function startEmailIngest(cvsAutoDir) {
  stopEmailIngest();

  const cfg = await getImapSettings();
  if (!cfg.enabled) {
    console.log("Email ingest: Disabled (enable in admin settings)");
    return;
  }

  if (!cfg.host || !cfg.user || !cfg.password) {
    console.warn("Email ingest: Enabled but IMAP credentials not configured — skipping");
    return;
  }

  console.log(`Email ingest: Polling ${cfg.user}@${cfg.host} every ${cfg.pollInterval}s`);

  // Run once immediately, then on interval
  pollInbox(cvsAutoDir);
  pollingTimer = setInterval(() => pollInbox(cvsAutoDir), cfg.pollInterval * 1000);
}

/** Stop the polling loop */
export function stopEmailIngest() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

/** Restart with fresh settings (called after admin saves IMAP config) */
export async function restartEmailIngest(cvsAutoDir) {
  stopEmailIngest();
  await startEmailIngest(cvsAutoDir);
}
