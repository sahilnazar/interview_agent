/**
 * MCP facade — delegates everything to MCPClientManager.
 * All public exports are backward-compatible; no callers need to change.
 */
import {
  initMCPClients as _init,
  isMCPAvailable as _isAvailable,
  isMCPToolAvailable,
  getMCPDebugStatus,
  callMCPTool,
} from "./mcp-client-manager.js";

export { callMCPTool, getMCPDebugStatus, isMCPToolAvailable };

export async function initMCPClients() {
  return _init();
}

// isMCPAvailable() — no arg = "is any server up?", mirrors old boolean behaviour
export function isMCPAvailable() {
  return _isAvailable();
}

// ─── Named tool wrappers (unchanged API) ─────────────────────────────────────

export async function analyzeResumeViaMCP(payload) {
  return callMCPTool("analyze_resume", payload);
}

export async function analyzeResumeOnlyViaMCP(payload) {
  return callMCPTool("analyze_resume_only", payload);
}

export async function sendInviteViaMCP(payload) {
  return callMCPTool("send_invite", payload);
}

export async function candidateLookupViaMCP(payload) {
  return callMCPTool("candidate_lookup", payload);
}

export async function candidateBenchmarksViaMCP(payload) {
  return callMCPTool("candidate_benchmarks", payload);
}

export async function scheduleCandidateViaMCP(payload) {
  return callMCPTool("schedule_candidate", payload);
}

export async function autoAssignAndConfirmViaMCP(payload) {
  return callMCPTool("auto_assign_and_confirm_candidate", payload);
}

export async function listHrAssignmentRequestsViaMCP(payload = {}) {
  return callMCPTool("list_hr_assignment_requests", payload);
}

export async function approveHrAssignmentViaMCP(payload) {
  return callMCPTool("approve_hr_assignment_request", payload);
}

export async function rejectHrAssignmentViaMCP(payload) {
  return callMCPTool("reject_hr_assignment_request", payload);
}

// Backward-compatible stubs (never implemented in the old server either)
export async function pollInbox(_domainRegex) {
  if (!_isAvailable()) return [];
  console.warn("pollInbox via MCP is not configured");
  return [];
}

export async function saveFile(_buffer, _filename, _directory) {
  if (!_isAvailable()) return null;
  console.warn("saveFile via MCP is not configured");
  return null;
}
