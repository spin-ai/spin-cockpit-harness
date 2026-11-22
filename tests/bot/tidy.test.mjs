/**
 * 记忆整理：只归档（可恢复），不删除；到 80% 才给候选，先动分数最低、最久没更新的。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "./_harness.mjs";
import { planTidy } from "../../electron/bot/tidy.mjs";
import { createMemory } from "../../electron/memory/index.mjs";

const entry = (id, score, chars, extra = {}) => ({ id, layer: "L4", title: id, included: true, score, chars, updatedAt: 1, ...extra });

await test("整理计划：80% 以下不给候选", () => {
  const plan = planTidy({ items: [entry("a", 1, 500)], used: 7000, budget: 10000 });
  assert.equal(plan.ready, false);
  assert.match(plan.reason, /< 80%/);
  assert.deepEqual(plan.picks, []);
});

await test("整理计划：按分数从低到高，跳过置顶与 note，归档到 60% 目标", () => {
  const items = [
    entry("low", 0.5, 1000),
    entry("mid", 1, 1000),
    entry("high", 2, 1000),
    entry("pinned", 0.1, 1000, { pinned: true }),
    { id: "n1", layer: "note", title: "观察", included: true, score: 0, chars: 500 },
  ];
  const plan = planTidy({ items, used: 9000, budget: 10000 });
  assert.equal(plan.ready, true);
  assert.equal(plan.need, 3000);
  assert.deepEqual(plan.picks.map((p) => p.id), ["low", "mid", "high"]);
  assert.equal(plan.freed, 3000);
  assert.equal(plan.short, false);
});

await test("整理计划：候选不够时老实说 short，且受单次上限约束", () => {
  const items = [entry("a", 0.1, 1000), entry("b", 0.2, 1000), entry("c", 0.3, 1000)];
  const capped = planTidy({ items, used: 9500, budget: 10000, max: 2 });
  assert.equal(capped.picks.length, 2);
  assert.equal(capped.freed, 2000);
  assert.equal(capped.short, true, "需要 3500，只释放 2000");
});

await test("整理可恢复：归档后注入变小，恢复后回来", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-tidy-"));
  const mem = createMemory({ dir });
  const a = mem.entryUpsert({ layer: "L4", title: "发布流程", body: "先跑 e2e 再发版".repeat(20) });
  mem.entryUpsert({ layer: "L4", title: "发票目录", body: "发票统一放 finance/".repeat(20) });
  const before = mem.inject({ maxChars: 1200 });
  assert.ok(before.markdown.includes("发布流程"));
  mem.entryArchive({ id: a.id });
  const after = mem.inject({ maxChars: 1200 });
  assert.equal(after.markdown.includes("发布流程"), false, "归档后不再注入");
  assert.ok(after.chars < before.chars);
  mem.entryRestore({ id: a.id });
  assert.ok(mem.inject({ maxChars: 1200 }).markdown.includes("发布流程"), "恢复后重新注入");
  mem.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
});
