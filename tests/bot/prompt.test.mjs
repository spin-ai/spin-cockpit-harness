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

// system prompt：人格卡、记忆正文、主动说过的话、配额边界

test("system prompt 带能力边界：只读 bot 不许声称能写代码/起任务", () => {
  const read = buildSystemPrompt({ name: "戈洛", capability: "read", persona: DEFAULT_POLICY ? undefined : undefined });
  assert.match(read, /只读/);
  assert.match(read, /不要声称自己能写代码/);
  const dispatch = buildSystemPrompt({ name: "戈洛", capability: "dispatch" });
  assert.match(dispatch, /起 Agent 任务/);
  assert.match(dispatch, /请人确认/);
  assert.doesNotMatch(dispatch, /不要声称自己能写代码/);
});

test("system prompt 带上注入的记忆条目与人格卡字段", () => {
  const text = buildSystemPrompt(
    { name: "戈洛", capability: "read", persona: { tone: "短句", address: "叫你「你」" } },
    [{ layer: "L2", title: "偏好：先说结论" }],
  );
  assert.match(text, /短句/);
  assert.match(text, /叫你「你」/);
  assert.match(text, /\[L2\] 偏好：先说结论/);
});

await test("记忆注入带正文：字符串与数组两种形态都能进 prompt", () => {
  const markdown = "## 记忆（L4 目录 / 结论）\n- 偏好：先说结论";
  const asText = buildSystemPrompt({ name: "戈洛", capability: "read" }, markdown);
  assert.match(asText, /偏好：先说结论/);
  const asItems = buildSystemPrompt({ name: "戈洛", capability: "read" }, [{ layer: "L4", title: "偏好", body: "先说结论" }]);
  assert.match(asItems, /偏好：先说结论/);
  assert.doesNotMatch(asItems, /这一轮没有注入记忆/);
});

await test("转人工 / 最近主动说过的话都进 prompt，不靠用户自己记得", () => {
  const text = buildSystemPrompt(
    { name: "戈洛", capability: "read", policy: { escalate: "花钱 / 对外发言" } },
    "",
    { proactive: false, recentProactive: ["我上午提过有两项待确认"] },
  );
  assert.match(text, /必须请人来做/);
  assert.match(text, /花钱/);
  assert.match(text, /我上午提过有两项待确认/);
  assert.match(text, /别自相矛盾/);
});

const seen = [];

const saidStore = { state: { bots: [], botTurns: [], todos: [{ id: "t1", title: "待输入", status: "waiting_input", confirmed: true }] }, persist() {} };

const saidBots = createBots({
  store: saidStore,
  now: () => NOON,
  memory: () => ({ inject: () => ({ items: [], markdown: "## 记忆\n- 用户偏好：短句" }) }),
  chat: async () => ({ text: "有两项待确认，要现在看吗？" }),
  chatStream: async (messages) => { seen.push(messages[0].content); return { text: "好，我去处理。", usage: { total_tokens: 9 } }; },
  key: () => "k",
});
saidBots.ensureSeed();
saidBots.list()[0].intro = false;

await test("被动回复记得自己主动说过什么，且带上记忆正文", async () => {
  const b = saidBots.list()[0];
  await saidBots.tick({ botId: b.id });
  await saidBots.reply(b, "你刚说什么？", { onDelta: () => {} });
  const system = seen.at(-1) || "";
  assert.match(system, /用户偏好：短句/, "记忆正文要进 system");
  assert.match(system, /有两项待确认/, "主动说过的话要进 system");
});

await test("主动回合也进最近上下文（不再只取 replied）", () => {
  const answered = saidStore.state.botTurns.filter((t) => t.decision === "answered");
  assert.equal(answered.length, 1);
  const prompt = buildSystemPrompt(saidBots.list()[0], "", { proactive: false, recentProactive: answered.map((t) => t.reply) });
  assert.match(prompt, /有两项待确认/);
});
