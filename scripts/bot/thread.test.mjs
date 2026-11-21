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

// 持续 chat：镜像进 thread、迁移幂等、历史来源

function chatStore() {
  let seq = 0;
  const store = {
    state: { bots: [], botTurns: [], routines: [], todos: [], threads: [], messages: [] },
    persist() {},
    addMessage(threadId, runId, role, kind, content) {
      const thread = store.state.threads.find((t) => t.id === threadId);
      const msg = { id: `m${++seq}`, threadId, todoId: thread?.todoId ?? null, runId, role, kind, content, createdAt: Date.now() };
      store.state.messages.push(msg);
      if (thread) thread.updatedAt = Date.now();
      return msg;
    },
  };
  return store;
}

await test("说话的部分进 thread，沉默/被拦只留审计", async () => {
  const st = chatStore();
  const b = createBots({
    store: st, now: () => NOON,
    memory: () => ({ inject: () => ({ items: [], markdown: "" }), usage: () => ({ ratio: 0, chars: 0, budget: 2400, entries: 0, notes: 0, dropped: 0 }) }),
    chatStream: async () => ({ text: "好的", usage: {} }),
    key: () => "k",
  });
  b.ensureSeed();
  const bot = b.list()[0];
  bot.intro = false;
  await b.reply(bot, "在吗", { onDelta: () => {} });
  const thread = st.state.threads.find((t) => t.kind === "bot" && t.botId === bot.id);
  assert.ok(thread, "应该有一条 bot thread");
  const msgs = st.state.messages.filter((m) => m.threadId === thread.id);
  assert.deepEqual(msgs.map((m) => m.role), ["user", "agent"]);
  assert.equal(msgs[0].content, "在吗");
  assert.equal(msgs[1].content, "好的");
});

await test("迁移幂等：dryRun 只数数，真跑一次就够，再跑是 0", () => {
  const st = chatStore();
  const b = createBots({ store: st, now: () => NOON, memory: () => ({ inject: () => ({ items: [], markdown: "" }) }), key: () => "" });
  b.ensureSeed();
  const bot = b.list()[0];
  // 造三条老回合：两条该迁，一条沉默不该迁
  st.state.botTurns.push(
    { id: "t1", botId: bot.id, decision: "replied", input: "旧问题", reply: "旧回答", trigger: {}, createdAt: NOON - 3000 },
    { id: "t2", botId: bot.id, decision: "answered", input: "", reply: "主动说过的", trigger: { ref: "todo:1" }, createdAt: NOON - 2000 },
    { id: "t3", botId: bot.id, decision: "silent", input: "", reply: "", reason: "没话说", trigger: {}, createdAt: NOON - 1000 },
  );

  const dry = b.migrateThreads({ dryRun: true });
  assert.equal(dry.turns, 2);
  assert.equal(dry.messages, 3, "一条 replied = 2 条消息，一条 answered = 1 条");
  assert.equal(st.state.messages.length, 0, "dryRun 不能写");

  const real = b.migrateThreads({});
  assert.equal(real.turns, 2);
  assert.equal(st.state.messages.length, 3);
  assert.equal(st.state.messages[0].content, "旧问题", "按时间顺序搬");
  assert.equal(st.state.messages[2].content, "主动说过的");

  const again = b.migrateThreads({});
  assert.equal(again.turns, 0, "第二次没有可迁的（幂等）");
  assert.equal(st.state.messages.length, 3);
});

await test("续聊时历史来自 thread：迁移过的旧对话会被带上", async () => {
  const st = chatStore();
  const captured = [];
  const b = createBots({
    store: st, now: () => NOON,
    memory: () => ({ inject: () => ({ items: [], markdown: "" }), usage: () => ({ ratio: 0, chars: 0, budget: 2400, entries: 0, notes: 0, dropped: 0 }) }),
    chatStream: async (messages) => { captured.push(messages); return { text: "接着说", usage: {} }; },
    key: () => "k",
  });
  b.ensureSeed();
  const bot = b.list()[0];
  bot.intro = false;
  st.state.botTurns.push({ id: "old", botId: bot.id, decision: "replied", input: "上次的问题", reply: "上次的回答", trigger: {}, createdAt: NOON - 5000 });
  b.migrateThreads({});
  await b.reply(bot, "然后呢", { onDelta: () => {} });
  const history = (captured.at(-1) || []).filter((m) => m.role !== "system");
  assert.equal(history[0].content, "上次的问题", "thread 里的旧用户消息要进历史");
  assert.equal(history[1].content, "上次的回答");
  assert.equal(history.at(-1).content, "然后呢");
});
