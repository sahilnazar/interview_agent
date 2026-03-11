import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import pool from "./config/db.js";
import adminRouter from "./routes/admin.js";
import uploadRouter from "./routes/upload.js";
import apiRouter from "./routes/api.js";
import authRouter from "./routes/auth.js";
import candidateRouter from "./routes/candidate.js";
import { requireAdmin } from "./middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PgSession = connectPgSimple(session);

export function createApp() {
  const app = express();

  app.set("view engine", "pug");
  app.set("views", path.join(__dirname, "..", "views"));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // Session middleware
  app.use(session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "interview-assistant-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
  }));

  // Routes
  app.get("/", (_req, res) => res.redirect("/login/admin"));
  app.use("/login", authRouter);
  app.use("/admin", requireAdmin, adminRouter);
  app.use("/candidate", candidateRouter);
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
