import crypto from "node:crypto";
import { query } from "../config/db.js";
import { sendEmail } from "./email.js";

/** Generate and persist a 6-digit OTP, then email it to the interviewer. */
export async function sendInterviewerOTP(interviewer) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Invalidate any previous unused OTPs for this interviewer
  await query(
    "UPDATE interviewer_otps SET used = TRUE WHERE interviewer_id = $1 AND used = FALSE",
    [interviewer.id],
  );

  await query(
    "INSERT INTO interviewer_otps (interviewer_id, otp_code, expires_at) VALUES ($1, $2, $3)",
    [interviewer.id, code, expiresAt],
  );

  await sendEmail(
    interviewer.email,
    "Your Interview Assistant Login Code",
    `<div style="font-family:sans-serif;max-width:480px">
      <h2>Login OTP</h2>
      <p>Hi ${interviewer.name},</p>
      <p>Your one-time login code for Interview Assistant is:</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:10px;background:#0f0f1a;color:#4f6ef7;padding:24px;border-radius:8px;text-align:center;margin:20px 0">
        ${code}
      </div>
      <p style="color:#94a3b8;font-size:12px">This code expires in 10 minutes. Do not share it with anyone.</p>
    </div>`,
  );

  return code; // returned only for testing; not exposed in routes
}

/** Validate an OTP. Returns the interviewer row on success, null on failure. */
export async function verifyInterviewerOTP(email, code) {
  const result = await query(
    `SELECT o.*, i.id AS interviewer_id, i.name, i.email
     FROM interviewer_otps o
     JOIN interviewers i ON i.id = o.interviewer_id
     WHERE i.email = $1
       AND o.otp_code = $2
       AND o.used = FALSE
       AND o.expires_at > NOW()
     ORDER BY o.expires_at DESC
     LIMIT 1`,
    [email, code],
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];
  await query("UPDATE interviewer_otps SET used = TRUE WHERE id = $1", [
    row.id,
  ]);

  return { id: row.interviewer_id, name: row.name, email: row.email };
}
