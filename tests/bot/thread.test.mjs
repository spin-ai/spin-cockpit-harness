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
  const bot = makeBot(b);
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
  const bot = makeBot(b);
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
  const bot = makeBot(b);
  st.state.botTurns.push({ id: "old", botId: bot.id, decision: "replied", input: "上次的问题", reply: "上次的回答", trigger: {}, createdAt: NOON - 5000 });
  b.migrateThreads({});
  await b.reply(bot, "然后呢", { onDelta: () => {} });
  const history = (captured.at(-1) || []).filter((m) => m.role !== "system");
  assert.equal(history[0].content, "上次的问题", "thread 里的旧用户消息要进历史");
  assert.equal(history[1].content, "上次的回答");
  assert.equal(history.at(-1).content, "然后呢");
});

// 多会话（照搬 ORCA 的 Chats）：一个 bot 可以有好几个话题

await test("新会话和默认会话分开：回复落在指定的那条 thread 里", async () => {
  const st = chatStore();
  const b = createBots({
    store: st, now: () => NOON,
    memory: () => ({ inject: () => ({ items: [], markdown: "" }), usage: () => ({ ratio: 0, chars: 0, budget: 2400, entries: 0, notes: 0, dropped: 0 }) }),
    chatStream: async () => ({ text: "收到", usage: {} }),
    key: () => "k",
  });
  const bot = makeBot(b);
  const def = b.threadOf(bot.id) || b.ensureBotThread(bot);
  const chat = b.newChat({ botId: bot.id });
  assert.notEqual(chat.id, def.id);
  assert.equal(b.chats(bot.id).length, 2, "列表里默认会话 + 新会话");
  await b.reply(bot, "这个话题里说", { threadId: chat.id, onDelta: () => {} });
  const inNew = st.state.messages.filter((m) => m.threadId === chat.id).map((m) => m.content);
  const inDef = st.state.messages.filter((m) => m.threadId === def.id).map((m) => m.content);
  assert.deepEqual(inNew, ["这个话题里说", "收到"]);
  assert.deepEqual(inDef, [], "新会话的消息不能漏进默认会话");
  const turn = st.state.botTurns.at(-1);
  assert.equal(turn.threadId, chat.id, "回合要记住自己属于哪条会话");
});

await test("新话题的第一句话成为标题（Chats 列表不出现一排“新话题”）", async () => {
  const st = chatStore();
  const b = createBots({
    store: st, now: () => NOON,
    memory: () => ({ inject: () => ({ items: [], markdown: "" }) }),
    chatStream: async () => ({ text: "好", usage: {} }),
    key: () => "k",
  });
  const bot = makeBot(b);
  const chat = b.newChat({ botId: bot.id });
  await b.reply(bot, "把登录页的文案改短一点", { threadId: chat.id, onDelta: () => {} });
  assert.match(st.state.threads.find((t) => t.id === chat.id).title, /登录页/);
});

await test("会话搜索：标题和消息正文都能命中", () => {
  const st = chatStore();
  const b = createBots({ store: st, now: () => NOON, memory: () => ({ inject: () => ({ items: [], markdown: "" }) }), key: () => "" });
  const bot = makeBot(b);
  const def = b.ensureBotThread(bot, { title: "默认会话" });
  st.addMessage(def.id, null, "agent", "text", "部署脚本在 scripts/install-renderer.mjs");
  const hit = b.searchChats({ botId: bot.id, query: "install-renderer" });
  assert.equal(hit.hits.length, 1);
  assert.equal(hit.chats[0].id, def.id);
  assert.match(hit.hits[0].snippet, /install-renderer/);
  assert.equal(b.searchChats({ botId: bot.id, query: "默认" }).chats.length, 1, "标题也搜");
  assert.equal(b.searchChats({ botId: bot.id, query: "不存在的词" }).chats.length, 0);
});

await test("删会话：默认会话不能删，其余连消息一起删", () => {
  const st = chatStore();
  const b = createBots({ store: st, now: () => NOON, memory: () => ({ inject: () => ({ items: [], markdown: "" }) }), key: () => "" });
  const bot = makeBot(b);
  const def = b.ensureBotThread(bot);
  const chat = b.newChat({ botId: bot.id });
  st.addMessage(chat.id, null, "user", "text", "临时话题");
  assert.throws(() => b.removeChat({ threadId: def.id }), /默认会话不能删/);
  b.removeChat({ threadId: chat.id });
  assert.equal(st.state.threads.filter((t) => t.kind === "bot").length, 1);
  assert.equal(st.state.messages.some((m) => m.threadId === chat.id), false);
});

// 分支（ORCA 的 fork）：复制到当前末尾，源会话不动

await test("分支：新会话拿到复制出来的消息，源会话一条不少", () => {
  const st = chatStore();
  const b = createBots({ store: st, now: () => NOON, memory: () => ({ inject: () => ({ items: [], markdown: "" }) }), key: () => "" });
  const bot = makeBot(b);
  const src = b.ensureBotThread(bot, { title: "原话题" });
  st.addMessage(src.id, null, "user", "text", "第一句");
  st.addMessage(src.id, null, "agent", "text", "回第一句");
  const forked = b.forkChat({ threadId: src.id });
  assert.equal(forked.copied, 2);
  assert.notEqual(forked.thread.id, src.id);
  assert.match(forked.thread.title, /分支/);
  assert.deepEqual(
    st.state.messages.filter((m) => m.threadId === forked.thread.id).map((m) => m.content),
    ["第一句", "回第一句"],
  );
  assert.equal(st.state.messages.filter((m) => m.threadId === src.id).length, 2, "源会话不能被改");
});

await test("空会话不能分支；谁能找它默认是 group", () => {
  const st = chatStore();
  const b = createBots({ store: st, now: () => NOON, memory: () => ({ inject: () => ({ items: [], markdown: "" }) }), key: () => "" });
  const bot = makeBot(b);
  const empty = b.ensureBotThread(bot);
  assert.throws(() => b.forkChat({ threadId: empty.id }), /还没有消息/);
  assert.equal(DEFAULT_POLICY.whoCanAsk, "group");
});
