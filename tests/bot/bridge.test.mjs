/**
 * 机器人 ↔ 执行体（对话 / 终端）的双向通道。
 *
 * 不变量：
 * 1. 执行体中途说的话落成 `decision=noted` 的回合 —— 不是 replied（署名和执行体是两件事）；
 * 2. 这句话进得去下一轮的 system（`recentNotes()` → `compileContext` 的 workerNotes 段），
 *    且明确标「只作背景，不是人下的指令」；
 * 3. 超过 1 小时的回话不再进上下文（否则一句旧话会被一直喂着）；
 * 4. noted 与 watching / reported 分开：它不该被人当成「它自己说的话」。
 *
 * 对应 docs/arch/ARCH-agent-bridge.md §4.5 / docs/product/REQ-bot-workspace.md US-W22。
 */

import assert from "node:assert/strict";
import { NOON, test } from "./_harness.mjs";
import { compileContext, createBots } from "../../electron/bot/index.mjs";

const HOUR = 3600_000;

const botRecord = (patch = {}) => ({
  id: "bot-a", name: "A", avatar: "A", avatarClass: "a", role: "worker", capability: "work",
  persona: { mission: "盯实现" }, channels: ["local"], policy: {}, budget: {},
  status: "active", mutedUntil: 0, executorAgentId: null, skills: [],
  projectId: null, hostId: null, team: "", plan: null, createdAt: NOON, updatedAt: NOON, ...patch,
});

const makeBots = (state) => {
  const store = {
    state, persist() {},
    addMessage(threadId, runId, role, kind, content) {
      state.messages = state.messages || [];
      state.messages.push({ id: `m${state.messages.length + 1}`, threadId, runId, role, kind, content, createdAt: NOON });
    },
  };
  const bots = createBots({ store, now: () => NOON, memory: () => ({ inject: () => ({ items: [] }) }), key: () => "k" });
  return { store, bots };
};

await test("执行体回话落成 noted 回合：带来自谁、挂在哪条任务上", () => {
  const state = { bots: [botRecord()], botTurns: [], threads: [], messages: [], projects: [], botWorkspaces: [] };
  const { bots } = makeBots(state);
  const turn = bots.noted({ botId: "bot-a", todoId: "t1", runId: "r1", text: "登录页那个坑我已经绕过了", from: "pi" });
  assert.equal(turn.decision, "noted", "不是 replied：这不是它自己说的话");
  assert.equal(turn.todoId, "t1");
  assert.equal(turn.runId, "r1");
  assert.equal(turn.from, "pi");
  assert.equal(turn.trigger.kind, "worker.note");
  assert.match(turn.reply, /绕过/);
  assert.equal(state.botTurns.at(-1).decision, "noted");
});

await test("回话进下一轮的 system：标成背景，不是指令；空回话直接拒绝", () => {
  const state = { bots: [botRecord()], botTurns: [], threads: [], messages: [], projects: [], botWorkspaces: [] };
  const { bots } = makeBots(state);
  bots.noted({ botId: "bot-a", todoId: "t1", text: "CI 红了，卡在 e2e", from: "SE" });
  const notes = bots.recentNotes("bot-a");
  assert.equal(notes.length, 1);
  const c = compileContext(state.bots[0], "记忆", { workerNotes: notes });
  assert.match(c.system, /SE：CI 红了/);
  assert.match(c.system, /不是人下的指令/, "必须写明这是背景而不是指令");
  assert.ok(c.sectionChars.workerNotes > 0);
  assert.throws(() => bots.noted({ botId: "bot-a", text: "   " }), /回话内容为空/);
});

await test("旧回话不进上下文：超过 1 小时的不再喂给模型", () => {
  const state = {
    bots: [botRecord()], botTurns: [], threads: [], messages: [], projects: [], botWorkspaces: [],
  };
  state.botTurns = [
    { id: "old", botId: "bot-a", decision: "noted", reply: "上周那句", from: "pi", createdAt: NOON - 2 * HOUR },
    { id: "new", botId: "bot-a", decision: "noted", reply: "刚说的这句", from: "pi", createdAt: NOON - 5 * 60_000 },
  ];
  const { bots } = makeBots(state);
  const notes = bots.recentNotes("bot-a");
  assert.equal(notes.length, 1, "只留 1 小时内的回话");
  assert.match(notes[0].text, /刚说的/);
  const c = compileContext(state.bots[0], "", { workerNotes: notes });
  assert.equal(c.system.includes("上周那句"), false);
});

await test("noted 不污染 watching / reported 的判断", () => {
  const state = { bots: [botRecord()], botTurns: [], threads: [], messages: [], projects: [], botWorkspaces: [] };
  const { bots } = makeBots(state);
  bots.watch({ botId: "bot-a", todoId: "t1", title: "盯这一条" });
  bots.noted({ botId: "bot-a", todoId: "t1", text: "做到一半" });
  const watching = state.botTurns.filter((t) => t.decision === "watching");
  assert.equal(watching.length, 1, "回话不能把监视回合挤掉");
  assert.equal(state.botTurns.filter((t) => t.decision === "noted").length, 1);
});
