/**
 * Prompt-driven MCP tool dispatcher.
 *
 * Instead of callers hardcoding which MCP tool to invoke, they describe
 * what they need in plain English. This module sends that prompt to Groq
 * with the available tool definitions and executes whatever the LLM selects.
 *
 * Usage:
 *   const { toolName, result } = await dispatchWithPrompt(
 *     "Score the resume for candidate X against interview Y",
 *     { threadId, interviewId, resumeBase64 },
 *     { allowTools: ["analyze_resume_only"] }
 *   );
 *   if (result) { ... use result ... }
 *   else        { ... run local fallback ... }
 */

import OpenAI from "openai";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";
import { callMCPTool, isMCPToolAvailable } from "./mcp-client-manager.js";
import { callWithRetry } from "../graph/helpers.js";

const groq = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return only the tool definitions whose MCP server is currently online,
 * optionally filtered to an explicit allowList of tool names.
 */
function getAvailableTools(allowList = null) {
  return TOOL_DEFINITIONS.filter((def) => {
    const name = def.function.name;
    if (allowList && !allowList.includes(name)) return false;
    return isMCPToolAvailable(name);
  });
}

/**
 * Merge LLM-chosen args with caller-supplied context.
 * Context values override LLM-supplied values so sensitive fields
 * (threadId, interviewId) are always correct even if the LLM hallucinates.
 */
function mergeArgs(llmArgs, context) {
  return { ...llmArgs, ...context };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Send a natural-language prompt to Groq with available tool definitions.
 * Groq returns tool_call(s) → we execute each via callMCPTool().
 *
 * @param {string}   prompt               What needs to be done (plain English)
 * @param {object}   context              Data the chosen tool will need.
 *                                        These values are merged into the LLM's
 *                                        chosen arguments and take priority.
 * @param {object}   [options]
 * @param {string[]} [options.allowTools] Whitelist of tool names to offer the LLM.
 *                                        Omit to offer all available tools.
 * @param {string}   [options.toolChoice] "auto" | "required"  (default: "auto")
 *
 * @returns {Promise<DispatchResult>}
 *   Single tool: { toolName: string, result: object }
 *   Multi-tool:  { toolName: "multi", results: Array<{ toolName, result }> }
 *   No tool:     { toolName: null, result: null, reason: string }
 *
 * @typedef {{ toolName: string|null, result: object|null, reason?: string }} DispatchResult
 */
export async function dispatchWithPrompt(prompt, context = {}, options = {}) {
  const { allowTools = null, toolChoice = "auto" } = options;

  // 1. Build the filtered tool list — only tools whose server is online
  const tools = getAvailableTools(allowTools);

  if (!tools.length) {
    console.warn("[AgentDispatcher] No MCP tools available — caller should use local fallback");
    return { toolName: null, result: null, reason: "no_tools_available" };
  }

  // 2. Build messages
  const messages = [
    {
      role: "system",
      content:
        "You are an intelligent hiring automation assistant. " +
        "Based on the task description, call the single most appropriate tool. " +
        "Do not explain your reasoning — just call the tool with the correct arguments. " +
        "Never invent values for required fields; use only what is provided in the task.",
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  // 3. Call Groq with tool definitions
  let response;
  try {
    response = await callWithRetry(() =>
      groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages,
        tools,
        tool_choice: toolChoice,
        temperature: 0,
      })
    );
  } catch (err) {
    console.error("[AgentDispatcher] Groq tool-selection call failed:", err.message);
    return { toolName: null, result: null, reason: `groq_error: ${err.message}` };
  }

  const message = response.choices[0]?.message;

  // 4. LLM decided no tool was needed
  if (!message?.tool_calls?.length) {
    console.warn("[AgentDispatcher] LLM returned no tool_call for prompt:", prompt.slice(0, 100));
    return { toolName: null, result: null, reason: "no_tool_selected" };
  }

  // 5. Execute each chosen tool
  const results = [];

  for (const toolCall of message.tool_calls) {
    const name = toolCall.function.name;

    let llmArgs;
    try {
      llmArgs = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      llmArgs = {};
    }

    // Merge: caller-supplied context takes priority over LLM-supplied args
    const args = mergeArgs(llmArgs, context);

    console.log(
      `[AgentDispatcher] LLM selected tool: "${name}" | args: ${JSON.stringify(
        { ...args, resumeBase64: args.resumeBase64 ? "<base64>" : undefined },
      )}`
    );

    try {
      const result = await callMCPTool(name, args);
      results.push({ toolName: name, result });
    } catch (err) {
      console.error(`[AgentDispatcher] Tool execution failed for "${name}":`, err.message);
      // Propagate so caller can run local fallback
      throw err;
    }
  }

  // 6. Return single or multi result
  if (results.length === 1) return results[0];
  return { toolName: "multi", results };
}
