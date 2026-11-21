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

// 可恢复：流式半截落盘、重启后收成 interrupted

await test("流式增量会节流落盘（被打断时有半截可看）", async () => {
  const st = { state: { bots: [], botTurns: [], routines: [], todos: [] }, persist() {} };
  let clock = NOON;
  let seen = null;
  const b = createBots({
    store: st,
    now: () => (clock += 900), // 每次取时间前进 900ms（> 800ms 节流窗口），每条 delta 都会刷新一次
    memory: () => ({ inject: () => ({ items: [], markdown: "" }), usage: () => ({ ratio: 0, chars: 0, budget: 2400, entries: 0, notes: 0, dropped: 0 }) }),
    chatStream: async (_m, { onDelta }) => {
      onDelta("你");
      onDelta("好");
      seen = { ...st.state.botTurns.at(-1) }; // 拷贝：后面成功时会原地改成 replied
      return { text: "你好", usage: { total_tokens: 3 } };
    },
    key: () => "k",
  });
  b.ensureSeed();
  const bot = b.list()[0];
  bot.intro = false;
  const turn = await b.reply(bot, "在吗", { onDelta: () => {} });
  assert.equal(seen.decision, "streaming", "生成中就应该有一条 streaming 回合");
  assert.equal(seen.reply, "你好", "半截内容要已经落盘");
  assert.equal(turn.decision, "replied");
  assert.equal(st.state.botTurns.at(-1).decision, "replied", "成功后同一条改成 replied，不新增一条");
});

await test("重启后：streaming 收成 interrupted，半截回复保留", () => {
  const reboot = {
    state: {
      bots: [{ id: "b1", name: "戈洛", persona: {}, policy: {}, budget: {}, status: "active", createdAt: 1, updatedAt: 1 }],
      botTurns: [
        { id: "t1", botId: "b1", decision: "streaming", reply: "我正在看第", trigger: { kind: "mention" }, createdAt: NOON },
        { id: "t2", botId: "b1", decision: "replied", reply: "好的", trigger: { kind: "mention" }, createdAt: NOON },
      ],
      routines: [],
    },
    persist() {},
  };
  const b = createBots({ store: reboot, now: () => NOON, memory: () => ({ inject: () => ({ items: [], markdown: "" }) }), key: () => "k" });
  b.ensureSeed();
  const healed = reboot.state.botTurns.find((t) => t.id === "t1");
  assert.equal(healed.decision, "interrupted");
  assert.match(healed.reason, /没写完/);
  assert.equal(healed.reply, "我正在看第", "半截内容不能丢");
  assert.equal(reboot.state.botTurns.find((t) => t.id === "t2").decision, "replied", "别把正常回合也改了");
});
