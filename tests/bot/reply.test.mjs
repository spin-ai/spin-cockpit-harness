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

// 被动回复：流式增量、取消、SSE 解析

test("SSE：只取 delta.content，[DONE] 与坏行都返回空", () => {
  assert.equal(parseSseDelta('{"choices":[{"delta":{"content":"你"}}]}'), "你");
  assert.equal(parseSseDelta('{"choices":[{"message":{"content":"整段"}}]}'), "整段");
  assert.equal(parseSseDelta("[DONE]"), "");
  assert.equal(parseSseDelta("not json"), "");
});


const store = { state: { bots: [], botTurns: [] }, persist() {} };

const deltas = [];

const bots = createBots({
  store,
  now: () => NOON,
  memory: () => ({ inject: () => ({ items: [{ included: true, layer: "L2", id: "m1", title: "偏好：先说结论" }] }) }),
  chatStream: async (_messages, { onDelta }) => {
    onDelta?.("你");
    onDelta?.("好");
    return { text: "你好", usage: { total_tokens: 12 } };
  },
  key: () => "test-key",
});
bots.ensureSeed();

const seeded = makeBot(bots, { name: "小A" });

await test("被动回复：流式增量按顺序到，落库 decision=replied 且有注入记忆", async () => {
  deltas.length = 0;
  const turn = await bots.reply(seeded, "在吗", { onDelta: (d) => deltas.push(d) });
  assert.equal(deltas.join(""), "你好");
  assert.equal(turn.decision, "replied");
  assert.equal(turn.input, "在吗");
  assert.equal(turn.reply, "你好");
  assert.equal(turn.injected[0].layer, "L2");
  assert.equal(store.state.botTurns.at(-1).id, turn.id);
});

await test("被动回复：首字延迟落进 cost.ttftMs", async () => {
  const ttftStore = { state: { bots: [], botTurns: [] }, persist() {} };
  const fast = createBots({
    store: ttftStore,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    chatStream: async () => ({ text: "好", usage: { total_tokens: 3 }, ttft: 120 }),
    key: () => "k",
  });
  fast.ensureSeed();
  const turn = await fast.reply(makeBot(fast), "在吗");
  assert.equal(turn.cost.ttftMs, 120);
  assert.equal(turn.cost.tokens, 3);
});

await test("被动回复：没有 key 直接报错，不落回合", async () => {
  const noKey = createBots({ store, now: () => NOON, memory: () => ({ inject: () => ({ items: [] }) }), chatStream: async () => ({ text: "x" }), key: () => "" });
  const before = store.state.botTurns.length;
  await assert.rejects(() => noKey.reply(seeded, "在吗"), /缺少模型 key/);
  assert.equal(store.state.botTurns.length, before);
});

await test("取消：signal abort 时回合留成 interrupted，半截回复不丢", async () => {
  const abortStore = { state: { bots: [], botTurns: [] }, persist() {} };
  const aborting = createBots({
    store: abortStore,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    chatStream: async (_m, { signal, onDelta }) => {
      onDelta?.("你");
      await new Promise((_r, rej) => signal?.addEventListener("abort", () => rej(new Error("aborted")), { once: true }));
      return { text: "不该到这一步" };
    },
    key: () => "k",
  });
  aborting.ensureSeed();
  const controller = new AbortController();
  const p = aborting.reply(makeBot(aborting), "在吗", { signal: controller.signal, onDelta: () => {} });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(() => p, /abort/i);
  assert.equal(abortStore.state.botTurns.length, 1);
  const kept = abortStore.state.botTurns[0];
  assert.equal(kept.decision, "interrupted");
  assert.equal(kept.reply, "你");
  assert.equal(kept.input, "在吗");
});

await test("报错（非取消）：回合不留在账上", async () => {
  const errStore = { state: { bots: [], botTurns: [] }, persist() {} };
  const failing = createBots({
    store: errStore,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    chatStream: async () => { throw new Error("上游 500"); },
    key: () => "k",
  });
  failing.ensureSeed();
  await assert.rejects(() => failing.reply(makeBot(failing), "在吗"), /上游 500/);
  assert.equal(errStore.state.botTurns.length, 0);
});
