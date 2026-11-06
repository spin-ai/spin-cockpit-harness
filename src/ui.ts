import type { Agent, Run, Todo, TodoStatus } from "./types";

export const STATUS: Record<TodoStatus, { label: string; cls: string }> = {
  todo: { label: "待办", cls: "todo" },
  queued: { label: "排队", cls: "queued" },
  in_progress: { label: "进行中", cls: "running" },
  waiting_input: { label: "等待输入", cls: "waiting" },
  in_review: { label: "待验收", cls: "review" },
  done: { label: "完成", cls: "done" },
  cancelled: { label: "已取消", cls: "cancelled" },
};
export const COLUMNS: TodoStatus[] = ["todo", "queued", "in_progress", "waiting_input", "in_review", "done"];

export function timeAgo(ts: number, now = Date.now()) {
  const s = Math.max(1, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
export function duration(run: Run | null | undefined, now = Date.now()) {
  if (!run?.startedAt) return "—";
  const s = Math.max(0, Math.round(((run.endedAt ?? now) - run.startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function money(n: number) { return `$${Number(n || 0).toFixed(2)}`; }
/** null = 未上报，必须与 0 区分开 */
export function tokens(n: number | null | undefined) {
  if (n == null) return "未上报";
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
/** 毫秒 → 12s / 2m41s / 1h12m */
export function fmtMs(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 ? `${s % 60}s` : ""}`;
  return `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ""}`;
}
export function p50(values: number[]) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.floor((xs.length - 1) / 2)];
}
export function pct(part: number, total: number) {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}
export const ERROR_CLASS: Record<string, string> = { auth: "认证", rate_limit: "限流", timeout: "超时", other: "其他" };
export const FINISHED = ["completed", "failed", "cancelled"];
export const RUN_STATUS: Record<string, string> = {
  queued: "排队", running: "进行中", waiting_input: "等待输入",
  completed: "完成", failed: "失败", cancelled: "已停止",
};
export function agentOf(agents: Agent[], id: string | null) { return agents.find((a) => a.id === id) ?? null; }
export function activeRun(todo: Todo, runs: Run[]) {
  return runs.find((r) => r.todoId === todo.id && ["running", "waiting_input"].includes(r.status)) ?? null;
}
export function lastRun(todo: Todo, runs: Run[]) {
  const mine = runs.filter((r) => r.todoId === todo.id); return mine.length ? mine[mine.length - 1] : null;
}

/** 早期键名是 ymh.*；产品统一为 Cockpit Harness 后迁到 cmh.*（只迁一次，保留面板布局等偏好） */
export function migrateLocalStorage() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("ymh.")) continue;
      const next = `cmh.${key.slice(4)}`;
      const value = localStorage.getItem(key);
      if (value != null && localStorage.getItem(next) == null) localStorage.setItem(next, value);
      localStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}
