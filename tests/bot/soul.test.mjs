/**
 * SOUL.md 是人格 / 职责的只读镜像：它必须和档案同构，且空字段不产生空行噪声。
 */

import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import { soulMarkdown } from "../../electron/bot/index.mjs";

await test("SOUL.md：职责 / 语气 / Never / 能力都进来，且声明只读", () => {
  const text = soulMarkdown({
    name: "PM · 项目经理", persona: {
      mission: "盯住发布节奏",
      tone: "短句", address: "叫你「你」", length: "1–2 句", habit: "先给结论",
      duty: { goal: "按时上线", scope: "首页", deliverable: "周报", report: "一句话", forbidden: "不改代码" },
      boundary: "不评价作息",
    },
    capability: "work", team: "产品", skills: ["status-brief"],
  });
  assert.match(text, /# PM · 项目经理/);
  assert.match(text, /一句话职责：盯住发布节奏/);
  assert.match(text, /## 职责卡/);
  assert.match(text, /- 目标：按时上线/);
  assert.match(text, /## Never/);
  assert.match(text, /- 不改代码/);
  assert.match(text, /- 不评价作息/);
  assert.match(text, /## 能力/);
  assert.match(text, /可执行/);
  assert.match(text, /- 技能：status-brief/);
  assert.match(text, /只读镜像；手改不回写/);
});

await test("SOUL.md：没写职责时明说，不编造", () => {
  const text = soulMarkdown({ name: "空白", persona: {} });
  assert.match(text, /还没有写/);
  assert.equal(text.includes("## 职责卡"), false);
  assert.equal(text.includes("## Never"), false);
  assert.match(text, /只读/);
});
