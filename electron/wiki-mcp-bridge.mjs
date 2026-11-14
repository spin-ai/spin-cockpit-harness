#!/usr/bin/env node
/** MCP stdio bridge for the native Wiki plugin. */
import process from "node:process";

const endpoint = process.env.COCKPIT_WIKI_URL || "";
const token = process.env.COCKPIT_WIKI_TOKEN || "";
const tools = [
  { name: "wiki_search", description: "搜索 Wiki 页面和 sources。", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "wiki_list_sources", description: "列出已导入的 sources（id / title / kind）。", inputSchema: { type: "object", properties: {} } },
  { name: "wiki_read_source", description: "读取一个 source 的完整内容。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "wiki_read_page", description: "读取一个 Wiki 页面（含 citations / backlinks）。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "wiki_upsert_draft", description: "创建或更新一个 Wiki draft。source_ids 用于绑定引用；不会直接标记 reviewed。", inputSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, summary: { type: "string" }, source_ids: { type: "array", items: { type: "string" } } }, required: ["title", "content"] } },
  { name: "wiki_add_citation", description: "给页面绑定一个 source 引用。page/source 都可以用 id 或标题。", inputSchema: { type: "object", properties: { page: { type: "string" }, source: { type: "string" }, quote: { type: "string" }, locator: { type: "string" } }, required: ["page", "source"] } },
  { name: "memory_inject", description: "读取本次该注入的 L4 记忆（预算内，超了做减法）。", inputSchema: { type: "object", properties: { max_chars: { type: "number" } } } },
  { name: "memory_search", description: "只读检索历史会话 / 运行 / 事件（transcript），带时间、run、会话 id。中文按 bigram 分词（两个字的词也能查到），返回片段切在命中处附近。用于校正记忆前找事实依据。", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "memory_note_write", description: "记录一条未验证观察（独立对象，不进页面审核流）。source_ref 必须给（哪条消息 / 哪个 run / 哪个页面），不提供会被拒；同一句话重复写入只抬置信度不新增行。kind=rule|gotcha|guess|preference|decision；guess 默认 14 天过期，rule/decision 不过期。上限 400 字，更长的内容去写页面或条目。", inputSchema: { type: "object", properties: { body: { type: "string" }, kind: { type: "string", description: "rule | gotcha | guess | preference | decision" }, confidence: { type: "number", description: "0..1，默认 guess=0.4，其余 0.6" }, source_kind: { type: "string" }, source_ref: { type: "string", description: "来源 id（必填）" } }, required: ["body", "source_ref"] } },
  { name: "memory_entry_write", description: "写一条记忆条目（L4 结论 / L3 项目 / L2 事实 / L1 原始）。带 sources 便于追溯。", inputSchema: { type: "object", properties: { layer: { type: "string" }, title: { type: "string" }, body: { type: "string" }, sources: { type: "array", items: { type: "string" } } }, required: ["title"] } },
  { name: "run_read", description: "回查某个 run：状态 / 时间 / token / 错误 + 这轮的消息（最多 20 条，截断）+ 提到它的关键事件。用于弄清楚\"那一次到底做了什么\"，找\"哪次提过\"用 memory_search。", inputSchema: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"] } },
  { name: "memory_promote_note", description: "把已验证观察晋升为记忆条目（note → 条目，可追溯到 note id）。如果新结论推翻了旧条目，把旧条目 id 放进 supersedes：旧条目会被标失效（不删除、不再注入、可按时间回看）。", inputSchema: { type: "object", properties: { id: { type: "string" }, layer: { type: "string" }, supersedes: { type: "array", items: { type: "string" }, description: "被这条新结论推翻的旧条目 id" } }, required: ["id"] } },
  { name: "persona_lookup", description: "查人物画像（本人 / 他人 / 关系），返回带来源的结论；没有依据返回 found=false。同名时会附上人设卡注入片段（已按衰减权重与问题相关性裁剪）。", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
  { name: "persona_review", description: "列出人物画像里「需要复核」的事实（时间敏感事实到期，或已被归档）。这些不进当前画像、也不注入；给 person_id 只看某人。", inputSchema: { type: "object", properties: { person_id: { type: "string" }, limit: { type: "number" } } } },
  { name: "knowledge_search", description: "检索知识库资料（PDF/Office/网页等），返回页/段级命中。", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
  { name: "knowledge_ask", description: "问答：页面与资料一起检索，答案带可点出处；没有依据明确说材料里没有。", inputSchema: { type: "object", properties: { question: { type: "string" }, scope: { type: "string", description: "all | pages | docs，默认 all" } }, required: ["question"] } },
  { name: "knowledge_docs", description: "列出知识库资料（id / 标题 / 页数 / 状态 / 索引模式）。", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "knowledge_read", description: "读取某份资料的原文分页（含页码与标题），用于核对引用。", inputSchema: { type: "object", properties: { id: { type: "string" }, page: { type: "number" }, max_chars: { type: "number" } }, required: ["id"] } },
  { name: "knowledge_cite", description: "把资料的一段引用到页面（写入 citation 快照）。quote 建议用 knowledge_read 拿到的原文片段。", inputSchema: { type: "object", properties: { page_id: { type: "string" }, doc_id: { type: "string" }, page: { type: "number" }, quote: { type: "string" }, locator: { type: "string" } }, required: ["page_id", "doc_id"] } },
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
