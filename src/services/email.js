import nodemailer from "nodemailer";
import { PORT } from "../config/env.js";
import { query } from "../config/db.js";

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

export async function sendHrApprovalRequestNotification(interviewId, candidateEmail, requestId, suggestions, reason) {
  const settingRow = await query(
    "SELECT value FROM settings WHERE key = 'hr_notification_emails' LIMIT 1"
  );
  const emailsSetting = settingRow.rows[0]?.value || process.env.HR_NOTIFICATION_EMAILS || "";
  const recipients = emailsSetting
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (!recipients.length) {
    console.warn("hr_notification_emails not configured in Settings — skipping HR approval notification");
    return;
  }

  const requestUrl = `${process.env.APP_URL || `http://localhost:${PORT}`}/admin/hr-requests/${requestId}`;
  const suggestionRows = suggestions
    .map((suggestion, index) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b">${index + 1}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b">${suggestion.interviewer_name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b">${suggestion.interviewer_email}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b">${suggestion.department || 'N/A'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b">${suggestion.interviewer_match_percent != null ? suggestion.interviewer_match_percent.toFixed(0) + '%' : 'n/a'}</td>
      </tr>`)
    .join("");

  await sendEmail(
    recipients.join(", "),
    "HR Review Required — Interviewer Assignment Suggestion",
    `<div style="font-family:sans-serif;max-width:640px">
      <h2>HR Review Required</h2>
      <p>A candidate has a low-match interviewer suggestion request and requires HR approval.</p>
      <p><strong>Candidate:</strong> ${candidateEmail}</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#0f172a;border-radius:8px;overflow:hidden">
        <thead>
          <tr>
            <th style="padding:12px 16px;text-align:left;color:#94a3b8">#</th>
            <th style="padding:12px 16px;text-align:left;color:#94a3b8">Name</th>
            <th style="padding:12px 16px;text-align:left;color:#94a3b8">Email</th>
            <th style="padding:12px 16px;text-align:left;color:#94a3b8">Department</th>
            <th style="padding:12px 16px;text-align:left;color:#94a3b8">Match</th>
          </tr>
        </thead>
        <tbody>${suggestionRows}</tbody>
      </table>
      <p>
        <a href="${requestUrl}" style="display:inline-block;padding:12px 18px;background:#4f6ef7;color:#fff;border-radius:8px;text-decoration:none">
          Review in Admin Panel
        </a>
      </p>
    </div>`,
  );
}

export async function sendInvitationEmail(email, threadId, password) {
  const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const loginUrl = `${baseUrl}/login/candidate?next=${encodeURIComponent("/candidate/interview")}`;
  await sendEmail(
    email,
    "Interview Invitation — Next Steps",
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Congratulations!</h2>
      <p>Your resume has been shortlisted. Please complete the next step of our process.</p>
      <h3>Your Login Credentials</h3>
      <table style="border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:6px 16px 6px 0;color:#888">Email:</td><td style="padding:6px 0"><strong>${email}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#888">Password:</td><td style="padding:6px 0"><strong>${password}</strong></td></tr>
      </table>
      <p><a href="${loginUrl}" style="display:inline-block;padding:12px 24px;background:#4f6ef7;color:#fff;border-radius:6px;text-decoration:none">
        Login and Record Interview
      </a></p>
      <h3 style="margin-top:24px">Interview Question</h3>
      <p>Record a <strong>2–3 minute video</strong> introducing yourself, discussing your
      relevant experience, and explaining why you're interested in this position.
      Focus on demonstrating your technical knowledge and communication skills.</p>
      <p style="color:#888;font-size:12px;margin-top:24px">Reference: ${threadId}</p>
    </div>`
  );
}

export async function sendSelectionEmail(email) {
  await sendEmail(
    email,
    "Interview Outcome — Selected",
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Congratulations!</h2>
      <p>We are excited to let you know that you have been selected to move forward in the process.</p>
      <p>Our team will contact you with the next steps shortly.</p>
      <p style="color:#888;font-size:12px">Thank you for interviewing with us.</p>
    </div>`
  );
}

export async function sendNotSelectedEmail(email) {
  await sendEmail(
    email,
    "Interview Outcome — Not Selected",
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Thank you for interviewing</h2>
      <p>We appreciate the time you invested in our interview process.</p>
      <p>After a careful review, we have decided not to move forward with your application.</p>
      <p>We wish you the best in your career search.</p>
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

async function getHrRecipients() {
  const settingRow = await query("SELECT value FROM settings WHERE key = 'hr_notification_emails' LIMIT 1");
  const emailsSetting = settingRow.rows[0]?.value || process.env.HR_NOTIFICATION_EMAILS || "";
  return emailsSetting.split(",").map((e) => e.trim()).filter(Boolean);
}

const BASE_URL = () => process.env.APP_URL || `http://localhost:${PORT}`;

export async function sendAdminNoSlotsAlert(candidateEmail, interviewTitle) {
  const recipients = await getHrRecipients();
  if (!recipients.length) {
    console.warn("[NoSlotsAlert] hr_notification_emails not configured — skipping");
    return;
  }
  await sendEmail(
    recipients.join(", "),
    "⚠️ Action Required — No Interviewer Slots Available",
    `<div style="font-family:sans-serif;max-width:600px;padding:24px">
      <h2 style="color:#dc2626">No Interviewers Available</h2>
      <p>The system attempted to schedule a live interview but could not find any available slot.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:6px 12px;font-weight:600;width:140px">Candidate</td><td style="padding:6px 12px">${candidateEmail}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:600">Position</td><td style="padding:6px 12px">${interviewTitle || "Unknown"}</td></tr>
      </table>
      <p><strong>Action required:</strong> Please add interviewer availability or assign an interviewer manually.</p>
      <p><a href="${BASE_URL()}/admin" style="display:inline-block;padding:10px 20px;background:#4f6ef7;color:#fff;border-radius:6px;text-decoration:none">Open Admin Panel</a></p>
    </div>`
  );
}

export async function sendAdminNoShowAlert({ candidateEmail, interviewerName, slotStart }) {
  const recipients = await getHrRecipients();
  if (!recipients.length) {
    console.warn("[NoShowAlert] hr_notification_emails not configured — skipping");
    return;
  }
  const slotStr = new Date(slotStart).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  await sendEmail(
    recipients.join(", "),
    "⚠️ Possible No-Show — Interview Not Marked Complete",
    `<div style="font-family:sans-serif;max-width:600px;padding:24px">
      <h2 style="color:#dc2626">Possible No-Show Detected</h2>
      <p>An interview session has passed its scheduled end time without being marked complete.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:6px 12px;font-weight:600;width:140px">Candidate</td><td style="padding:6px 12px">${candidateEmail}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:600">Interviewer</td><td style="padding:6px 12px">${interviewerName}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:600">Scheduled At</td><td style="padding:6px 12px">${slotStr}</td></tr>
      </table>
      <p>Please check with the interviewer and update the outcome in the admin panel.</p>
      <p><a href="${BASE_URL()}/admin" style="display:inline-block;padding:10px 20px;background:#4f6ef7;color:#fff;border-radius:6px;text-decoration:none">Open Admin Panel</a></p>
    </div>`
  );
}

export async function sendCandidateVideoReminder(candidateEmail) {
  const loginUrl = `${BASE_URL()}/login/candidate`;
  await sendEmail(
    candidateEmail,
    "⏰ Reminder — Please Submit Your Video Interview",
    `<div style="font-family:sans-serif;max-width:600px;padding:24px">
      <h2>Don't forget your video interview!</h2>
      <p>Hi there,</p>
      <p>We noticed you haven't submitted your video interview yet. When you're ready, please log in and record your response.</p>
      <p>
        <a href="${loginUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
          Submit Your Video →
        </a>
      </p>
      <p style="color:#888;font-size:12px;margin-top:20px">If you have any questions, reply to this email and we'll be happy to help.</p>
    </div>`
  );
}
