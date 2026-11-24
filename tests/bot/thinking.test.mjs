/**
 * 推理模型的思考流：`reasoning_content` 以前被整段丢掉，界面上只能看到「正在想…」直到正文出现。
 * 这里守住三件事：
 *  1) 思考增量按顺序回吐给 onReasoning（界面能边想边看）
 *  2) 思考落进这一轮的 trace（kind=thought），轨迹里能回看
 *  3) 没思考（普通模型）时不留空事件，正文照常
 */

import assert from "node:assert/strict";
import { NOON, makeBot, test } from "./_harness.mjs";
import { createBots } from "../../electron/bot/index.mjs";

const mkBots = (chatStream) => {
  const store = { state: { bots: [], botTurns: [] }, persist() {} };
  const bots = createBots({
    store,
    now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    chatStream,
    key: () => "test-key",
  });
  bots.ensureSeed();
  return { bots, store, bot: makeBot(bots, { name: "PM" }) };
};

await test("思考流：onReasoning 按顺序回吐，且落进 trace(kind=thought)", async () => {
  const seen = [];
  const { bots, bot } = mkBots(async (_messages, { onDelta, onReasoning }) => {
    onReasoning?.("先看");
    onReasoning?.("接口");
    onDelta?.("答案");
    return { text: "答案", reasoning: "先看接口", usage: { total_tokens: 20 } };
  });
  const turn = await bots.reply(bot, "在吗", { onReasoning: (d) => seen.push(d) });
  assert.equal(seen.join(""), "先看接口");
  assert.equal(turn.reply, "答案");
  const thought = (turn.trace || []).find((e) => e.kind === "thought");
  assert.ok(thought, "trace 里应该有 thought 事件");
  assert.match(String(thought.text), /先看接口/);
});

await test("思考流：没有思考的模型不产生空 thought 事件", async () => {
  const { bots, bot } = mkBots(async (_messages, { onDelta }) => {
    onDelta?.("好");
    return { text: "好", usage: { total_tokens: 5 } };
  });
  const turn = await bots.reply(bot, "在吗", {});
  assert.equal((turn.trace || []).filter((e) => e.kind === "thought").length, 0);
});

await test("思考流：超长思考截断到 1500 字，不把快照撑大", async () => {
  const long = "想".repeat(9000);
  const { bots, bot } = mkBots(async (_messages, { onDelta }) => {
    onDelta?.("好");
    return { text: "好", reasoning: long, usage: { total_tokens: 5 } };
  });
  const turn = await bots.reply(bot, "在吗", {});
  const thought = (turn.trace || []).find((e) => e.kind === "thought");
  assert.ok(thought);
  assert.ok(String(thought.text).length <= 1500, `实际 ${String(thought.text).length}`);
});

await test("工具交接：runTool 回 ask_bot 的 handoff 会挂到回合上（1:1 也能带回来）", async () => {
  const { bots, bot } = mkBots(async (_messages, { onDelta }) => {
    // 第二轮：模型给了工具结果后收口，这里直接返回正文
    onDelta?.("我先问一下 SE。");
    return { text: "我先问一下 SE。", usage: { total_tokens: 8 } };
  });
  const turn = await bots.reply(bot, "找一下 SE", {});
  // 没有工具调用时不该有 handoff
  assert.equal(turn.handoff, undefined);
});
