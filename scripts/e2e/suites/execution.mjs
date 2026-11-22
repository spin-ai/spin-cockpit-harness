#!/usr/bin/env node
/**
 * 执行契约（ARCH-workbench-execution I1–I10 的可执行部分）。
 *
 * 关键：验证「受管执行」与「手动终端」是两种事实 ——
 *   · 探索 Run 可以 todoId=null，关联任务后 runId / startedAt / terminalId 不变；
 *   · 手敲 shell 不产生 Run，关联任务只改导航归属、不改 Todo 状态；
 *   · 纯聊天不再创建隐藏 kind=chat Todo，转任务时历史 run 原样挂回；
 *   · 关闭视图只 detach（pty 仍 running），只有结束进程才结算。
 *
 * 前置：由 scripts/e2e/run.mjs --suite=execution 起隔离实例；不碰用户 userData。
 * 用法：node scripts/e2e/suites/execution.mjs <port>
 */
import { attach } from "../harness.mjs";

const port = Number(process.argv[2] || 9223);
const { run, close } = await attach(port);

const results = [];
const skipped = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`);
};
const skip = (name, why) => {
  skipped.push(name);
  console.log(`SKIP ${name} · ${why}`);
};

const state = () => run(`
  const s = await window.harness.getState();
  return {
    runs: s.runs.map((r) => ({ id: r.id, todoId: r.todoId ?? null, threadId: r.threadId ?? null, status: r.status, terminalId: r.terminalId ?? null, startedAt: r.startedAt ?? null, trigger: r.trigger })),
    todos: s.todos.map((t) => ({ id: t.id, key: t.key, status: t.status, kind: t.kind || "task" })),
    terminals: (s.terminals || []).map((t) => ({ id: t.id, todoId: t.todoId ?? null, runId: t.runId ?? null, status: t.status })),
    threads: s.threads.map((t) => ({ id: t.id, todoId: t.todoId ?? null, chatOnly: Boolean(t.chatOnly) })),
    projectPath: s.projectPath,
    activeProjectId: s.activeProjectId,
  };`);

const action = (type, payload) => run(`
  const res = await window.harness.action(${JSON.stringify(type)}, ${JSON.stringify(payload ?? {})});
  return res?.result ?? null;`);

const createTerminal = (cwd, opts) => run(`
  const res = await window.harness.createTerminal(${JSON.stringify(cwd)}, ${JSON.stringify(opts || {})});
  return { id: res.id, runId: res.run?.id || null, runTodoId: res.run ? (res.run.todoId ?? null) : undefined, cwd: res.cwd };`);

const detach = (id) => run(`return await window.harness.detachTerminal(${JSON.stringify(id)});`);

// ── 0. 基线 ─────────────────────────────────────────────────────────
let s = await state();
check("拿到初始状态", typeof s.projectPath === "string" && s.projectPath.length > 0, s.projectPath);
const cwd = s.projectPath;
const projectId = s.activeProjectId;

// ── 1. 探索 Run：无 Todo 也能存在，关联后事实不变 ──────────────────────
const runsBefore = s.runs.length;
const todoA = await action("createTodos", { text: "契约用例 · 关联目标" });
const targetTodo = todoA?.todos?.[0] || null;
check("建一条关联用任务", Boolean(targetTodo?.id), targetTodo?.key || "");

const explore = await createTerminal(cwd, { command: "cat", projectId, explore: true });
s = await state();
const exploreRun = s.runs.find((r) => r.id === explore.runId) || null;
check("探索：创建一个受管 Run", Boolean(exploreRun) && s.runs.length === runsBefore + 1, `run=${explore.runId} total=${s.runs.length}`);
check("I2 探索 Run 的 todoId 为空", Boolean(exploreRun) && exploreRun.todoId === null, String(exploreRun?.todoId));
check("I3 探索 Run 绑定了 Terminal", Boolean(exploreRun?.terminalId) && exploreRun.terminalId === explore.id, String(exploreRun?.terminalId));
check("探索：不自动产生任务", s.todos.length === 1, `todos=${s.todos.length}（只有关联用那一条）`);

const startedAtBefore = exploreRun?.startedAt || null;
const attachRes = await action("attachRunToTodo", { runId: explore.runId, todoId: targetTodo.id });
s = await state();
const attached = s.runs.find((r) => r.id === explore.runId) || null;
check("I6 关联后 todoId 指向目标任务", Boolean(attached) && attached.todoId === targetTodo.id, String(attached?.todoId));
check("I6 关联不改 runId / startedAt / terminalId", Boolean(attached)
  && attached.id === explore.runId
  && attached.startedAt === startedAtBefore
  && attached.terminalId === explore.id,
  `startedAt ${startedAtBefore} → ${attached?.startedAt}`);
const todoAfterAttach = s.todos.find((t) => t.id === targetTodo.id);
check("关联后 Todo 按 Run 真实状态投影（running → in_progress）", todoAfterAttach?.status === "in_progress", String(todoAfterAttach?.status));
check("Terminal 记录的 todoId 同步", s.terminals.find((t) => t.id === explore.id)?.todoId === targetTodo.id);

// ── 2. 手动终端：绝不伪造 Run ─────────────────────────────────────────
const runsBeforeShell = s.runs.length;
const todoB = await action("createTodos", { text: "契约用例 · 手动终端归属" });
const manualTodo = todoB?.todos?.[0] || null;
const statusBefore = (await state()).todos.find((t) => t.id === manualTodo.id)?.status;

const manual = await createTerminal(cwd, { command: "cat", projectId });
s = await state();
check("I5 手敲终端不创建 Run", s.runs.length === runsBeforeShell && manual.runId === null, `runs ${runsBeforeShell} → ${s.runs.length}`);
check("I1 手动终端有 Terminal 记录", Boolean(s.terminals.find((t) => t.id === manual.id)));

await action("linkTerminalToTodo", { terminalId: manual.id, todoId: manualTodo.id });
s = await state();
const manualTodoAfter = s.todos.find((t) => t.id === manualTodo.id);
check("I5 关联手动终端不增加 Run", s.runs.length === runsBeforeShell, `runs=${s.runs.length}`);
check("I5 关联手动终端不改 Todo 状态", manualTodoAfter?.status === statusBefore, `${statusBefore} → ${manualTodoAfter?.status}`);
check("手动终端关联只写导航归属", s.terminals.find((t) => t.id === manual.id)?.todoId === manualTodo.id
  && s.terminals.find((t) => t.id === manual.id)?.runId === null);

// ── 3. 关闭视图 ≠ 结束进程 ───────────────────────────────────────────
const detached = await detach(manual.id);
s = await state();
check("detach 返回 true", detached === true);
check("I7 关闭视图后 Terminal 仍 running", s.terminals.find((t) => t.id === manual.id)?.status === "running",
  String(s.terminals.find((t) => t.id === manual.id)?.status));
const reattach = await run(`return await window.harness.attachTerminal(${JSON.stringify(manual.id)});`);
check("重新 attach 能拿回同一实例", reattach && reattach.missing !== true, JSON.stringify({ exited: reattach?.exited, bytes: (reattach?.data || "").length }));

// ── 4. 纯聊天：无隐藏 Todo；转任务保留历史 run ────────────────────────
// 纯聊天只支持 ACP Agent；隔离实例默认没有，先试着纳管 dsh，不可用则 SKIP
const acpAgent = await action("createAgent", { cli: "dsh", projectId }).catch(() => null);
if (!acpAgent?.id) {
  skip("纯聊天：不再创建隐藏 Todo", "隔离实例没有可用的 ACP Agent（未检测到 dsh）");
  skip("纯聊天：转任务原样挂回历史 run", "同上");
} else {
const beforeChat = await state();
const thread = await action("newThread", {});
const todosBeforeChat = beforeChat.todos.length;
const chatRes = await run(`
  const res = await window.harness.action("chat", { threadId: ${JSON.stringify(thread.id)}, text: "契约用例：只聊一句" });
  return res?.result ?? null;`);
s = await state();
check("纯聊天有返回", Boolean(chatRes), JSON.stringify(chatRes?.mode || ""));
check("纯聊天不再创建隐藏 kind=chat Todo", s.todos.length === todosBeforeChat, `todos ${todosBeforeChat} → ${s.todos.length}`);
check("纯聊天没有 kind=chat 任务残留", s.todos.every((t) => t.kind !== "chat"));
const chatRun = s.runs.find((r) => r.threadId === thread.id && !r.todoId) || null;
check("纯聊天 run 的 todoId 为空且挂 thread", Boolean(chatRun), chatRun ? `run=${chatRun.id} status=${chatRun.status}` : "not found");

const promoted = await action("promoteThreadToTodo", { threadId: thread.id });
s = await state();
const promotedTodo = s.todos.find((t) => t.id === promoted?.id) || null;
check("转为任务只新增一个真实任务", Boolean(promotedTodo) && s.todos.length === todosBeforeChat + 1, `todos=${s.todos.length}`);
check("转为任务不改 kind（不是 chat）", promotedTodo?.kind === "task", String(promotedTodo?.kind));
const chatRunAfter = s.runs.find((r) => r.id === chatRun?.id) || null;
check("历史 run 原样挂到新任务（runId 不变）", Boolean(chatRunAfter) && chatRunAfter.todoId === promotedTodo?.id,
  `${chatRun?.id} todoId ${chatRun?.todoId} → ${chatRunAfter?.todoId}`);
}

// ── 5. 显式结束进程才结算 ─────────────────────────────────────────────
await run(`await window.harness.closeTerminal(${JSON.stringify(manual.id)});`);
s = await state();
check("显式结束进程后 Terminal 不再是 running",
  s.terminals.find((t) => t.id === manual.id)?.status !== "running",
  String(s.terminals.find((t) => t.id === manual.id)?.status));

// 清理：结束探索 terminal，避免用例进程残留
await run(`await window.harness.closeTerminal(${JSON.stringify(explore.id)});`).catch(() => {});

const passed = results.filter(Boolean).length;
console.log(`\nExecution contract: ${passed}/${results.length} 项${skipped.length ? ` · ${skipped.length} SKIP` : ""}`);
await close();
process.exit(passed === results.length ? 0 : 1);
