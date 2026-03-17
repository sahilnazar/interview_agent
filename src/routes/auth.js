import { Router } from "express";
import bcrypt from "bcrypt";
import { query } from "../config/db.js";

const router = Router();

// ─── Admin Login ─────────────────────────────────────────────────────────
router.get("/admin", (req, res) => {
  if (req.session && req.session.admin) return res.redirect("/admin");
  res.render("login-admin", { error: null });
});

router.post("/admin", async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.render("login-admin", { error: "All fields are required" });

    const result = await query("SELECT * FROM admins WHERE username = $1", [username]);
    if (!result.rows.length) return res.render("login-admin", { error: "Invalid credentials" });

    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.render("login-admin", { error: "Invalid credentials" });

    req.session.admin = { id: admin.id, username: admin.username };
    res.redirect("/admin");
  } catch (err) {
    next(err);
  }
});

// ─── Candidate Login ─────────────────────────────────────────────────────
router.get("/candidate", (req, res) => {
  if (req.session && req.session.candidate) return res.redirect("/candidate/dashboard");
  res.render("login-candidate", { error: null });
});

router.post("/candidate", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.render("login-candidate", { error: "All fields are required" });

    const result = await query("SELECT * FROM candidates WHERE email = $1", [email]);
    if (!result.rows.length) return res.render("login-candidate", { error: "Invalid credentials" });

    const candidate = result.rows[0];
    if (!candidate.password_hash) return res.render("login-candidate", { error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, candidate.password_hash);
    if (!valid) return res.render("login-candidate", { error: "Invalid credentials" });

    req.session.candidate = {
      threadId: candidate.thread_id,
      email: candidate.email,
      interviewId: candidate.interview_id,
      mustChangePassword: !!candidate.must_change_password,
    };
    if (candidate.must_change_password) {
      return res.redirect("/candidate/change-password");
    }
    res.redirect("/candidate/dashboard");
  } catch (err) {
    next(err);
  }
});

// ─── Logout ──────────────────────────────────────────────────────────────
router.post("/logout", (req, res) => {
  const isCandidate = req.session && req.session.candidate;
  const isInterviewer = req.session && req.session.interviewer;
  req.session.destroy(() => {
    if (isInterviewer) return res.redirect("/interviewer/login");
    res.redirect(isCandidate ? "/login/candidate" : "/login/admin");
  });
});

export default router;
