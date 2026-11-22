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

// 出站守卫：脱敏、防重复、敏感词

const sensStore = {
  state: { bots: [], botTurns: [], todos: [{ id: "t1", title: "补完核对项", status: "waiting_input", confirmed: true }] },
  persist() {},
};

const sensBots = createBots({
  store: sensStore,
  now: () => NOON,
  memory: () => ({ inject: () => ({ items: [], markdown: "" }) }),
  chat: async () => ({ text: "我这就去转账 5000 给供应商", usage: { totalTokens: 40 } }),
  key: () => "k",
});
await test("敏感词命中：落 blocked、正文只留在本地审计、不带 proposal", async () => {
  const seededSens = makeBot(sensBots);
  sensBots.save({ id: seededSens.id, capability: "dispatch", policy: { sensitiveBlocklist: ["转账"] } });
  const turn = (await sensBots.tick({ botId: seededSens.id })).at(-1);
  assert.equal(turn.decision, "blocked");
  assert.match(turn.reason, /敏感词/);
  assert.match(turn.reply, /转账/, "正文留在本地，便于复核它想说什么");
  assert.equal(turn.proposal, null, "被拦的话不能变成任务建议");
});

const FAKE_SK = `sk-${"a".repeat(20)}`;

const FAKE_GH = `ghp_${"b".repeat(24)}`;

const FAKE_BEARER = `Bearer ${"c".repeat(20)}`;

const FAKE_PATH = ["", "Users", "someone", "project", "src", "app.tsx"].join("/");

await test("脱敏：明确形态才涂，正常文本不动", () => {
  assert.equal(redactSecrets(`key 是 ${FAKE_SK}`).text, "key 是 [redacted]");
  assert.equal(redactSecrets(`token: ${FAKE_GH}`).text, "token: [redacted]");
  assert.equal(redactSecrets(`Authorization: ${FAKE_BEARER}`).text, "Authorization: [redacted]");
  const hex = redactSecrets(`值 ${"d".repeat(40)}`).text;
  assert.match(hex, /\[redacted\]/);
  // 误伤检查：短 hash / 路径 / 普通句子都要留着
  assert.equal(redactSecrets("commit 8fba288 改了什么").text, "commit 8fba288 改了什么");
  assert.equal(redactSecrets(FAKE_PATH).text, FAKE_PATH);
  assert.equal(hasSecret("没有密钥"), false);
  assert.equal(hasSecret(FAKE_SK), true);
});

await test("防重复：同一事件说两次就压住；换说法重说也压住", () => {
  const now = at(12).getTime();
  const turns = [
    { botId: "b1", decision: "answered", reply: "有一条待确认", trigger: { ref: "todo:t1" }, createdAt: now - 20 * MIN },
    { botId: "b1", decision: "answered", reply: "还有一条待确认", trigger: { ref: "todo:t1" }, createdAt: now - 10 * MIN },
  ];
  const same = suppressionReason({ turns, botId: "b1", candidate: { ref: "todo:t1", title: "待确认" }, now });
  assert.equal(same.blocked, true);
  assert.match(same.reason, /同一事件/);
  const other = suppressionReason({ turns, botId: "b1", candidate: { ref: "todo:t2", title: "另一条失败" }, now });
  assert.equal(other.blocked, false);
  const dup = suppressionReason({ turns, botId: "b1", candidate: { ref: "todo:t9", title: "x" }, now, reply: "有一条待确认" });
  assert.equal(dup.blocked, true);
  assert.match(dup.reason, /几乎相同|近重复/);
  assert.ok(similarity("有三个待确认", "有三个待确认") > 0.99);
});

await test("回合落库前脱敏：粘贴的 key 不留明文", async () => {
  const redStore = { state: { bots: [], botTurns: [], routines: [], todos: [] }, persist() {} };
  const redBots = createBots({
    store: redStore, now: () => NOON,
    memory: () => ({ inject: () => ({ items: [], markdown: "" }), usage: () => ({ ratio: 0, chars: 0, budget: 2400, entries: 0, notes: 0, dropped: 0 }) }),
    chatStream: async () => ({ text: "收到", usage: {} }), key: () => "k",
  });
  const b = makeBot(redBots);
  const pasted = `我的 key 是 sk-${"e".repeat(24)}`;
  const turn = await redBots.reply(b, pasted, { onDelta: () => {} });
  assert.doesNotMatch(turn.input, /sk-eeeeeeee/);
  assert.match(turn.input, /\[redacted\]/);
});
