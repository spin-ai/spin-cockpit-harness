/**
 * 审批时限 + 无人值守的前提。
 *
 * 1. 有人看着 10 分钟、无人值守 3 分钟；`COCKPIT_APPROVAL_TIMEOUT_MS` 可覆盖，`0`/非法值忽略；
 * 2. 「无人值守」= 任务归一个开着 standing 的机器人（没有 botId / 没开 → 不是）；
 * 3. 超时说明是人话：写清多少分钟、为什么（没人处理 / 无人值守）、是哪一步。
 */
import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import {
  APPROVAL_TIMEOUT_MS,
  APPROVAL_TIMEOUT_UNATTENDED_MS,
  UNATTENDED_NEEDS_RELEASE,
  approvalTimeoutMs,
  approvalTimeoutNote,
  unattendedTodo,
} from "../../electron/bot/approval.mjs";

await test("审批时限：默认 10 分钟，无人值守 3 分钟，环境变量可覆盖", () => {
  assert.equal(approvalTimeoutMs(), APPROVAL_TIMEOUT_MS);
  assert.equal(approvalTimeoutMs({ unattended: true }), APPROVAL_TIMEOUT_UNATTENDED_MS);
  assert.ok(APPROVAL_TIMEOUT_UNATTENDED_MS < APPROVAL_TIMEOUT_MS, "无人值守要更短");
  assert.equal(approvalTimeoutMs({ override: 1234 }), 1234);
  assert.equal(approvalTimeoutMs({ unattended: true, override: 1234 }), 1234, "覆盖优先于无人值守");
  for (const bad of [0, -1, NaN, null, undefined, "abc"]) {
    assert.equal(approvalTimeoutMs({ override: bad }), APPROVAL_TIMEOUT_MS, `非法覆盖 ${String(bad)} 要退回默认`);
  }
});

await test("无人值守：只有归「开着 standing 的机器人」的任务才算", () => {
  const bots = [
    { id: "b1", policy: { standing: { enabled: true, maxRunsPerHour: 2 } } },
    { id: "b2", policy: { standing: { enabled: false } } },
    { id: "b3" },
  ];
  assert.equal(unattendedTodo({ id: "t1", botId: "b1" }, bots), true);
  assert.equal(unattendedTodo({ id: "t2", botId: "b2" }, bots), false);
  assert.equal(unattendedTodo({ id: "t3", botId: "b3" }, bots), false);
  assert.equal(unattendedTodo({ id: "t4", botId: "gone" }, bots), false);
  assert.equal(unattendedTodo({ id: "t5" }, bots), false);
  assert.equal(unattendedTodo(null, bots), false);
});

await test("超时说明：写清分钟、原因和哪一步；无人值守另说", () => {
  const watched = approvalTimeoutNote({ minutes: 10, title: "运行 npm test" });
  assert.match(watched, /10 分钟/);
  assert.match(watched, /按拒绝处理/);
  assert.match(watched, /运行 npm test/);
  assert.match(watched, /没人处理/);
  const unattended = approvalTimeoutNote({ minutes: 3, unattended: true, title: "改 src/App.tsx" });
  assert.match(unattended, /3 分钟/);
  assert.match(unattended, /无人值守/);
  assert.match(approvalTimeoutNote({ minutes: 10 }), /按拒绝处理$/);
  assert.match(UNATTENDED_NEEDS_RELEASE, /本任务放行/);
});
