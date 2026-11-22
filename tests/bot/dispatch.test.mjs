import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOUR, MIN, NOON, at, bot, makeBot, test } from "./_harness.mjs";
import { buildSystemPrompt, collectCandidates, createBots, gatesFor, quietActive, scoreCandidate, DEFAULT_POLICY } from "../../electron/bot/index.mjs";
import { parseSseDelta } from "../../electron/knowledge/ark.mjs";
import { createMemory } from "../../electron/memory/index.mjs";
import { hasSecret, redactSecrets } from "../../electron/redact.mjs";
import { similarity, suppressionReason } from "../../electron/bot/guard.mjs";
import { NOTIFY_MAX_CHARS, notifyDecision } from "../../electron/bot/notify.mjs";
import { WAIT_LIMIT_MS, describeRoutine, nextRunAt, normalizeRoutine, routineDue, todayAt } from "../../electron/bot/routine.mjs";

// 能力档位：dispatch 只产 proposal，不动 todos

const dispatchStore = {
  state: { bots: [], botTurns: [], todos: [{ id: "t1", title: "补完核对项", status: "waiting_input", confirmed: true, key: "#3001" }] },
  persist() {},
};

const dispatchBots = createBots({
  store: dispatchStore,
  now: () => NOON,
  memory: () => ({ inject: () => ({ items: [] }) }),
  chat: async () => ({ text: "我理解的是补完两个核对项，要现在开吗？", usage: { totalTokens: 88 } }),
  key: () => "k",
});
// 测试里跳过「先问用途」那一轮（真实流程见文末 intro 用例）
const seededDispatch = makeBot(dispatchBots, { name: "测试主管" });

await test("dispatch 档位：主动开口时产出 proposal，但不动 todos", async () => {
  dispatchBots.save({ id: seededDispatch.id, capability: "dispatch" });
  const before = dispatchStore.state.todos.length;
  const turns = await dispatchBots.tick({ botId: seededDispatch.id });
  const turn = turns.at(-1);
  assert.equal(turn.decision, "answered");
  assert.ok(turn.proposal, "应有建议");
  assert.match(turn.proposal.title, /补完核对项/);
  assert.equal(dispatchStore.state.todos.length, before, "bot 不能自己建 todo");
});

await test("read 档位：同样的开口不带 proposal", async () => {
  const readBotsState = JSON.parse(JSON.stringify(dispatchStore.state.bots)).map((b) => ({ ...b, capability: "read" }));
  const readStore = { state: { bots: readBotsState, botTurns: [], todos: dispatchStore.state.todos.slice() }, persist() {} };
  const readBots = createBots({ store: readStore, now: () => NOON, memory: () => ({ inject: () => ({ items: [] }) }), chat: async () => ({ text: "这件事还等你确认。", usage: {} }), key: () => "k" });
  readBots.ensureSeed();
  const readBot = makeBot(readBots);
  const turns = await readBots.tick({ botId: readBot.id });
  assert.equal(turns.at(-1).proposal, null);
});
