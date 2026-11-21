/**
 * 「谁在做哪件事」的统一投影（动线 A 的事实源）。
 *
 * 之前三个面各算一套：
 *   · TaskPane 直接读 state.todos（含 mission 子任务）
 *   · 场景 buildOfficeModel 用 actors.find(agentId)，阵容里没人就整条丢弃
 *   · Bot 页 Snapshot 里根本没有 todos 字段
 * 结果是同一条子任务在三个地方有三种命运。这里给一个 selector，三处共用。
 *
 * 绑定关系：Bot.executorAgentId → Agent.id；Todo.agentId → Agent.id；
 * Mission 子任务 = Todo.parentId === mission.id（mission 本身 kind === "mission"）。
 */
import type { Delegation, Todo } from "../types";

export type AssignmentStage = "plan" | "queued" | "running" | "waiting" | "review" | "done" | "failed";

export interface Assignment {
  todo: Todo;
  mission: Todo | null;
  delegation: Delegation | null;
  stage: AssignmentStage;
  stageLabel: string;
}

const STAGE: Record<AssignmentStage, string> = {
  plan: "待办",
  queued: "排队",
  running: "进行中",
  waiting: "待确认",
  review: "待验收",
  done: "完成",
  failed: "失败",
};

export function stageOf(todo: Todo): AssignmentStage {
  switch (todo.status) {
    case "queued":
      return "queued";
    case "in_progress":
      return "running";
    case "waiting_input":
      return "waiting";
    case "in_review":
      return "review";
    case "done":
      return "done";
    case "cancelled":
      return "failed";
    default:
      return todo.lastRunFailed ? "failed" : "plan";
  }
}

export interface AssignmentFilter {
  /** 只看这个执行体的任务（Bot 页用 bot.executorAgentId） */
  agentId?: string | null;
  /** 只看这个项目 */
  projectId?: string | null;
  /** 是否包含 mission 本体（默认 false，只列子任务与独立任务） */
  includeMissions?: boolean;
  /** 只看未完成的 */
  openOnly?: boolean;
}

/**
 * 返回按「需要人注意」排序的分配列表：进行中 → 待确认 → 待验收 → 排队 → 待办。
 */
export function assignmentsOf(
  todos: Todo[],
  delegations: Delegation[] | undefined,
  filter: AssignmentFilter = {},
): Assignment[] {
  const { agentId, projectId, includeMissions = false, openOnly = false } = filter;
  const missions = new Map(todos.filter((t) => t.kind === "mission").map((m) => [m.id, m]));
  const rows: Assignment[] = [];

  for (const todo of todos) {
    if (todo.kind === "chat") continue;
    if (!includeMissions && todo.kind === "mission") continue;
    if (projectId && todo.projectId && todo.projectId !== projectId) continue;
    if (agentId && todo.agentId !== agentId) continue;
    const stage = stageOf(todo);
    if (openOnly && (stage === "done" || stage === "failed")) continue;
    const mission = todo.parentId ? missions.get(todo.parentId) ?? null : null;
    const delegation =
      delegations?.find((d) => d.childTodoId === todo.id) ?? null;
    rows.push({ todo, mission, delegation, stage, stageLabel: STAGE[stage] });
  }

  const order: Record<AssignmentStage, number> = {
    running: 0, waiting: 1, review: 2, queued: 3, plan: 4, failed: 5, done: 6,
  };
  rows.sort((a, b) => order[a.stage] - order[b.stage] || b.todo.updatedAt - a.todo.updatedAt);
  return rows;
}

/** 给 Bot 页用：这个 bot 绑定的执行体，以及它能看到的任务 */
export function assignmentsForBot(
  todos: Todo[],
  delegations: Delegation[] | undefined,
  bot: { executorAgentId?: string | null },
  projectId?: string | null,
): { agentId: string | null; rows: Assignment[] } {
  const agentId = bot.executorAgentId ?? null;
  if (!agentId) return { agentId: null, rows: [] };
  return { agentId, rows: assignmentsOf(todos, delegations, { agentId, projectId, openOnly: true }) };
}
