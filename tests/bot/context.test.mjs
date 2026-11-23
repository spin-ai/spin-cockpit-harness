/**
 * 上下文编译与长对话压缩：这一层决定「它一轮能带多少相关东西」。
 * 都是纯函数，不调模型，所以阈值可以钉死。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "./_harness.mjs";
import { createMemory } from "../../electron/memory/index.mjs";
import {
  BOT_INJECT_CHARS, compileContext, effortPolicy, historyDigest, temperatureFor, toolSignature,
} from "../../electron/bot/index.mjs";

await test("温度：工具轮 0.3，闲聊 0.7", () => {
  assert.equal(temperatureFor(true), 0.3);
  assert.equal(temperatureFor(false), 0.7);
});

await test("工具签名：键序不影响，字符串/对象等价", () => {
  const a = toolSignature("git_diff", '{"path":"a","staged":false}');
  const b = toolSignature("git_diff", { staged: false, path: "a" });
  assert.equal(a, b);
  assert.notEqual(a, toolSignature("git_diff", { path: "b", staged: false }));
  assert.equal(toolSignature("todo_list", "{"), "todo_list?");
});

await test("长对话压缩：24 条以内不压，超过就把最近 10 条之外的压成背景", () => {
  const msgs = (n) => Array.from({ length: n }, (_v, i) => ({ role: i % 2 ? "agent" : "user", content: `第 ${i} 条` }));
  assert.equal(historyDigest(msgs(24)), "");
  const digest = historyDigest(msgs(30));
  assert.match(digest, /第 0 条/);
  assert.match(digest, /第 19 条/);
  assert.doesNotMatch(digest, /第 25 条/, "最近 10 条要保留原文，不进摘要");
  assert.ok(digest.length <= 2400);
});

await test("上下文：记忆按预算硬裁，同僚目录只给名字+职责", () => {
  const memory = "记".repeat(5000);
  const out = compileContext(
    { name: "PM", capability: "read", persona: {} },
    memory,
    { proactive: false, maxChars: 1000, teammates: [{ name: "知识", role: "worker", mission: "查资料" }] },
  );
  assert.ok(out.memoryChars <= 1000, `记忆应裁到 1000 以内，实际 ${out.memoryChars}`);
  assert.ok(out.memoryDropped >= 4000);
  assert.match(out.system, /知识（执行者）：查资料/);
  assert.match(out.system, /不要冒充他们/);
  assert.equal(out.sectionChars.memory, out.memoryChars);
  assert.ok(out.chars >= out.memoryChars);
});

await test("上下文：默认预算允许 8KB 记忆，不再只给目录", () => {
  // 注意行数：装载上限是 200 行（P0-5），这条用例量的是字符预算，所以每行长一点、行数少一点
  const body = "结论：发票统一放 finance/ 目录，报销单放报销目录，两者都不进项目仓库。\n";
  const markdown = body.repeat(170); // ~7KB / 170 行（<200 行上限，量的是字符预算）
  const out = compileContext({ name: "PM", capability: "work", persona: {} }, markdown, { proactive: false });
  assert.ok(out.memoryChars > 6000, `6.6KB 记忆不应被裁，实际 ${out.memoryChars}`);
  assert.ok(out.memoryChars <= BOT_INJECT_CHARS);
  assert.match(out.system, /invoice|发票/);
});

await test("上下文：带上当前项目与当前时间，路径类工具不用猜根目录", () => {
  const out = compileContext(
    { name: "PM", capability: "read", persona: {} },
    "",
    { proactive: false, workspace: "demo（/tmp/demo）", now: new Date(2026, 10, 22, 9, 30).getTime() },
  );
  assert.match(out.system, /当前项目：demo/);
  assert.match(out.system, /相对于它/);
  assert.match(out.system, /现在：2026/);
  assert.ok(out.sectionChars.workspace > 0);
});

await test("记忆检索：本轮问题命中的条目先上浮（只改排序，不改门槛）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-recall-"));
  const mem = createMemory({ dir });
  mem.entryUpsert({ layer: "L4", title: "发布流程", body: "先跑 e2e 再发版" });
  mem.entryUpsert({ layer: "L4", title: "发票目录", body: "发票统一放 finance/" });
  const plain = mem.inject({ maxChars: 8000 });
  const asked = mem.inject({ maxChars: 8000, query: "发票" });
  assert.ok(plain.markdown.includes("发票"));
  const matched = asked.items.find((i) => i.included && i.title === "发票目录");
  assert.match(matched?.reason || "", /命中本轮问题/, "台账要能看出为什么它先上浮");
  const firstEntry = asked.markdown.split("\n").find((l) => l.startsWith("- "));
  assert.match(firstEntry, /发票目录/);
  mem.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
});

await test("思考档：只改轮数与工具轮温度，不改 token 上限", () => {
  assert.equal(effortPolicy("quick").rounds, 4);
  assert.equal(effortPolicy("").rounds, 8);
  assert.equal(effortPolicy("deep").rounds, 12);
  assert.ok(effortPolicy("deep").temperature < effortPolicy("").temperature);
  assert.equal(effortPolicy("nonsense").label, "标准");
});


await test("计划：进 system prompt，步骤状态可见", () => {
  const out = compileContext(
    { name: "PM", capability: "work", persona: {} },
    "",
    { proactive: false, plan: { goal: "修登录", steps: [{ text: "看日志", status: "doing" }, { text: "改代码", status: "todo" }] } },
  );
  assert.match(out.system, /你手上的计划（修登录）/);
  assert.match(out.system, /1\. \[doing\] 看日志/);
  assert.match(out.system, /2\. \[todo\] 改代码/);
  assert.ok(out.sectionChars.plan > 0);
});
