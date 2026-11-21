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

// 闸门与候选：什么时候允许开口（静音 / 间隔 / 条数 / token / 打分）

test("静音时段：跨午夜与非跨午夜都对", () => {
  assert.equal(quietActive([23, 8], at(23, 30)), true);
  assert.equal(quietActive([23, 8], at(3, 0)), true);
  assert.equal(quietActive([23, 8], at(7, 59)), true);
  assert.equal(quietActive([23, 8], at(8, 0)), false);
  assert.equal(quietActive([9, 17], at(10)), true);
  assert.equal(quietActive([9, 17], at(18)), false);
  assert.equal(quietActive([0, 0], at(10)), false, "起止相同视为未配置");
});

test("候选打分：失败 > 待输入 > 普通；未知事件 0 分", () => {
  assert.ok(scoreCandidate({ kind: "run.failed" }) > scoreCandidate({ kind: "todo.waiting_input" }));
  assert.ok(scoreCandidate({ kind: "todo.waiting_input" }) > scoreCandidate({ kind: "memory.due" }));
  assert.equal(scoreCandidate({ kind: "whatever" }), 0);
});

test("闸门：暂停 / 静音 / 静音时段都记 silent", () => {
  assert.equal(gatesFor(bot({ status: "paused" })).decision, "silent");
  assert.equal(gatesFor(bot({ mutedUntil: Date.now() + MIN })).decision, "silent");
  const now = at(23, 30).getTime();
  assert.equal(gatesFor(bot(), { now }).decision, "silent");
});

test("闸门：配额满记 blocked，未满放行", () => {
  const now = at(12).getTime();
  const turns = [0, 1, 2].map((i) => ({ botId: "b1", decision: "answered", createdAt: now - i * 5 * MIN }));
  assert.equal(gatesFor(bot(), { now, turns }).decision, "blocked");
  assert.equal(gatesFor(bot(), { now, turns: turns.slice(0, 2) }).ok, true);
});

test("闸门：最小间隔未到记 blocked", () => {
  const now = at(12).getTime();
  const turns = [{ botId: "b1", decision: "answered", createdAt: now - 30_000 }];
  const res = gatesFor(bot(), { now, turns });
  assert.equal(res.ok, false);
  assert.equal(res.decision, "blocked");
});

test("闸门：上一小时的条数不占本小时配额", () => {
  const now = at(12).getTime();
  const turns = [0, 1, 2].map((i) => ({ botId: "b1", decision: "answered", createdAt: now - HOUR - (i + 1) * MIN }));
  assert.equal(gatesFor(bot(), { now, turns }).ok, true);
});

test("候选：只看 confirmed 的任务，失败优先于待输入", () => {
  const now = at(12).getTime();
  const state = {
    todos: [
      { id: "t1", title: "待输入", status: "waiting_input", confirmed: true },
      { id: "t2", title: "失败", lastRunFailed: true, confirmed: true },
      { id: "t3", title: "未确认", status: "waiting_input", confirmed: false },
      { id: "t4", title: "普通", status: "running", confirmed: true },
    ],
  };
  const out = collectCandidates(state, { now });
  assert.deepEqual(out.map((c) => c.todoId), ["t2", "t1"]);
});

test("候选：同一事件 30 分钟内不重复提", () => {
  const now = at(12).getTime();
  const state = { todos: [{ id: "t1", title: "待输入", status: "waiting_input", confirmed: true }] };
  const recent = [{ trigger: { ref: "todo:t1" }, createdAt: now - 5 * MIN }];
  assert.equal(collectCandidates(state, { now, recentTurns: recent }).length, 0);
  const old = [{ trigger: { ref: "todo:t1" }, createdAt: now - 40 * MIN }];
  assert.equal(collectCandidates(state, { now, recentTurns: old }).length, 1);
});

await test("候选去重按 bot 各算各的：A 说过不挡 B", () => {
  const now = at(12).getTime();
  const state = { todos: [{ id: "t1", title: "待输入", status: "waiting_input", confirmed: true }] };
  const recent = [{ botId: "b2", trigger: { ref: "todo:t1" }, createdAt: now - 5 * MIN }];
  assert.equal(collectCandidates(state, { now, recentTurns: recent, botId: "b1" }).length, 1, "B 说过的不能挡 A");
  assert.equal(collectCandidates(state, { now, recentTurns: recent, botId: "b2" }).length, 0, "自己说过的不重复");
});

await test("token 配额是一道真闸：超了 blocked 并说明用量", () => {
  const now = at(12).getTime();
  const turns = [{ botId: "b1", decision: "answered", createdAt: now - MIN, cost: { tokens: 7000 } }];
  const res = gatesFor({ ...bot(), budget: { tokensPerTurn: 700, tokensPerHour: 6000 } }, { now, turns });
  assert.equal(res.ok, false);
  assert.equal(res.decision, "blocked");
  assert.match(res.reason, /token/);
});

await test("force 只放行静音时段与最小间隔，不放过配额", () => {
  const quietNow = at(23, 30).getTime();
  assert.equal(gatesFor(bot(), { now: quietNow, force: true }).ok, true, "手动跑一次可以越过静音时段");
  const gapTurns = [{ botId: "b1", decision: "answered", createdAt: quietNow - 30_000 }];
  assert.equal(gatesFor(bot(), { now: quietNow, turns: gapTurns, force: true }).ok, true, "也不再卡最小间隔");
  const full = [0, 1, 2].map((i) => ({ botId: "b1", decision: "answered", createdAt: quietNow - i * MIN }));
  assert.equal(gatesFor(bot(), { now: quietNow, turns: full, force: true }).decision, "blocked", "配额满仍然 blocked");
});
