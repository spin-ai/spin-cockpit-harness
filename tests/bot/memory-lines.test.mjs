/**
 * 记忆行模型（P0-5）的不变量：
 *
 * 1. 一行一条事实，行尾 ` · from: <来源>`（bot / 人 / 共享），来源可解析；
 * 2. 装载上限 200 行：超了在 system 里明说「未载入 N 行」+「预算已用 X%」，不静默裁；
 * 3. 面板行数 = 镜像行数 = stats.lines；DB 仍是事实源，MEMORY.md 只是只读镜像。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NOON, makeBot, test } from "./_harness.mjs";
import {
  BOT_MEMORY_LINE_CAP, MEMORY_SOURCE_SEPARATOR, capMemoryLines, formatMemoryLine,
  memoryLineStats, memorySourceLabel, parseMemoryLine,
} from "../../electron/memory/lines.mjs";
import { compileContext, createBots } from "../../electron/bot/index.mjs";
import { createMemory } from "../../electron/memory/index.mjs";

await test("行格式：日期 + 正文 + from，来源分 bot / 人 / 共享", () => {
  const line = formatMemoryLine({ text: "发票统一放 finance/ 目录", at: NOON, from: "bot" });
  assert.ok(line.startsWith("- 2026-11-17 "), line);
  assert.ok(line.endsWith(`${MEMORY_SOURCE_SEPARATOR}bot`));
  const parsed = parseMemoryLine(line);
  assert.equal(parsed.date, "2026-11-17");
  assert.equal(parsed.text, "发票统一放 finance/ 目录");
  assert.equal(parsed.from, "bot");
  assert.equal(parseMemoryLine("- 没有日期的旧行 · from: 共享").date, "");
  assert.equal(memorySourceLabel(""), "共享");
  assert.equal(memorySourceLabel("bot:pm"), "bot");
  assert.equal(memorySourceLabel("owner:spin"), "人");
});

await test("装载上限：300 行 → 载入 200、未载入 100", () => {
  const lines = Array.from({ length: 300 }, (_, i) => formatMemoryLine({ text: `第 ${i} 条事实`, at: NOON, from: i % 2 ? "bot" : "共享" }));
  const capped = capMemoryLines(lines, BOT_MEMORY_LINE_CAP);
  assert.equal(capped.total, 300);
  assert.equal(capped.loaded, 200);
  assert.equal(capped.dropped, 100);
  assert.equal(capped.cap, 200);
  const stats = memoryLineStats(lines);
  assert.equal(stats.lines, 300);
  assert.equal(stats.sources.bot, 150);
  assert.equal(stats.sources.shared, 150);
});

await test("镜像：一行一条事实带来源；面板行数 = 镜像行数（DB 仍是事实源）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-mem-lines-"));
  const mem = createMemory({ dir });
  try {
    mem.entryUpsert({ layer: "L4", title: "发布流程", body: "先跑 e2e 再打包", owner: "" });
    mem.entryUpsert({ layer: "L2", title: "PM 私有", body: "发票放 finance/", owner: "bot:pm" });
    const md = mem.botMarkdown({ owner: "bot:pm" });
    const factLines = md.split("\n").filter((l) => l.startsWith("- ") && l.includes(MEMORY_SOURCE_SEPARATOR));
    assert.equal(factLines.length, 2, "一条事实一行");
    assert.match(md, /发布流程：先跑 e2e 再打包 · from: 共享/);
    assert.match(md, /PM 私有：发票放 finance\/ · from: bot/);
    assert.match(md, /只读镜像/);
    const res = mem.botMemoryLines({ owner: "bot:pm" });
    assert.equal(res.stats.lines, 2);
    assert.equal(res.stats.sources.shared, 1);
    assert.equal(res.stats.sources.bot, 1);
    assert.equal(res.lines.length, 2, "面板拿到的就是这份行");
    assert.equal(mem.botMemoryLines({ owner: "bot:other" }).stats.lines, 1, "别人的私有行看不到");
  } finally {
    mem.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test("system：300 行镜像 → 「未载入 100 行」+「预算已用 X%」", () => {
  // 每条都短：200 行要能装进 8000 字符预算，这样才能量准「行上限」而不是字符预算
  const memory = Array.from({ length: 300 }, (_, i) => `- 第 ${i} 条 · from: bot`).join("\n");
  const bot = { id: "b1", name: "PM", capability: "read", persona: {}, policy: {} };
  const compiled = compileContext(bot, memory, { proactive: false });
  assert.equal(compiled.memoryLines.total, 300);
  assert.equal(compiled.memoryLines.loaded, BOT_MEMORY_LINE_CAP);
  assert.match(compiled.system, /未载入 100 行/);
  assert.match(compiled.system, /记忆装载：200\/300 行/);
  assert.match(compiled.system, /预算已用 \d+\/\d+ 字符（\d+%）/);
  // system 里的记忆行数 = memoryLines.loaded（面板同一份）
  const shown = compiled.system.split("\n").filter((l) => l.startsWith("- ")).length;
  assert.equal(shown, BOT_MEMORY_LINE_CAP);
  assert.equal(compiled.memoryLines.dropped, 100);
});

await test("system：行没超限时也报行数，但不喊「未载入」", () => {
  const memory = [formatMemoryLine({ text: "只有一条", at: NOON, from: "共享" })].join("\n");
  const compiled = compileContext({ id: "b1", name: "PM", capability: "read", persona: {}, policy: {} }, memory, { proactive: false });
  assert.match(compiled.system, /记忆装载：1\/1 行/);
  assert.doesNotMatch(compiled.system, /未载入/);
  assert.equal(compiled.memoryLines.dropped, 0);
});

await test("被动回复：回合 context 记下行账（loaded / dropped / 预算百分比）", async () => {
  const store = { state: { bots: [], botTurns: [] }, persist() {} };
  const many = Array.from({ length: 260 }, (_, i) => `- 事实 ${i}`).join("\n");
  const b = createBots({
    store, now: () => NOON,
    memory: () => ({ inject: () => ({ items: [], markdown: many }) }),
    chatStream: async () => ({ text: "好" }),
    key: () => "k",
  });
  b.ensureSeed();
  const turn = await b.reply(makeBot(b, { id: "bmem" }), "在吗");
  assert.equal(turn.context.memoryLines.total, 260);
  assert.equal(turn.context.memoryLines.loaded, BOT_MEMORY_LINE_CAP);
  assert.ok(turn.context.memoryLines.dropped >= 60, "行上限先挡掉 60 行，字符预算可能再挡一些");
  assert.ok(turn.context.memoryUsedPct > 0);
  assert.ok(turn.context.sections.memoryNote > 0, "行账那句也算进分区字符");
});
