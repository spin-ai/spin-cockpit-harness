/**
 * 内置演示 bot 下线：
 *  - 新装不预置任何 bot（机器人页从空态开始）；
 *  - 老库里残留的四个种子 id 一次性清掉，连同它们的回合 / 日程 / 改动历史 / 会话；
 *  - 人自己建的 bot 和它的数据一条都不能少；
 *  - 新建空白 bot 带 intro（第一轮先问用途），模板带职责的不再问。
 */

import assert from "node:assert/strict";
import { NOON, test } from "./_harness.mjs";
import { createBots, LEGACY_SEED_BOT_IDS } from "../../electron/bot/index.mjs";

const makeBots = (state) => {
  const store = { state, persist() {} };
  const bots = createBots({ store, now: () => NOON, memory: () => ({ inject: () => ({ items: [] }) }), key: () => "k" });
  return { store, bots };
};

await test("新装不再预置机器人：ensureSeed() 之后仍然是空的", () => {
  const { store, bots } = makeBots({ bots: [], botTurns: [], routines: [] });
  assert.equal(bots.ensureSeed(), false);
  assert.equal(store.state.bots.length, 0);
  assert.deepEqual(LEGACY_SEED_BOT_IDS, ["bot-xiaoz", "bot-xiaoa", "bot-xiaob", "bot-xiaoc"]);
});

await test("老库清理：四个种子 bot 连数据一起删，人建的 bot 原样留下", () => {
  const keep = makeBotRecord("bot-mine");
  const state = {
    bots: [makeBotRecord("bot-xiaoz"), makeBotRecord("bot-xiaoa"), makeBotRecord("bot-xiaob"), makeBotRecord("bot-xiaoc"), keep],
    botTurns: [
      { id: "t1", botId: "bot-xiaoz", decision: "replied", createdAt: NOON - 1000 },
      { id: "t2", botId: "bot-mine", decision: "replied", createdAt: NOON - 1000 },
    ],
    routines: [{ id: "rt1", botId: "bot-xiaoa", kind: "daily", atHour: 9 }],
    botRevisions: [{ id: "rv1", botId: "bot-xiaoz", at: NOON, data: {} }, { id: "rv2", botId: "bot-mine", at: NOON, data: {} }],
    botEvents: [{ id: "e1", botId: "bot-xiaoc", key: "ci:1", at: NOON }],
    threads: [
      { id: "th-bot-xiaoz", kind: "bot", botId: "bot-xiaoz", createdAt: NOON },
      { id: "th-mine", kind: "bot", botId: "bot-mine", createdAt: NOON },
    ],
    messages: [
      { id: "m1", threadId: "th-bot-xiaoz", role: "agent", content: "旧对话", createdAt: NOON },
      { id: "m2", threadId: "th-mine", role: "agent", content: "我的对话", createdAt: NOON },
    ],
    botGroups: [
      { id: "g1", name: "项目群", memberIds: ["bot-xiaoz", "bot-mine"] },
      { id: "g2", name: "只剩种子", memberIds: ["bot-xiaoa"] },
    ],
    botGroupMessages: [
      { id: "gm1", groupId: "g1", author: "bot", botId: "bot-xiaoz", text: "种子说的话", createdAt: NOON },
      { id: "gm2", groupId: "g1", author: "bot", botId: "bot-mine", text: "我的人说的话", createdAt: NOON },
      { id: "gm3", groupId: "g2", author: "bot", botId: "bot-xiaoa", text: "空群里的话", createdAt: NOON },
    ],
    botUi: {
      "bot-xiaoz:default": { draft: "x" },
      "bot-mine:th-mine": { draft: "y" },
      "group:g2": { draft: "z" },
      "group:g2:gth2": { draft: "话题草稿" },
    },
  };
  const { store, bots } = makeBots(state);

  assert.equal(bots.ensureSeed(), true);
  assert.deepEqual(store.state.bots.map((b) => b.id), ["bot-mine"]);
  assert.deepEqual(store.state.botTurns.map((t) => t.id), ["t2"]);
  assert.equal(store.state.routines.length, 0);
  assert.deepEqual(store.state.botRevisions.map((r) => r.id), ["rv2"]);
  assert.equal(store.state.botEvents.length, 0);
  assert.deepEqual(store.state.threads.map((t) => t.id), ["th-mine"]);
  assert.deepEqual(store.state.messages.map((m) => m.id), ["m2"]);
  assert.deepEqual(store.state.botGroups.map((g) => g.id), ["g1"], "只剩种子成员的群聊要删掉");
  assert.deepEqual(store.state.botGroups[0].memberIds, ["bot-mine"]);
  assert.deepEqual(store.state.botGroupMessages.map((m) => m.id), ["gm2"]);
  assert.equal(store.state.botUi["bot-xiaoz:default"], undefined);
  assert.equal(store.state.botUi["group:g2"], undefined, "删掉的群聊的草稿也跟着走");
  assert.equal(store.state.botUi["group:g2:gth2"], undefined, "群内话题的草稿也要跟着走");
  assert.ok(store.state.botUi["bot-mine:th-mine"], "别的 bot 的草稿不能跟着删");

  // 幂等：再跑一次什么都不用做
  assert.equal(bots.ensureSeed(), false);
});

await test("新建空白 bot 先问用途；模板带职责的不问", () => {
  const { bots } = makeBots({ bots: [], botTurns: [], routines: [] });
  const blank = bots.save({ id: "bot-blank", name: "空白" });
  assert.equal(blank.intro, true);
  const fromTemplate = bots.save({ id: "bot-tpl", name: "早报", persona: { mission: "每天按时汇总" } });
  assert.equal(fromTemplate.intro, false);
});

function makeBotRecord(id) {
  return {
    id, name: id, avatar: "B", avatarClass: "a", role: "worker", capability: "read",
    persona: {}, channels: ["local"], policy: {}, budget: {},
    status: "active", mutedUntil: 0, executorAgentId: null, skills: [],
    projectId: null, hostId: null, team: "", plan: null, createdAt: NOON, updatedAt: NOON,
  };
}
