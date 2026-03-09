import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateEnv, PORT } from "./config/env.js";
import { initDB } from "./config/db.js";
import { initMCPClients } from "./services/mcp.js";
import { createGraph } from "./graph/index.js";
import { createApp } from "./app.js";
import { startCVWatcher } from "./services/watcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CVS_DIR = path.join(__dirname, "..", "cvs");
const CVS_PROCESSED_DIR = path.join(CVS_DIR, "processed");

async function main() {
  validateEnv();
  await initDB();
  await initMCPClients();
  const compiledGraph = await createGraph();

  const app = createApp();
  app.locals.compiledGraph = compiledGraph;

  startCVWatcher(CVS_DIR, CVS_PROCESSED_DIR, compiledGraph);

  app.listen(PORT, () => {
    console.log(`Interview Assistant running → http://localhost:${PORT}/admin`);
  });
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
