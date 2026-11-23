#!/usr/bin/env node
/**
 * Cockpit Harness MCP bridge（给 ACP agent 用）：把 whoami / note / report 暴露成 MCP tools。
 * 真正的权限与归属在主进程；这里只转发 HTTP，token 由主进程按 run 下发。
 */
import process from "node:process";

const endpoint = process.env.COCKPIT_AGENT_URL || "";
const token = process.env.COCKPIT_AGENT_TOKEN || "";
const tools = [
  {
    name: "harness_whoami",
    description: "当前这次运行：run / 任务 / agent / cwd。用来确认你在替谁干活。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_note",
    description: "中途进度 / 疑问写进当前任务会话（不会改任务状态，也不会通知所有人）。",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "harness_report",
    description: "把这次运行的结论写进 run.result（不会把 run 标完成 / 失败）。",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
];

async function call(name, args = {}) {
  const command = name === "harness_whoami" ? "whoami" : name === "harness_note" ? "note" : name === "harness_report" ? "report" : "";
  if (!command) throw new Error(`不认识工具：${name}`);
  const res = await fetch(`${endpoint}/call`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ command, text: String(args.text || "") }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

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

function write(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "cockpit-harness", version: "1.0.0" } } });
    return;
  }
  if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") return;
  if (msg.method === "ping") { write({ jsonrpc: "2.0", id: msg.id, result: {} }); return; }
  if (msg.method === "tools/list") { write({ jsonrpc: "2.0", id: msg.id, result: { tools } }); return; }
  if (msg.method === "tools/call") {
    try {
      const result = await call(msg.params?.name, msg.params?.arguments || {});
      write({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
    } catch (err) {
      write({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `harness 工具失败：${String(err?.message || err)}` }], isError: true } });
    }
    return;
  }
  if (msg.id !== undefined) write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `unsupported method: ${msg.method}` } });
}
