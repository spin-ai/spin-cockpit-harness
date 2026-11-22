/**
 * 机器人生命周期：删除要删干净、6 秒内能撤销；会话要能清空（默认会话也能）。
 * 这些是用户能直接踩到的路径，删一半比不删更糟。
 */

import assert from "node:assert/strict";
import { NOON, test } from "./_harness.mjs";
import { createBots } from "../../electron/bot/index.mjs";

const botRecord = (id, name) => ({
  id, name, avatar: "B", avatarClass: "a", role: "worker", capability: "work",
  persona: { mission: `${name} 的职责` }, channels: ["local"], policy: {}, budget: {},
  status: "active", mutedUntil: 0, executorAgentId: null, skills: [],
  projectId: null, hostId: null, team: "", plan: null, createdAt: NOON, updatedAt: NOON,
});

const makeBots = (state) => {
  const store = { state, persist() {} };
  const bots = createBots({ store, now: () => NOON, memory: () => ({ inject: () => ({ items: [] }) }), key: () => "k" });
  return { store, bots };
};

await test("删机器人：会话 / 消息 / 日程 / 群成员 / 草稿一起清，撤销能放回去", () => {
  const state = {
    bots: [botRecord("bot-a", "A"), botRecord("bot-b", "B")],
    botTurns: [{ id: "t1", botId: "bot-a", decision: "replied", createdAt: NOON }],
    routines: [{ id: "rt1", botId: "bot-a", kind: "daily", atHour: 9 }],
    botRevisions: [{ id: "rv1", botId: "bot-a", at: NOON, data: {} }],
    botEvents: [{ id: "ev1", botId: "bot-a", key: "ci:1", at: NOON }],
    threads: [
      { id: "th-a", kind: "bot", botId: "bot-a", title: "A", createdAt: NOON },
      { id: "th-b", kind: "bot", botId: "bot-b", title: "B", createdAt: NOON },
    ],
    messages: [
      { id: "m1", threadId: "th-a", role: "user", content: "A 的话", createdAt: NOON },
      { id: "m2", threadId: "th-b", role: "user", content: "B 的话", createdAt: NOON },
    ],
    botGroups: [{ id: "g1", name: "项目群", memberIds: ["bot-a", "bot-b"] }],
    botGroupMessages: [
      { id: "gm1", groupId: "g1", author: "bot", botId: "bot-a", text: "A 说的", createdAt: NOON },
      { id: "gm2", groupId: "g1", author: "bot", botId: "bot-b", text: "B 说的", createdAt: NOON },
    ],
    botUi: { "bot-a:th-a": { draft: "x" }, "bot-b:th-b": { draft: "y" } },
    todoLinks: [], delegations: [],
  };
  const { store, bots } = makeBots(state);

  const res = bots.remove("bot-a");
  assert.equal(res.ok, true);
  assert.deepEqual(store.state.bots.map((b) => b.id), ["bot-b"]);
  assert.equal(store.state.botTurns.length, 0);
  assert.equal(store.state.routines.length, 0);
  assert.equal(store.state.botRevisions.length, 0);
  assert.equal(store.state.botEvents.length, 0);
  assert.deepEqual(store.state.threads.map((t) => t.id), ["th-b"]);
  assert.deepEqual(store.state.messages.map((m) => m.id), ["m2"]);
  assert.deepEqual(store.state.botGroups[0].memberIds, ["bot-b"]);
  assert.deepEqual(store.state.botGroupMessages.map((m) => m.id), ["gm2"]);
  assert.equal(store.state.botUi["bot-a:th-a"], undefined);
  assert.ok(store.state.botUi["bot-b:th-b"]);

  const undo = bots.undoRemove();
  assert.equal(undo.ok, true);
  assert.deepEqual(store.state.bots.map((b) => b.id).sort(), ["bot-a", "bot-b"]);
  assert.equal(store.state.botTurns.length, 1);
  assert.deepEqual(store.state.threads.map((t) => t.id).sort(), ["th-a", "th-b"]);
  assert.equal(store.state.messages.length, 2);
  assert.deepEqual(store.state.botGroups[0].memberIds.sort(), ["bot-a", "bot-b"]);
  assert.ok(store.state.botUi["bot-a:th-a"], "撤销要连草稿一起还回来");
  assert.equal(bots.undoRemove().ok, false, "只能撤销一次");
});

await test("删到群里没人：空群跟着删；撤销连群和群消息一起还回来", () => {
  const state = {
    bots: [botRecord("bot-a", "A")],
    botTurns: [], routines: [], botRevisions: [], botEvents: [],
    threads: [{ id: "th-a", kind: "bot", botId: "bot-a", createdAt: NOON }],
    messages: [], botGroupMessages: [{ id: "gm1", groupId: "g1", author: "bot", botId: "bot-a", text: "x", createdAt: NOON }],
    botGroups: [{ id: "g1", name: "只剩 A", memberIds: ["bot-a"] }],
    botUi: { "group:g1": { draft: "群草稿" } },
    todoLinks: [], delegations: [],
  };
  const { store, bots } = makeBots(state);
  bots.remove("bot-a");
  assert.equal(store.state.botGroups.length, 0, "只剩它的群不该留成空壳");
  assert.equal(store.state.botUi["group:g1"], undefined);
  bots.undoRemove();
  assert.equal(store.state.botGroups.length, 1);
  assert.deepEqual(store.state.botGroups[0].memberIds, ["bot-a"]);
  assert.equal(store.state.botGroupMessages.length, 1);
  assert.ok(store.state.botUi["group:g1"]);
});

await test("清空会话：默认会话也能清；只清这一条，别的会话不动", () => {
  const state = {
    bots: [botRecord("bot-a", "A")],
    botTurns: [
      { id: "t1", botId: "bot-a", threadId: "th-a", decision: "replied" },
      { id: "t2", botId: "bot-a", threadId: "th-other", decision: "replied" },
    ],
    routines: [], botRevisions: [], botEvents: [],
    threads: [
      { id: "th-a", kind: "bot", botId: "bot-a", title: "默认", digest: "旧摘要", createdAt: NOON, updatedAt: NOON },
      { id: "th-other", kind: "bot", botId: "bot-a", title: "新话题", createdAt: NOON, updatedAt: NOON },
    ],
    messages: [
      { id: "m1", threadId: "th-a", role: "user", content: "旧问题", createdAt: NOON },
      { id: "m2", threadId: "th-a", role: "agent", content: "旧回答", createdAt: NOON },
      { id: "m3", threadId: "th-other", role: "user", content: "别的话题", createdAt: NOON },
    ],
    botGroups: [], botGroupMessages: [], botUi: {}, todoLinks: [], delegations: [],
  };
  const { store, bots } = makeBots(state);

  const res = bots.clearChat({ threadId: "th-a" });
  assert.equal(res.ok, true);
  assert.equal(res.removed, 2);
  assert.deepEqual(store.state.messages.map((m) => m.id), ["m3"], "默认会话的消息清掉，别的会话保留");
  assert.deepEqual(store.state.botTurns.map((t) => t.id), ["t2"], "回合也要清");
  assert.equal(store.state.threads.length, 2, "会话本身留着");
  assert.equal(store.state.threads[0].digest, "", "旧摘要不能继续当上下文");
  assert.throws(() => bots.clearChat({ threadId: "nope" }), /会话不存在/);
});

await test("去掉所有会话也能再建：默认会话被清空后仍可继续聊", () => {
  const state = {
    bots: [botRecord("bot-a", "A")], botTurns: [], routines: [], botRevisions: [], botEvents: [],
    threads: [{ id: "th-a", kind: "bot", botId: "bot-a", title: "默认", createdAt: NOON, updatedAt: NOON }],
    messages: [{ id: "m1", threadId: "th-a", role: "user", content: "旧", createdAt: NOON }],
    botGroups: [], botGroupMessages: [], botUi: {}, todoLinks: [], delegations: [],
  };
  const { bots } = makeBots(state);
  bots.clearChat({ threadId: "th-a" });
  assert.equal(bots.threadOf("bot-a").id, "th-a");
  assert.equal(bots.chats("bot-a")[0].count, 0);
});
