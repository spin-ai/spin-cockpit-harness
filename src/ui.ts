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
export function tokens(n: number) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0); }
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
