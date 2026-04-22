import "dotenv/config";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateEnv, HOST, PORT } from "./config/env.js";
import { initDB } from "./config/db.js";
import { initMCPClients } from "./services/mcp.js";
import { createGraph } from "./graph/index.js";
import { createApp } from "./app.js";
import { startCVWatcher } from "./services/watcher.js";
import { startEmailIngest } from "./services/email-ingest.js";
import { startAutoSchedulePassedCandidates, startBulkOutcomeEmailWorker } from "./services/scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CVS_DIR = path.join(__dirname, "..", "cvs");
const CVS_PROCESSED_DIR = path.join(CVS_DIR, "processed");

function getLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) continue;
      if (entry.family !== "IPv4") continue;
      urls.push(`http://${entry.address}:${port}/admin`);
    }
  }

  return [...new Set(urls)];
}

async function main() {
  validateEnv();
  await initDB();
  await initMCPClients();
  const compiledGraph = await createGraph();

  const app = createApp();
  app.locals.compiledGraph = compiledGraph;

  startCVWatcher(CVS_DIR, CVS_PROCESSED_DIR, compiledGraph);
  startEmailIngest(path.join(CVS_DIR, "auto"));
  startAutoSchedulePassedCandidates();
  startBulkOutcomeEmailWorker();

  app.listen(PORT, HOST, () => {
    console.log(`Interview Assistant running → http://localhost:${PORT}/admin`);
    console.log(`Interview Assistant host binding → ${HOST}:${PORT}`);

    if (HOST === "0.0.0.0") {
      const lanUrls = getLanUrls(PORT);
      for (const url of lanUrls) {
        console.log(`Interview Assistant LAN URL → ${url}`);
      }
    }
  });
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
