import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOUR, MIN, NOON, at, bot, test } from "./_harness.mjs";
import { buildSystemPrompt, collectCandidates, createBots, gatesFor, quietActive, scoreCandidate, DEFAULT_POLICY } from "../../electron/bot/index.mjs";
import { parseSseDelta } from "../../electron/knowledge/ark.mjs";
import { createMemory } from "../../electron/memory/index.mjs";
import { hasSecret, redactSecrets } from "../../electron/redact.mjs";
import { similarity, suppressionReason } from "../../electron/bot/guard.mjs";
import { NOTIFY_MAX_CHARS, notifyDecision } from "../../electron/bot/notify.mjs";
import { WAIT_LIMIT_MS, describeRoutine, nextRunAt, normalizeRoutine, routineDue, todayAt } from "../../electron/bot/routine.mjs";

// 提问卡片：ASK 约定、答一句就结、先不管、过期

await test("创建后先问用途；用户第一句话成为职责", async () => {
  const introStore = { state: { bots: [], botTurns: [], routines: [], todos: [] }, persist() {} };
  const introBots = createBots({
    store: introStore,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [], markdown: "" }), usage: () => ({ ratio: 0, chars: 0, budget: 2400, entries: 0, notes: 0, dropped: 0 }) }),
    chatStream: async () => ({ text: "好，我记下了。", usage: {} }),
    key: () => "k",
  });
  introBots.ensureSeed();
  const b = introBots.list()[0];
  const first = (await introBots.tick({ botId: b.id })).at(-1);
  assert.equal(first.decision, "asked");
  assert.match(first.reply, /你想让我干什么/);
  await introBots.reply(b, "你负责每天整理待确认任务", { onDelta: () => {} });
  const after = introBots.list()[0];
  assert.match(after.persona.mission, /整理待确认任务/);
  const prompt = buildSystemPrompt(after, "", { proactive: false });
  assert.match(prompt, /你的职责/);
});

function askBots(chatReply) {
  const st = { state: { bots: [], botTurns: [], routines: [], todos: [] }, persist() {} };
  const b = createBots({
    store: st,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [], markdown: "" }), usage: () => ({ ratio: 0, chars: 0, budget: 2400, entries: 0, notes: 0, dropped: 0 }) }),
    chat: async () => ({ text: chatReply, usage: { totalTokens: 7 } }),
    chatStream: async () => ({ text: "好", usage: {} }),
    key: () => "k",
  });
  b.ensureSeed();
  const bot = b.list()[0];
  bot.intro = false;
  st.state.todos.push({ id: "t1", title: "待输入任务", status: "waiting_input", confirmed: true });
  return { st, b, bot };
}

await test("模型输出 ASK: → 落一张可作答的卡片（不是普通回话）", async () => {
  const { b, bot } = askBots("ASK: 你想先看哪一个？");
  const turn = (await b.tick({ botId: bot.id })).at(-1);
  assert.equal(turn.decision, "asked");
  assert.equal(turn.ask.status, "open");
  assert.equal(turn.ask.text, "你想先看哪一个？");
  const open = b.openAsks(bot.id);
  assert.equal(open.length, 1);
  assert.equal(open[0].turnId, turn.id);
});

await test("人回一句话：卡片自动结掉，答案记下来", async () => {
  const { b, bot } = askBots("ASK: 先做哪个？");
  const asked = (await b.tick({ botId: bot.id })).at(-1);
  assert.equal(b.openAsks(bot.id).length, 1);
  await b.reply(bot, "先做失败那条", { onDelta: () => {} });
  const row = b.turns().find((t) => t.id === asked.id);
  assert.equal(row.ask.status, "answered");
  assert.equal(row.ask.answer, "先做失败那条");
  assert.equal(b.openAsks(bot.id).length, 0, "答过的不再挂在输入框上方");
});

await test("先不管：划掉卡片但不影响聊天", async () => {
  const { b, bot } = askBots("ASK: 要不要我盯着？");
  const asked = (await b.tick({ botId: bot.id })).at(-1);
  const changed = b.settleAsks("", { status: "dismissed", turnId: asked.id });
  assert.equal(changed, 1);
  assert.equal(b.turns().find((t) => t.id === asked.id).ask.status, "dismissed");
  assert.equal(b.openAsks(bot.id).length, 0);
});

await test("卡片 7 天后自动过期（懒标记），不会再挂在界面上", () => {
  const st = { state: { bots: [], botTurns: [], routines: [], todos: [] }, persist() {} };
  const b = createBots({ store: st, now: () => NOON, memory: () => ({ inject: () => ({ items: [], markdown: "" }) }), key: () => "" });
  b.ensureSeed();
  const bot = b.list()[0];
  st.state.botTurns.push({
    id: "ask-old", botId: bot.id, decision: "asked", reply: "旧的提问",
    ask: { text: "旧的提问", status: "open", options: [], createdAt: NOON - 8 * 24 * 3600_000 },
    trigger: {}, createdAt: NOON - 8 * 24 * 3600_000,
  });
  assert.equal(b.openAsks(bot.id).length, 0);
  assert.equal(st.state.botTurns.find((t) => t.id === "ask-old").ask.status, "expired");
});

await test("创建时的提问也是一张卡片（同一套状态机）", async () => {
  const st = { state: { bots: [], botTurns: [], routines: [], todos: [] }, persist() {} };
  const b = createBots({ store: st, now: () => NOON, memory: () => ({ inject: () => ({ items: [], markdown: "" }) }), chatStream: async () => ({ text: "好" }), key: () => "k" });
  b.ensureSeed();
  const bot = b.list()[0];
  const first = (await b.tick({ botId: bot.id })).at(-1);
  assert.equal(first.decision, "asked");
  assert.equal(first.ask.status, "open");
  assert.equal(b.openAsks(bot.id).length, 1);
});
