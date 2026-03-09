import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import adminRouter from "./routes/admin.js";
import uploadRouter from "./routes/upload.js";
import apiRouter from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.set("view engine", "pug");
  app.set("views", path.join(__dirname, "..", "views"));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Routes
  app.get("/", (_req, res) => res.redirect("/admin"));
  app.use("/admin", adminRouter);
  app.use("/upload", uploadRouter);
  app.use("/api", apiRouter);

  // Error handler
  app.use((err, _req, res, _next) => {
    console.error(err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || "Internal server error" });
  });

  return app;
}
