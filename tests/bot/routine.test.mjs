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

// 日程：判定、真的开口、落点（alongside / in-chat）

await test("日程：每天到点 / 未到点 / 今天已跑；间隔；变化才跑先建基线", () => {
  const noon = at(12).getTime();
  const daily = normalizeRoutine({ kind: "daily", atHour: 9, name: "早报" });
  assert.equal(routineDue(daily, { now: noon }).due, true);
  assert.equal(routineDue(daily, { now: at(8, 30).getTime() }).due, false);
  assert.equal(routineDue({ ...daily, lastFiredAt: todayAt(9, noon) + 1 }, { now: noon }).due, false);

  const every = normalizeRoutine({ kind: "every", everyMs: 30 * 60 * 1000, lastFiredAt: noon - 10 * 60 * 1000 });
  assert.equal(routineDue(every, { now: noon }).due, false);
  assert.equal(routineDue({ ...every, lastFiredAt: noon - 40 * 60 * 1000 }, { now: noon }).due, true);

  const watch = normalizeRoutine({ kind: "watch", watch: { kind: "file", path: "/tmp/x" } });
  const first = routineDue(watch, { now: noon, probe: () => ({ hash: "h1" }) });
  assert.equal(first.due, false);
  assert.equal(first.baseline, true, "第一次只建基线，不该立刻跑");
  const same = routineDue({ ...watch, lastHash: "h1" }, { now: noon, probe: () => ({ hash: "h1" }) });
  assert.equal(same.due, false);
  const changed = routineDue({ ...watch, lastHash: "h1" }, { now: noon, probe: () => ({ hash: "h2" }) });
  assert.equal(changed.due, true);
  assert.equal(describeRoutine(daily), "每天 09:00");
  assert.ok(nextRunAt({ ...daily, atHour: 20 }, noon) > noon);
});

await test("日程真的会替 bot 开口，并记账 lastFiredAt", async () => {
  const rtStore = { state: { bots: [], botTurns: [], routines: [], todos: [] }, persist() {} };
  const rtBots = createBots({
    store: rtStore,
    now: () => at(12).getTime(),
    memory: () => ({ inject: () => ({ items: [], markdown: "" }), usage: () => ({ ratio: 0, chars: 0, budget: 2400, entries: 0, notes: 0, dropped: 0 }) }),
    chat: async () => ({ text: "今天有两项待确认。", usage: { totalTokens: 11 } }),
    probeWatch: () => ({ hash: "h1" }),
    key: () => "k",
  });
  rtBots.ensureSeed();
  const b = rtBots.list()[0];
  b.intro = false;
  rtBots.saveRoutine({ botId: b.id, kind: "daily", atHour: 9, name: "早报" });
  const turns = await rtBots.tick({ botId: b.id });
  const turn = turns.at(-1);
  assert.equal(turn.trigger.kind, "routine");
  assert.match(turn.reply, /待确认|早报/);
  assert.ok(rtStore.state.routines[0].lastFiredAt > 0, "跑过要记账，否则同一小时内会重复跑");
  const again = rtBots.routineStatus(b.id)[0];
  assert.equal(again.due, false);
});

await test("once：到点跑一次，跑过就不再跑；prompt 跟着日程走", () => {
  const now = at(12).getTime();
  const once = normalizeRoutine({ kind: "once", onceAt: now + HOUR, name: "提醒", prompt: "提醒我打电话" });
  assert.equal(once.prompt, "提醒我打电话");
  assert.equal(routineDue(once, { now }).due, false);
  assert.equal(routineDue(once, { now: now + HOUR }).due, true);
  assert.equal(routineDue({ ...once, lastFiredAt: now + HOUR + 1 }, { now: now + HOUR + 2 }).due, false);
  assert.match(describeRoutine(once), /^一次 · /);
  assert.equal(nextRunAt({ ...once, lastFiredAt: now + HOUR + 1 }), null);
});

await test("日程到点把 prompt 交给模型，而不是只念名字", async () => {
  let seen = "";
  const st = { state: { bots: [], botTurns: [], routines: [], todos: [] }, persist() {} };
  const b = createBots({
    store: st,
    now: () => at(12).getTime(),
    memory: () => ({ inject: () => ({ items: [], markdown: "" }), usage: () => ({ ratio: 0, chars: 0, budget: 8000, entries: 0, notes: 0, dropped: 0 }) }),
    chat: async (messages) => { seen = messages.at(-1).content; return { text: "早报：两项待确认。" }; },
    key: () => "k",
  });
  b.ensureSeed();
  const bot = b.list()[0];
  bot.intro = false;
  b.saveRoutine({ botId: bot.id, kind: "daily", atHour: 9, name: "早报", prompt: "汇总今天的待确认任务" });
  await b.tick({ botId: bot.id });
  assert.match(seen, /这次要做的：汇总今天的待确认任务/);
});

function routineBots(extra = {}) {
  const st = { state: { bots: [], botTurns: [], routines: [], todos: [] }, persist() {}, ...extra };
  const b = createBots({
    store: st,
    now: () => at(12).getTime(),
    memory: () => ({ inject: () => ({ items: [], markdown: "" }), usage: () => ({ ratio: 0, chars: 0, budget: 2400, entries: 0, notes: 0, dropped: 0 }) }),
    chat: async () => ({ text: "到点了，汇报一下。", usage: { totalTokens: 5 } }),
    chatStream: async () => ({ text: "嗯", usage: {} }),
    key: () => "k",
  });
  b.ensureSeed();
  const bot = b.list()[0];
  bot.intro = false;
  return { st, b, bot };
}

await test("alongside：到点就跑，不等上一轮", async () => {
  const { st, b, bot } = routineBots();
  // 刚说过话（10 秒前）
  st.state.botTurns.push({ id: "x", botId: bot.id, decision: "answered", reply: "刚说完", trigger: {}, createdAt: at(12).getTime() - 10_000 });
  b.saveRoutine({ botId: bot.id, kind: "daily", atHour: 9, name: "早报", mode: "alongside" });
  const turns = await b.tick({ botId: bot.id });
  assert.equal(turns.at(-1).trigger.kind, "routine", "alongside 不该等");
});

await test("in-chat：忙的时候先等，等满 5 分钟就并进去", async () => {
  const { st, b, bot } = routineBots();
  st.state.botTurns.push({ id: "x", botId: bot.id, decision: "answered", reply: "刚说完", trigger: {}, createdAt: at(12).getTime() - 10_000 });
  const rt = b.saveRoutine({ botId: bot.id, kind: "daily", atHour: 9, name: "跟进", mode: "in-chat" });
  const first = await b.tick({ botId: bot.id });
  assert.equal(first.length, 0, "忙的时候这一轮不该开口");
  assert.ok(st.state.routines.find((r) => r.id === rt.id).waitingSince > 0, "要记下开始等的时间");

  // 把"开始等"的时间往前拨到 5 分钟以前：应该让给它
  st.state.routines.find((r) => r.id === rt.id).waitingSince = at(12).getTime() - WAIT_LIMIT_MS - 1000;
  const second = await b.tick({ botId: bot.id });
  assert.equal(second.at(-1)?.trigger.kind, "routine", "等满 5 分钟就该并进去");
});

await test("in-chat：空着就立刻跑，不用等", async () => {
  const { b, bot } = routineBots();
  b.saveRoutine({ botId: bot.id, kind: "daily", atHour: 9, name: "跟进", mode: "in-chat" });
  const turns = await b.tick({ botId: bot.id });
  assert.equal(turns.at(-1).trigger.kind, "routine");
});
