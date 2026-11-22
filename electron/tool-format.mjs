/**
 * 工具调用 → Chat 消息正文。
 *
 * ACP 的 tool_call 只给 `title`（常常就是 kind 本身，如 "bash"）+ `rawInput`，
 * tool_call_update 再补 `status` 与 `content` 输出。首行必须是「干了什么」，
 * 否则折叠组和 ToolRow 都只剩 "bash · completed"。
 */

const STATUS_TEXT = {
  pending: "排队中",
  in_progress: "运行中",
  running: "运行中",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
  canceled: "已取消",
  awaiting_approval: "待批准",
};

export function toolStatusText(status) {
  if (!status) return "";
  return STATUS_TEXT[String(status).toLowerCase()] || String(status);
}

/**
 * ACP `kind` 到展示家族的映射。`kind` 比 `title` 可信：title 常被模型改写成中文或
 * 直接写成 kind；`kind` 是协议规定的那几个值。
 */
const KIND_FAMILY = {
  read: "read",
  edit: "edit",
  delete: "edit",
  move: "edit",
  search: "search",
  execute: "run",
  think: "think",
  fetch: "net",
};

/** 没有 kind 时按工具名兜底（旧消息 / bot 只读工具 / 第三方 ACP 实现） */
const FAMILY_RULES = [
  ["plan", /^(todo_write|todowrite|write_todos|update_plan|todolist|plan)\b/i],
  ["read", /(^|[_\-\s])(read|view|cat|open_file|file_read|read_file)([_\-\s]|$)/i],
  ["edit", /(edit|write|patch|replace|apply|create_file|str_replace|mkdir)/i],
  ["run", /(bash|shell|terminal|exec|command|run|spawn|kill)/i],
  ["search", /(search|grep|glob|find|query|rg\b)/i],
  ["net", /(web|fetch|http|url|browse|curl|request)/i],
];

/** 工具家族：read / edit / run / search / net / mcp / plan / think / other */
export function toolFamily({ kind = "", title = "", input = "" } = {}) {
  const name = String(title || "");
  // MCP 工具在 ACP 里叫 mcp__<server>__<tool>；rawInput 只有 JSON 时也认一次
  if (/mcp__[a-z0-9_-]+__[a-z0-9_-]+/i.test(name) || /mcp__[a-z0-9_-]+__[a-z0-9_-]+/i.test(String(input || "").slice(0, 200))) return "mcp";
  const byKind = KIND_FAMILY[String(kind || "").toLowerCase()];
  if (byKind) return byKind;
  const text = `${name} ${kind}`;
  for (const [family, re] of FAMILY_RULES) if (re.test(text)) return family;
  return "other";
}

/** 归一化工具状态：running / waiting / done / failed / denied / stopped */
export function normalizeToolStatus(status, { rejected = false, failed = false } = {}) {
  if (rejected) return "denied";
  const s = String(status || "").toLowerCase();
  if (failed || s === "failed" || s === "error") return "failed";
  if (s === "completed" || s === "done" || s === "success") return "done";
  if (s === "cancelled" || s === "canceled" || s === "aborted") return "stopped";
  if (s === "awaiting_approval" || s === "waiting_input" || s === "blocked") return "waiting";
  return "running";
}

/** 把 ACP content（数组或单个 part）里的文本拼出来；只保留前 max 个字符 */
export function toolOutputText(content, max = 1200) {
  if (!content) return "";
  const parts = Array.isArray(content) ? content : [content];
  const texts = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const inner = part.content && typeof part.content === "object" ? part.content : part;
    const text = inner.text ?? inner.content ?? "";
    if (typeof text === "string" && text.trim()) texts.push(text.trim());
  }
  const joined = texts.join("\n").trim();
  if (!joined) return "";
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}

export function toolTitle(title) {
  const text = String(title || "").trim();
  if (!text) return "工具";
  // 纯小写英文的工具名首字母大写，读起来像名字而不是变量
  if (/^[a-z][a-z0-9_-]*$/.test(text)) return text[0].toUpperCase() + text.slice(1);
  return text;
}

/**
 * @returns {string} 形如 "Bash · 完成 · ls -1" + 换行 + 说明/输出
 */
export function formatToolContent({ title, status, hint, description, output } = {}) {
  const name = toolTitle(title);
  const state = toolStatusText(status);
  const arg = String(hint || "").replace(/\s+/g, " ").trim();
  const argShort = arg.length > 72 ? `${arg.slice(0, 72)}…` : arg;
  const head = [name, state, argShort].filter(Boolean).join(" · ");
  const lines = [head];
  // 第二段起是展开内容：完整命令 → 工具自述 → 输出
  if (arg && arg !== argShort) lines.push(arg);
  const desc = String(description || "").replace(/\s+/g, " ").trim();
  if (desc && desc !== arg) lines.push(desc);
  const out = String(output || "").trim();
  if (out) lines.push(out);
  return lines.join("\n");
}
