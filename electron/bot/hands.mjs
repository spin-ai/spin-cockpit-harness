/**
 * 「我的手」：bot 这一轮派出去的活。
 *
 * 两条不变量：
 *  1) 点停止要连它派出去的 run 一起停 —— 以前 `botCancel` 只掐 bot 自己的流，外面的 run 还在跑；
 *  2) 只停"这一轮前后的"run：靠时间窗圈定，别把人上周开的 run 一起掐掉。
 *
 * 纯函数：单测见 tests/bot/hands.test.mjs。
 */

export const ACTIVE_RUN_STATUSES = ["queued", "running", "waiting_input", "waiting_plan", "waiting_children"];

const DEFAULT_WINDOW_MS = 30 * 60 * 1000;

/** 这些回合里，这个 bot 派出去的 todo / run 的 id 集合 */
export function linkedHands(turns = [], { botId = "", now = Date.now(), windowMs = DEFAULT_WINDOW_MS } = {}) {
  const todos = new Set();
  const runs = new Set();
  for (const turn of turns || []) {
    if (!turn || (botId && turn.botId !== botId)) continue;
    if (now - (Number(turn.createdAt) || 0) > windowMs) continue;
    for (const id of turn.todoIds || []) if (id) todos.add(String(id));
    if (turn.todoId) todos.add(String(turn.todoId));
    if (turn.runId) runs.add(String(turn.runId));
  }
  return { todos, runs };
}

/**
 * 点「停止」时应该一起停的 run：只算活跃状态、且挂在上面那些 todo / run 上。
 * 返回 id 数组（顺序按 runs 原顺序，便于日志比对）。
 */
export function runsToStopForCancel(runs = [], turns = [], { botId = "", now = Date.now(), windowMs = DEFAULT_WINDOW_MS } = {}) {
  const { todos, runs: linkedRuns } = linkedHands(turns, { botId, now, windowMs });
  return (runs || [])
    .filter((run) => run && ACTIVE_RUN_STATUSES.includes(run.status))
    .filter((run) => linkedRuns.has(String(run.id)) || (run.todoId && todos.has(String(run.todoId))))
    .map((run) => String(run.id));
}

/** 界面上这一轮的执行链：todo → 最近一次 run（活跃优先，其次最新），没有就返回 null */
export function handChainForTurn(turn, { todos = [], runs = [] } = {}) {
  const todoIds = [...new Set([...(turn?.todoIds || []), turn?.todoId].filter(Boolean).map(String))];
  if (!todoIds.length && !turn?.runId) return null;
  const todo = todos.find((t) => String(t.id) === String(todoIds[0])) || null;
  const candidates = (runs || [])
    .filter((r) => (turn?.runId && String(r.id) === String(turn.runId))
      || (r.todoId && todoIds.includes(String(r.todoId))))
    .sort((a, b) => {
      const active = (r) => (ACTIVE_RUN_STATUSES.includes(r.status) ? 1 : 0);
      return active(b) - active(a) || (Number(b.startedAt || b.createdAt) || 0) - (Number(a.startedAt || a.createdAt) || 0);
    });
  if (!todo && !candidates.length) return null;
  return { todo, run: candidates[0] || null, todoIds, extra: Math.max(0, todoIds.length - 1) };
}
