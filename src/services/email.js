import nodemailer from "nodemailer";
import { PORT } from "../config/env.js";

let _transporter;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return _transporter;
}

export async function sendEmail(to, subject, html) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn("Email credentials not configured — skipping send to", to);
    return;
  }
  await getTransporter().sendMail({ from: process.env.GMAIL_USER, to, subject, html });
}

export async function sendInvitationEmail(email, threadId, loginToken, password) {
  const loginUrl = `http://localhost:${PORT}/login/candidate`;
  const uploadUrl = `http://localhost:${PORT}/upload/${encodeURIComponent(threadId)}`;
  await sendEmail(
    email,
    "Interview Invitation — Next Steps",
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Congratulations!</h2>
      <p>Your resume has been shortlisted. Please complete the next step of our process.</p>
      <h3>Your Login Credentials</h3>
      <table style="border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:6px 16px 6px 0;color:#888">Email:</td><td style="padding:6px 0"><strong>${email}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#888">Token:</td><td style="padding:6px 0"><strong>${loginToken}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#888">Password:</td><td style="padding:6px 0"><strong>${password}</strong></td></tr>
      </table>
      <p><a href="${loginUrl}" style="display:inline-block;padding:12px 24px;background:#4f6ef7;color:#fff;border-radius:6px;text-decoration:none">
        Login to Your Dashboard
      </a></p>
      <h3 style="margin-top:24px">Interview Question</h3>
      <p>Record a <strong>2–3 minute video</strong> introducing yourself, discussing your
      relevant experience, and explaining why you're interested in this position.
      Focus on demonstrating your technical knowledge and communication skills.</p>
      <p style="margin-top:16px"><a href="${uploadUrl}" style="color:#4f6ef7">Or upload directly here</a></p>
      <p style="color:#888;font-size:12px;margin-top:24px">Reference: ${threadId}</p>
    </div>`
  );
}

export async function sendRejectionEmail(email) {
  await sendEmail(
    email,
    "Application Update",
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Thank you for your interest</h2>
      <p>After careful review we have decided not to move forward with your application
      at this time.</p>
      <p>We appreciate your time and wish you the best in your job search.</p>
    </div>`
  );
}
