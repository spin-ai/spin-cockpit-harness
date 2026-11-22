/**
 * bot 自测的公共骨架：一个极小的「测试登记 + 汇总」，不引框架。
 *
 * 拆成每个不变量一个文件（`tests/bot/*.test.mjs`）的原因见
 * `docs/product/COMPARE-rakazo.md` §15 顺位 12③：失败时文件名就该说明白是哪条不变量。
 * 共享的东西只有三样：固定的时钟（`at` / `NOON`）、一个 bot 夹具（`bot`）、以及 `test()`。
 */

import { DEFAULT_POLICY } from "../../electron/bot/index.mjs";

export const HOUR = 3600_000;
export const MIN = 60_000;

let passed = 0;
let failed = 0;
const failures = [];

/** 用例登记：必须 await —— 早先是同步 try/catch，async 用例的断言在 Promise 里抛，等于"全绿但没测" */
export const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    failures.push({ name, message: String(err?.message || err) });
    process.exitCode = 1;
    console.error(`✗ ${name}\n  ${String(err?.message || err)}`);
  }
};

/** 固定时钟：不传这个，tick 会撞上默认静音时段 [23,8]，测试随运行时间飘 */
export const at = (hour, minute = 0) => new Date(2026, 10, 17, hour, minute);
export const NOON = at(12).getTime();

/** 闸门测试用的 bot 夹具（只带闸门关心的字段） */
export const bot = (patch = {}) => ({
  id: "b1", name: "测试", status: "active", mutedUntil: 0,
  policy: { ...DEFAULT_POLICY, quietHours: [23, 8], minGapMs: 2 * MIN, maxTurnsPerHour: 3, ...(patch.policy || {}) },
  ...patch,
});

/** 收尾：打印总数，给 npm script 一个非 0 退出码 */
export const report = (label = "Bot") => {
  console.log(`\n${label}: ${passed} 项 · ${failed ? `failed（${failed}）` : "passed"}`);
  if (failed) {
    console.log(failures.map((f) => `  ✗ ${f.name}`).join("\n"));
    process.exitCode = 1;
  }
  return { passed, failed };
};
