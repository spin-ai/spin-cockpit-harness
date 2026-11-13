#!/usr/bin/env node
/** MCP stdio bridge for the native Wiki plugin. */
import process from "node:process";

const endpoint = process.env.COCKPIT_WIKI_URL || "";
const token = process.env.COCKPIT_WIKI_TOKEN || "";
const tools = [
  { name: "wiki_memory", description: "读取小型顶层 Memory 索引；需要详情时再用 wiki_search / wiki_read_page。", inputSchema: { type: "object", properties: { max_chars: { type: "number" } } } },
  { name: "wiki_search", description: "搜索 Wiki 页面和 sources。", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "wiki_list_sources", description: "列出已导入的 sources（id / title / kind）。", inputSchema: { type: "object", properties: {} } },
  { name: "wiki_read_source", description: "读取一个 source 的完整内容。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "wiki_read_page", description: "读取一个 Wiki 页面（含 citations / backlinks）。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "wiki_upsert_draft", description: "创建或更新一个 Wiki draft。source_ids 用于绑定引用；不会直接标记 reviewed。", inputSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, summary: { type: "string" }, source_ids: { type: "array", items: { type: "string" } } }, required: ["title", "content"] } },
  { name: "wiki_add_citation", description: "给页面绑定一个 source 引用。page/source 都可以用 id 或标题。", inputSchema: { type: "object", properties: { page: { type: "string" }, source: { type: "string" }, quote: { type: "string" }, locator: { type: "string" } }, required: ["page", "source"] } },
  { name: "memory_inject", description: "读取本次该注入的 L4 记忆（预算内，超了做减法）。", inputSchema: { type: "object", properties: { max_chars: { type: "number" } } } },
  { name: "memory_search", description: "只读检索历史会话 / 运行 / 事件（transcript），带时间、run、会话 id。", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "memory_note_write", description: "记录一条未验证观察（独立对象，不进页面审核流）。必须给来源。", inputSchema: { type: "object", properties: { body: { type: "string" }, source_kind: { type: "string" }, source_ref: { type: "string" } }, required: ["body"] } },
  { name: "memory_entry_write", description: "写一条记忆条目（L4 结论 / L3 项目 / L2 事实 / L1 原始）。带 sources 便于追溯。", inputSchema: { type: "object", properties: { layer: { type: "string" }, title: { type: "string" }, body: { type: "string" }, sources: { type: "array", items: { type: "string" } } }, required: ["title"] } },
  { name: "memory_promote_note", description: "把已验证观察晋升为记忆条目（note → 条目，可追溯到 note id）。", inputSchema: { type: "object", properties: { id: { type: "string" }, layer: { type: "string" } }, required: ["id"] } },
  { name: "persona_lookup", description: "查人物画像（本人 / 他人 / 关系），返回带来源的结论；没有依据返回 found=false。", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
  { name: "knowledge_search", description: "检索知识库资料（PDF/Office/网页等），返回页/段级命中。", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "knowledge_ask", description: "只基于知识库资料回答，带引用；没有依据明确说材料里没有。", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
];
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const at = buffer.indexOf("\n");
    if (at < 0) break;
    const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
    if (line) void handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));
function write(message) { process.stdout.write(JSON.stringify(message) + "\n"); }
async function call(name, args) {
  const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ name, arguments: args || {} }), signal: AbortSignal.timeout(120000) });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.result;
}
async function handle(line) {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") { write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "cockpit-wiki", version: "1.0.0" } } }); return; }
  if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") return;
  if (msg.method === "ping") { write({ jsonrpc: "2.0", id: msg.id, result: {} }); return; }
  if (msg.method === "tools/list") { write({ jsonrpc: "2.0", id: msg.id, result: { tools } }); return; }
  if (msg.method === "tools/call") {
    try { const result = await call(msg.params?.name, msg.params?.arguments || {}); write({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] } }); }
    catch (err) { write({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `wiki 工具失败：${String(err?.message || err)}` }], isError: true } }); }
    return;
  }
  if (msg.id !== undefined) write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `unsupported method: ${msg.method}` } });
}
