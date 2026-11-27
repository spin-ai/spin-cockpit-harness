/**
 * 「我的手」：停止要连派出去的 run 一起停；界面上的执行链不能张冠李戴。
 * 判据（都能在这份用例里复现）：
 *  1) 只停活跃状态的 run，停过的/跑完的不管；
 *  2) 只停这一轮（时间窗内）派出去的，上周的 run 不许被连坐；
 *  3) 执行链优先指向活跃的 run，没有活跃的就指向最新的。
 */

import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import { linkedHands, runsToStopForCancel, handChainForTurn } from "../../electron/bot/hands.mjs";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const turns = [
  { id: "t1", botId: "b1", createdAt: NOW - 2 * MIN, todoIds: ["td1"], runId: "r1" },
  { id: "t2", botId: "b1", createdAt: NOW - 3 * 60 * MIN, todoIds: ["tdOld"] },      // 3 小时前：窗外
  { id: "t3", botId: "b2", createdAt: NOW - MIN, todoIds: ["td2"], runId: "r2" },     // 别人的手
  { id: "t4", botId: "b1", createdAt: NOW - MIN, todoId: "td3" },                     // 单数与复数字段都要认
];

const runs = [
  { id: "r1", todoId: "td1", status: "running", startedAt: NOW - MIN },
  { id: "r2", todoId: "td2", status: "running", startedAt: NOW - MIN },
  { id: "rOld", todoId: "tdOld", status: "running", startedAt: NOW - 3 * 60 * MIN },
  { id: "rDone", todoId: "td1", status: "done", startedAt: NOW - 5 * MIN },
  { id: "r3", todoId: "td3", status: "queued", startedAt: NOW - 30_000 },
];

await test("停止：只停这个 bot 这一轮派出去、且还在跑的 run", () => {
  assert.deepEqual(runsToStopForCancel(runs, turns, { botId: "b1", now: NOW }), ["r1", "r3"]);
});

await test("停止：别人的 run / 窗外的老 run / 已结束的 run 都不许连坐", () => {
  const stopped = runsToStopForCancel(runs, turns, { botId: "b1", now: NOW });
  assert.ok(!stopped.includes("r2"), "b2 的 run");
  assert.ok(!stopped.includes("rOld"), "3 小时前的 run");
  assert.ok(!stopped.includes("rDone"), "已经跑完的 run");
});

await test("停止：没派过活的 bot 一条都不停（空数组，不是 undefined）", () => {
  assert.deepEqual(runsToStopForCancel(runs, turns, { botId: "b9", now: NOW }), []);
  assert.deepEqual(runsToStopForCancel([], turns, { botId: "b1", now: NOW }), []);
});

await test("手：linkedHands 收全 todoIds / todoId / runId", () => {
  const { todos, runs: linked } = linkedHands(turns, { botId: "b1", now: NOW });
  assert.deepEqual([...todos].sort(), ["td1", "td3"]);
  assert.deepEqual([...linked], ["r1"]);
});

await test("执行链：优先活跃 run，任务与 run 都要认出来", () => {
  const chain = handChainForTurn({ todoIds: ["td1"], runId: "r1" }, { todos: [{ id: "td1", key: "FEAT-1", title: "标题改大" }], runs });
  assert.equal(chain?.todo?.key, "FEAT-1");
  assert.equal(chain?.run?.id, "r1");
  assert.equal(chain?.extra, 0);
});

await test("执行链：活跃的优先；没有 todo 只剩 run 也要能画", () => {
  const rs = [
    { id: "r1", todoId: "td1", status: "done", startedAt: NOW - 10 * MIN },
    { id: "r2", todoId: "td1", status: "running", startedAt: NOW - MIN },
  ];
  assert.equal(handChainForTurn({ todoIds: ["td1"] }, { todos: [{ id: "td1" }], runs: rs })?.run?.id, "r2");
  assert.equal(handChainForTurn({ runId: "r1" }, { todos: [], runs: rs })?.run?.id, "r1");
  assert.equal(handChainForTurn({}, {}), null);
});

await test("执行链：多个任务只画第一个，其余记进 extra", () => {
  const chain = handChainForTurn({ todoIds: ["td1", "td2", "td3"] }, { todos: [{ id: "td1" }], runs: [] });
  assert.equal(chain?.todo?.id, "td1");
  assert.equal(chain?.extra, 2);
});
