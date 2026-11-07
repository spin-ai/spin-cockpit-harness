#!/usr/bin/env node
/**
 * Cockpit Mission MCP bridge.
 *
 * dsh's ACP server mounts this file as a stdio MCP server for supervisor runs.
 * The bridge speaks the small part of MCP that dsh needs (initialize,
 * tools/list, tools/call) and forwards tool calls to the Electron main process
 * over a loopback HTTP endpoint guarded by a per-mission token.
 */
import process from "node:process";

const endpoint = process.env.COCKPIT_MCP_URL || "";
const token = process.env.COCKPIT_MCP_TOKEN || "";
const missionId = process.env.COCKPIT_MISSION_ID || "";

const tools = [
  {
    name: "mission_plan",
    description: "提交或更新 Mission 计划。只在计划阶段调用；用户批准后系统才会创建子任务。",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "object", description: "计划对象：{ summary, steps:[{key,title,brief,agent,acceptance,dependsOn}], risks, budget }" },
      },
      required: ["plan"],
      additionalProperties: false,
    },
  },
  {
    name: "task_delegate",
    description: "把一个新的子任务派给 worker Agent。只能用于批准后的 Mission；已存在的计划步骤会由系统自动创建。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        brief: { type: "string" },
        agent: { type: "string", description: "worker Agent 的 id 或 @alias" },
        acceptance: { type: "array", items: { type: "string" } },
        depends_on: { type: "array", items: { type: "string" }, description: "依赖的 plan step key（仅新任务使用）" },
      },
      required: ["title", "agent"],
      additionalProperties: false,
    },
  },
  {
    name: "task_list",
    description: "列出当前 Mission 的子任务及状态。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "task_get",
    description: "查看一个子任务的详细状态和结果。",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "task_review",
    description: "接受、要求返工或取消一个子任务。accept 只表示接受该子任务，不等于确认整个 Mission。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        decision: { type: "string", enum: ["accept", "rework", "cancel"] },
        feedback: { type: "string" },
      },
      required: ["id", "decision"],
      additionalProperties: false,
    },
  },
  {
    name: "task_steer",
    description: "给正在运行的子任务发纠偏消息。",
    inputSchema: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: false },
  },
  {
    name: "task_retry",
    description: "重试一个失败/已取消的子任务。",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "mission_finish",
    description: "提交 Mission 总结。总结会进入待人工确认状态，不能直接确认完成。",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        artifacts: { type: "array", items: { type: "string" } },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
];

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const at = buffer.indexOf("\n");
    if (at < 0) break;
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (line) void handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function callMain(name, args) {
  if (!endpoint) throw new Error("COCKPIT_MCP_URL 未配置");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ missionId, name, arguments: args || {} }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.result;
}

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    write({
      jsonrpc: "2.0", id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "cockpit-mission", version: "1.0.0" },
      },
    });
    return;
  }
  if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") return;
  if (msg.method === "ping") { write({ jsonrpc: "2.0", id: msg.id, result: {} }); return; }
  if (msg.method === "tools/list") {
    write({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name || "";
    const args = msg.params?.arguments || {};
    try {
      const result = await callMain(name, args);
      write({
        jsonrpc: "2.0", id: msg.id,
        result: { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      write({
        jsonrpc: "2.0", id: msg.id,
        result: { content: [{ type: "text", text: `工具调用失败：${String(err?.message || err)}` }], isError: true },
      });
    }
    return;
  }
  if (msg.id !== undefined) {
    write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `unsupported method: ${msg.method}` } });
  }
}
