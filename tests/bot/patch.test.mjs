/**
 * 作用域增量（P0-4）的不变量：
 *
 * 1. 一包 patch 只带这个 bot 的切片（回合尾部 / 群消息尾部 / 会话摘要 / items 计数）；
 * 2. patch 体积 < 全量 state 的 5%（REQ-bot-chat SR-Chat-12 的判据）；
 * 3. 同一 500ms 窗口的两次写合并成一包，kinds 取并集、回合不重复；
 * 4. 渲染层按 id 合并：新旧回合各就各位、排序稳定、群消息不乱序。
 */
import assert from "node:assert/strict";
import { NOON, test } from "./_harness.mjs";
import { BOT_PATCH_TURNS, applyBotPatch, buildBotPatch, mergeBotPatch, trimTurn } from "../../electron/bot/patch.mjs";

const turn = (botId, i, extra = {}) => ({
  id: `bt${botId}-${i}`, botId, decision: i % 7 === 0 ? "quiet" : "answered",
  trigger: { kind: "routine", ref: `routine:r${i}` },
  input: `第 ${i} 轮的输入（用来模拟真实回合）`, reply: `第 ${i} 轮说的话，长度接近真实回复。`.repeat(3),
  reason: "", threadId: "th1", cost: { tokens: 900, ms: 1200 },
  createdAt: NOON + i * 1000,
  trace: Array.from({ length: 8 }, (_, k) => ({ kind: "tool", name: "workspace_read", argsRaw: '{"path":"src/a.ts"}', result: "x".repeat(400), at: NOON + k })),
  ...extra,
});

/** 一份「长会话 + 多 bot + 多项目」的全量 state，用来量 patch 占比 */
const fullState = () => ({
  projects: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `项目 ${i}`, path: `/tmp/p${i}` })),
  agents: Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, name: `执行体 ${i}`, alias: `DE-${i}` })),
  bots: Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, name: `机器人 ${i}`, persona: { mission: "负责发布" } })),
  todos: Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, key: `T-${i}`, title: `任务 ${i}`, status: "todo", desc: "背景".repeat(30) })),
  runs: Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, todoId: `t${i}`, status: "done", result: "产出".repeat(40) })),
  threads: Array.from({ length: 200 }, (_, i) => ({ id: `th${i}`, title: `会话 ${i}`, kind: "chat" })),
  messages: Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}`, threadId: `th${i % 200}`, role: "agent", content: "消息正文".repeat(20), createdAt: NOON + i })),
  botTurns: Array.from({ length: 300 }, (_, i) => turn(`b${i % 10}`, i)),
  botGroupMessages: Array.from({ length: 400 }, (_, i) => ({ id: `gm${i}`, groupId: "g1", seq: i, author: "bot", botId: `b${i % 10}`, botName: "机器人", text: "群里说的".repeat(8), createdAt: NOON + i })),
  events: Array.from({ length: 300 }, (_, i) => ({ id: `e${i}`, ts: NOON + i, type: "run.done", text: "事件".repeat(20) })),
});

await test("patch 体积：一回合增量 < 全量的 5%", () => {
  const state = fullState();
  const mine = state.botTurns.filter((t) => t.botId === "b1");
  const patch = buildBotPatch({
    botId: "b1", kinds: ["turns", "chats"], turns: mine,
    chats: [{ id: "th1", title: "查 CI", createdAt: NOON, updatedAt: NOON + 5000, count: 18, last: "查到 flaky 的 e2e", lastAt: NOON + 5000 }],
    at: NOON + 6000,
  });
  assert.ok(patch.botTurns.length <= BOT_PATCH_TURNS);
  const fullSize = JSON.stringify(state).length;
  const patchSize = JSON.stringify(patch).length;
  assert.ok(patchSize < fullSize * 0.05, `patch ${patchSize} 应 < 全量 ${fullSize} 的 5%（${Math.round(fullSize * 0.05)}）`);
  // 切片里不该塞整份 trace：一包几十 KB 就说明「增量」白做了
  assert.ok(patchSize < 24_000, `patch 实际 ${patchSize} 字节，过大`);
});

await test("patch 切片：只带点了的 kind，别的字段不出现", () => {
  const turnsPatch = buildBotPatch({ botId: "b1", kinds: ["turns"], turns: [turn("b1", 1)] });
  assert.ok(Array.isArray(turnsPatch.botTurns));
  assert.equal(turnsPatch.botGroupMessages, undefined);
  assert.equal(turnsPatch.botChats, undefined);
  assert.deepEqual(turnsPatch.botChanged.kinds, ["turns"]);
  const itemsPatch = buildBotPatch({ botId: "b1", kinds: ["items"], counts: { open: 3, needsYou: 1 } });
  assert.deepEqual(itemsPatch.itemCounts, { open: 3, needsYou: 1 });
  assert.equal(buildBotPatch({ botId: "", kinds: ["turns"] }), null);
});

await test("500ms 合并：两次写并成一包，回合不重复、kinds 取并集", () => {
  const a = buildBotPatch({ botId: "b1", kinds: ["turns"], turns: [turn("b1", 1)], at: NOON });
  const b = buildBotPatch({ botId: "b1", kinds: ["chats"], turns: [turn("b1", 2)], chats: [{ id: "th1", title: "x", createdAt: 1, updatedAt: 2, count: 1, last: "", lastAt: 2 }], at: NOON + 100 });
  const merged = mergeBotPatch(a, b);
  assert.deepEqual(merged.kinds.sort(), ["chats", "turns"]);
  assert.deepEqual(merged.botTurns.map((t) => t.id), ["btb1-1", "btb1-2"]);
  assert.equal(merged.botChats[0].title, "x");
  assert.equal(merged.at, NOON + 100);
  // 同一 id 的新版本覆盖旧的（不出现两条同 id 的回合）
  const again = mergeBotPatch(merged, buildBotPatch({ botId: "b1", kinds: ["turns"], turns: [turn("b1", 2, { reply: "改了" })] }));
  assert.equal(again.botTurns.filter((t) => t.id === "btb1-2").length, 1);
  assert.equal(again.botTurns.find((t) => t.id === "btb1-2").reply, "改了");
});

await test("渲染层应用：新旧回合按时间并好、群消息按 seq 不乱序、计数与 botChanged 落地", () => {
  const state = {
    botTurns: [turn("b1", 1), turn("b1", 2)],
    botGroupMessages: [
      { id: "gm1", groupId: "g1", seq: 1, text: "一" },
      { id: "gm3", groupId: "g1", seq: 3, text: "三" },
    ],
    itemCounts: { b1: { open: 1, needsYou: 0 } },
  };
  const patch = buildBotPatch({
    botId: "b1", kinds: ["turns", "groups", "items", "chats"],
    turns: [turn("b1", 3), turn("b1", 2, { reply: "第二轮被更新" })],
    groupMessages: [
      { id: "gm2", groupId: "g1", seq: 2, text: "二" },
      { id: "gm3", groupId: "g1", seq: 3, text: "三" },
    ],
    chats: [{ id: "th1", title: "新会话", createdAt: 1, updatedAt: 2, count: 1, last: "", lastAt: 2 }],
    counts: { open: 2, needsYou: 1 },
    at: NOON + 9000,
  });
  const next = applyBotPatch(state, patch);
  assert.equal(next.botTurns.length, 3);
  assert.deepEqual(next.botTurns.map((t) => t.id), ["btb1-1", "btb1-2", "btb1-3"]);
  assert.equal(next.botTurns.find((t) => t.id === "btb1-2").reply, "第二轮被更新");
  assert.deepEqual(next.botGroupMessages.map((m) => m.seq), [1, 2, 3]);
  assert.deepEqual(next.itemCounts.b1, { open: 2, needsYou: 1 });
  assert.equal(next.botChats.b1[0].title, "新会话");
  assert.equal(next.botChanged.botId, "b1");
  assert.equal(next.botChanged.at, NOON + 9000);
  // 别的切片原样保留（不因为一次 patch 丢东西）
  assert.equal(state.botTurns.length, 2, "不改原对象");
});

await test("trimTurn：大字段收口，渲染需要的都在", () => {
  const trimmed = trimTurn(turn("b1", 5));
  assert.equal(trimmed.id, "btb1-5");
  assert.equal(trimmed.decision, "answered");
  assert.ok(trimmed.reply.length <= 2000);
  assert.equal(trimmed.tools.length, 0, "没工具的回合就是空数组");
  assert.equal(trimmed.trace, undefined, "整份 trace 不进 patch");
  assert.equal(trimTurn(null), null);
});
