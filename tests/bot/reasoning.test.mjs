/**
 * 思考档 → 网关推理字段：字段名各厂商不同，塞错会 400。
 * 这里守住三件事：
 *  1) 按模型家族选字段（Ark/豆包 thinking、OpenAI reasoning_effort、其它不给）
 *  2) 快速档尽量关思考（首字最快），深入档明确加大，标准档不动（用网关默认）
 *  3) 不认识的模型返回空对象，绝不瞎塞
 */

import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import { reasoningFamily, reasoningParams } from "../../electron/bot/reasoning.mjs";

await test("家族：豆包/Ark、OpenAI 推理模型、DeepSeek 与其它分开", () => {
  assert.equal(reasoningFamily("doubao-seed-1.6-thinking"), "ark");
  assert.equal(reasoningFamily("ep-20250101-abc"), "ark");
  assert.equal(reasoningFamily("o3-mini"), "openai");
  assert.equal(reasoningFamily("gpt-5-chat"), "openai");
  assert.equal(reasoningFamily("deepseek-v3.2"), "deepseek");
  assert.equal(reasoningFamily("qwen-max"), "none");
  assert.equal(reasoningFamily(""), "none");
});

await test("快速档：能关思考的模型直接关", () => {
  assert.deepEqual(reasoningParams({ model: "doubao-seed-1.6", effort: "quick" }).fields, { thinking: { type: "disabled" } });
  assert.deepEqual(reasoningParams({ model: "o3-mini", effort: "quick" }).fields, { reasoning_effort: "minimal" });
});

await test("深入档：明确加大推理", () => {
  assert.deepEqual(reasoningParams({ model: "doubao-seed-1.6", effort: "deep" }).fields, { thinking: { type: "enabled" } });
  assert.deepEqual(reasoningParams({ model: "o3-mini", effort: "deep" }).fields, { reasoning_effort: "high" });
});

await test("标准档 / 未知档 / 未知模型：一个字段都不加（用网关默认）", () => {
  assert.deepEqual(reasoningParams({ model: "doubao-seed-1.6", effort: "" }).fields, {});
  assert.deepEqual(reasoningParams({ model: "o3-mini", effort: "standard" }).fields, {});
  assert.deepEqual(reasoningParams({ model: "deepseek-v3.2", effort: "quick" }).fields, {});
  assert.deepEqual(reasoningParams({ model: "qwen-max", effort: "deep" }).fields, {});
  assert.deepEqual(reasoningParams({}).fields, {});
});

await test("大小写 / 带路径的模型名也认", () => {
  assert.equal(reasoningFamily("Doubao-Seed-1.6"), "ark");
  assert.deepEqual(reasoningParams({ model: "openai/o3-mini", effort: "quick" }).fields, { reasoning_effort: "minimal" });
});
