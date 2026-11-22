import type { MessageMeta } from "./types";

/**
 * 工具家族：主进程写入 `meta.family`（ACP `kind` 优先，其次工具名），
 * 这里只做**旧数据的兜底**——新写入的不要再走正则。
 * 家族决定卡片长什么样：run（终端）/ edit（diff）/ read（路径 + 行数）/
 * search（命中数）/ net（网页）/ mcp（外部工具）/ plan（计划）/ think（思考）/ other。
 */
export type ToolFamily = "read" | "edit" | "run" | "search" | "net" | "mcp" | "plan" | "think" | "other";

export type ToolStatus = "running" | "waiting" | "done" | "failed" | "denied" | "stopped";

const FAMILIES: readonly ToolFamily[] = ["read", "edit", "run", "search", "net", "mcp", "plan", "think", "other"];

const KIND_FAMILY: Record<string, ToolFamily> = {
  read: "read", edit: "edit", delete: "edit", move: "edit",
  search: "search", execute: "run", think: "think", fetch: "net",
};

const FAMILY_RULES: [ToolFamily, RegExp][] = [
  // bot 只读工具（名字不带 kind）：先归类，再走家族
  ["search", /^(memory_search|knowledge_search|transcript_search|wiki_search)\b/i],
  ["read", /^(todo_list|todo_read|run_status|run_read|workspace_list|workspace_grep|bot_list)\b/i],
  ["plan", /^(todo_write|todowrite|write_todos|update_plan|todolist|todo_list|plan)\b/i],
  ["read", /(^|[_\-\s])(read|view|cat|open_file|file_read|read_file)([_\-\s]|$)/i],
  ["edit", /(edit|write|patch|replace|apply|create_file|str_replace|mkdir)/i],
  ["run", /(bash|shell|terminal|exec|command|run|spawn|kill)/i],
  ["search", /(search|grep|glob|find|query|rg\b)/i],
  ["net", /(web|fetch|http|url|browse|curl|request)/i],
];

/** 家族标签（卡片头部 / 过程摘要用） */
export const FAMILY_LABEL: Record<ToolFamily, string> = {
  read: "读取", edit: "编辑", run: "终端", search: "搜索",
  net: "网页", mcp: "外部工具", plan: "计划", think: "思考", other: "工具",
};

/** 过程摘要在计数时的单位：读了 3 个文件 / 改了 2 处 / 跑了 1 条命令 */
export const FAMILY_UNIT: Partial<Record<ToolFamily, string>> = {
  read: "个文件", edit: "处", run: "条命令", search: "次搜索", net: "个网页", mcp: "次外部调用",
};

/** 步骤行的人话动词：ZCode 的「已读取 / 已执行 / 已编辑 / 已搜索」那一层 */
export const FAMILY_VERB: Record<ToolFamily, string> = {
  read: "已读取", edit: "已编辑", run: "已执行", search: "已搜索",
  net: "已打开", mcp: "已调用", plan: "已更新", think: "思考", other: "已处理",
};

/** JSON 参数 → 人话摘要：{"limit":5,"status":"all"} → limit=5 · status=all */
export function humanArgs(text: string): string {
  const value = String(text || "").trim();
  if (!/^[[{]/.test(value) || value.length > 400) return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => humanArgs(JSON.stringify(item))).slice(0, 3).join(" · ");
    if (!parsed || typeof parsed !== "object") return String(parsed ?? "");
    const parts: string[] = [];
    for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
      if (raw === null || raw === undefined || raw === "") continue;
      const label = typeof raw === "object" ? (Array.isArray(raw) ? `${raw.length} 项` : "…") : String(raw);
      parts.push(`${key}=${label}`);
      if (parts.length === 3) break;
    }
    return parts.join(" · ");
  } catch {
    return value;
  }
}

const PATH_LIKE = /(^~?\/|[A-Za-z]:\\|\/[\w.@+-]+\/)|\.[A-Za-z0-9]{1,6}$/;

/** 步骤行的宾语：优先人类可读的 description，其次参数摘要（命令 / 路径 / 查询） */
export function objectOf(meta: MessageMeta | null | undefined, family: ToolFamily, fallback = ""): string {
  const hint = humanArgs(String(meta?.hint || "").trim());
  const desc = humanArgs(String(meta?.description || "").trim());
  const title = String(meta?.title || "").trim();
  if (family === "read" || family === "edit") {
    const path = [hint, desc, title, fallback].find((v) => v && PATH_LIKE.test(v));
    return path || desc || hint || title || fallback;
  }
  if (family === "run") return hint || desc || title || humanArgs(fallback);
  if (family === "search") return hint || desc || title || humanArgs(fallback);
  return desc || hint || title || humanArgs(fallback);
}

/** 看起来像文件路径（渲染成可点的文件 chip，而不是一行字） */
export function isFileLike(text: string): boolean {
  const value = String(text || "").trim();
  if (!value || value.length > 260) return false;
  if (/\s{2,}/.test(value)) return false;
  return PATH_LIKE.test(value);
}

/** 状态文案；running / waiting 只在流式里有意义 */
export const STATUS_LABEL: Record<ToolStatus, string> = {
  running: "运行中", waiting: "待批准", done: "完成", failed: "失败", denied: "被拒", stopped: "已停止",
};

/**
 * 取工具家族：优先结构化字段，其次按 `kind` / 工具名兜底（旧消息、第三方 ACP）。
 * @param meta 消息 meta（新写入带 family）
 * @param hint 兜底用的标题 / 正文首行 / ACP kind
 */
export function familyOf(meta: MessageMeta | null | undefined, hint: { title?: string; kind?: string; content?: string } = {}): ToolFamily {
  const explicit = meta?.family as ToolFamily | undefined;
  if (explicit && FAMILIES.includes(explicit)) return explicit;
  const name = hint.title || "";
  if (/^mcp__/i.test(name)) return "mcp";
  const byKind = KIND_FAMILY[String(hint.kind || meta?.kind || "").toLowerCase()];
  if (byKind) return byKind;
  const text = `${name} ${hint.kind || meta?.kind || ""} ${(hint.content || "").slice(0, 120)}`;
  for (const [family, re] of FAMILY_RULES) if (re.test(text)) return family;
  return "other";
}

const FINAL: ToolStatus[] = ["done", "failed", "denied", "stopped"];

/** 取工具状态：新数据读 `statusKind`，老的 `status`（ACP 原文）兜底归一化 */
export function statusOf(meta: MessageMeta | null | undefined): ToolStatus {
  const explicit = meta?.statusKind as ToolStatus | undefined;
  if (explicit && (FINAL.includes(explicit) || explicit === "running" || explicit === "waiting")) return explicit;
  const raw = String(meta?.status || "").toLowerCase();
  if (raw === "failed" || raw === "error") return "failed";
  if (raw === "completed" || raw === "done") return "done";
  if (raw === "cancelled" || raw === "canceled") return "stopped";
  if (raw === "awaiting_approval") return "waiting";
  return raw ? "running" : "done";
}

/** 同族连续步骤：连续同类合成一段（≥3 条时由调用方收成一行，否则 20 行「已执行」就是日志洪水） */
export function runsOfFamily<T>(items: T[], familyOfItem: (item: T) => ToolFamily): { family: ToolFamily; items: T[] }[] {
  const runs: { family: ToolFamily; items: T[] }[] = [];
  for (const item of items) {
    const family = familyOfItem(item);
    const last = runs[runs.length - 1];
    if (last && last.family === family) last.items.push(item);
    else runs.push({ family, items: [item] });
  }
  return runs;
}

/** 过程摘要：读 3 个文件 · 改 2 处 · 跑 1 条命令（0 的不出现，顺序固定） */
export function summarizeFamilies(families: ToolFamily[]): string {
  const counts = new Map<ToolFamily, number>();
  for (const family of families) {
    if (family === "think" || family === "other") continue;
    counts.set(family, (counts.get(family) || 0) + 1);
  }
  const order: ToolFamily[] = ["run", "edit", "read", "search", "net", "mcp", "plan"];
  const parts: string[] = [];
  for (const family of order) {
    const n = counts.get(family);
    if (!n) continue;
    const unit = FAMILY_UNIT[family] || "";
    // 中文量词跟着数字走：3 个文件 / 2 处 / 1 条命令
    parts.push(family === "edit" ? `改 ${n} 处` : family === "read" ? `读 ${n} ${unit}` : family === "run" ? `跑 ${n} ${unit}` : family === "search" ? `搜 ${n} 次` : family === "net" ? `看 ${n} 个网页` : family === "mcp" ? `调外部 ${n} 次` : `计划 ${n} 步`);
    if (parts.length === 3) break;
  }
  return parts.join(" · ");
}

/** 一轮的整体状态：有失败就 failed，被中断是 stopped，全完成才是 done */
export function turnStatusOf(statuses: ToolStatus[]): ToolStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("denied")) return "denied";
  if (statuses.includes("stopped")) return "stopped";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("waiting")) return "waiting";
  return "done";
}

/** 耗时展示：< 1s 不写，1–60s 写 s，更长写 m */
export function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 1000) return "";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes}m${seconds}s` : `${minutes}m`;
}
