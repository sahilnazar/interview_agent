/**
 * Prompt-driven MCP tool dispatcher — LangGraph ToolNode edition.
 *
 * Callers describe what they need in plain English. This module:
 *   1. Filters to only the MCP tools that are currently online.
 *   2. Binds those tools to a ChatGroq model.
 *   3. Runs a minimal LangGraph agent: llm → ToolNode → END.
 *   4. Returns the tool result in the same shape as before.
 *
 * Usage (unchanged from previous version):
 *   const { toolName, result } = await dispatchWithPrompt(
 *     "Score the resume for candidate X against interview Y",
 *     { threadId, interviewId, resumeBase64 },
 *     { allowTools: ["analyze_resume_only"] }
 *   );
 *   if (result) { ... use result ... }
 *   else        { ... run local fallback ... }
 */

import { ChatGroq } from "@langchain/groq";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createTools } from "./lc-tools.js";
import { callWithRetry } from "../graph/helpers.js";

const SYSTEM_PROMPT =
  "You are an intelligent hiring automation assistant. " +
  "Based on the task description, call the single most appropriate tool. " +
  "Do not explain your reasoning — just call the tool with the correct arguments. " +
  "Never invent values for required fields; use only what is provided in the task.";

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Send a natural-language prompt through a LangGraph ToolNode agent.
 * The LLM selects and executes the appropriate MCP tool automatically.
 *
 * @param {string}   prompt               What needs to be done (plain English)
 * @param {object}   context              Data the chosen tool will need.
 *                                        These values are merged into the LLM's
 *                                        chosen arguments and take priority.
 * @param {object}   [options]
 * @param {string[]} [options.allowTools] Whitelist of tool names to offer the LLM.
 *
 * @returns {Promise<{ toolName: string|null, result: object|null, reason?: string }>}
 *
 * @throws  When the selected tool throws (e.g. MCP server error) — caller should
 *          catch and run a local fallback.
 */
export async function dispatchWithPrompt(prompt, context = {}, options = {}) {
  const { allowTools = null } = options;

  // 1. Build the filtered tool list — only tools whose server is currently online
  const tools = createTools(context, allowTools);

  if (!tools.length) {
    console.warn("[AgentDispatcher] No MCP tools available — caller should use local fallback");
    return { toolName: null, result: null, reason: "no_tools_available" };
  }

  // 2. Bind tools to ChatGroq
  const model = new ChatGroq({ model: "llama-3.3-70b-versatile", temperature: 0 }).bindTools(tools);

  // 3. Build a minimal single-turn dispatch graph:
  //    agent node → has tool_calls? → tools node → END
  //                                ↘ no tool_calls → END
  const toolNode = new ToolNode(tools);

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state) => ({
      messages: [await callWithRetry(() => model.invoke(state.messages))],
    }))
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (state) => {
      const last = state.messages.at(-1);
      return last?.tool_calls?.length ? "tools" : END;
    })
    .addEdge("tools", END)
    .compile();

  // 4. Invoke the graph
  let finalMessages;
  try {
    const result = await graph.invoke({
      messages: [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(prompt)],
    });
    finalMessages = result.messages;
  } catch (err) {
    console.error("[AgentDispatcher] Graph execution failed:", err.message);
    return { toolName: null, result: null, reason: `graph_error: ${err.message}` };
  }

  // 5. Extract tool name from the AIMessage and result from the ToolMessage
  const aiMsg = finalMessages.findLast((m) => m?.tool_calls?.length > 0);
  const toolMsg = finalMessages.findLast((m) => m._getType?.() === "tool");

  if (!aiMsg || !toolMsg) {
    console.warn("[AgentDispatcher] LLM returned no tool call for prompt:", prompt.slice(0, 100));
    return { toolName: null, result: null, reason: "no_tool_selected" };
  }

  const toolName = aiMsg.tool_calls[0].name;

  // Re-throw tool errors so callers can run their local fallback
  if (toolMsg.status === "error") {
    throw new Error(`MCP tool "${toolName}" failed: ${toolMsg.content}`);
  }

  // 6. Parse the JSON string the tool returned
  const rawContent =
    typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content);

  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    parsed = { ok: true, raw: rawContent };
  }

  console.log(`[AgentDispatcher] "${toolName}" executed via LangGraph ToolNode`);
  return { toolName, result: parsed };
}
