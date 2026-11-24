import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import { resolveMentions, peerMentionNote, resolveHandoffTarget, handoffPrompt } from "../../electron/bot/peer-note.mjs";

const BOTS = [
  { id: "b1", name: "PM · 项目经理" },
  { id: "b2", name: "DE-A · 前端" },
  { id: "b3", name: "SE · 后端" },
];

await test("1:1 里 @ 到自己：不算目标（自己不需要地址）", () => {
  assert.deepEqual(resolveMentions([{ id: "b1", name: "PM" }], BOTS, { selfId: "b1" }), []);
  assert.equal(peerMentionNote([{ id: "b1" }], BOTS, { selfId: "b1" }), "");
});

await test("1:1 里 @ 到别人：给 id + 名字 + 怎么问", () => {
  const hits = resolveMentions([{ id: "b2" }], BOTS, { selfId: "b1" });
  assert.deepEqual(hits, [{ id: "b2", name: "DE-A · 前端" }]);
  const note = peerMentionNote([{ id: "b2" }], BOTS, { selfId: "b1" });
  assert.match(note, /DE-A · 前端（b2）/);
  assert.match(note, /ask_bot/);
  assert.match(note, /handoff_to_bot/);
  assert.match(note, /不要冒充它说话/);
});

await test("不存在的 id / 重复 / 超过 4 个都会被裁掉", () => {
  const many = ["b2", "b2", "b3", "nope", "b9", "b7"].map((id) => ({ id }));
  const hits = resolveMentions(many, BOTS, { selfId: "b1" });
  assert.deepEqual(hits.map((x) => x.id), ["b2", "b3"]);
  const four = [{ id: "b2" }, { id: "b3" }, { id: "b4" }, { id: "b5" }, { id: "b6" }];
  const bots = [...BOTS, ...["b4", "b5", "b6"].map((id) => ({ id, name: id }))];
  assert.equal(resolveMentions(four, bots, { selfId: "b1" }).length, 4);
});

await test("容错：mentions / bots 不是数组时不炸", () => {
  assert.deepEqual(resolveMentions(null, BOTS), []);
  assert.deepEqual(resolveMentions([{ id: "b2" }], null), []);
  assert.equal(peerMentionNote(undefined, undefined), "");
});

await test("交接目标：自己 / 不存在 / 空值都不算", () => {
  assert.equal(resolveHandoffTarget({ to: "b1" }, BOTS, { selfId: "b1" }), null);
  assert.equal(resolveHandoffTarget({ to: "zz" }, BOTS, { selfId: "b1" }), null);
  assert.equal(resolveHandoffTarget(null, BOTS, { selfId: "b1" }), null);
  assert.equal(resolveHandoffTarget({ to: "b3" }, BOTS, { selfId: "b1" })?.name, "SE · 后端");
  // 也认 toId 写法
  assert.equal(resolveHandoffTarget({ toId: "b2" }, BOTS, { selfId: "b1" })?.id, "b2");
});

await test("喂给目标的输入：问 / 交接两种框法，不伪装成 owner", () => {
  const ask = handoffPrompt({ kind: "question", task: "首页接口改完了吗", reason: "要发版" }, "PM");
  assert.match(ask, /^\[PM 问你\]：首页接口改完了吗；原因：要发版/);
  assert.match(ask, /echo 一句回答就够/);
  const give = handoffPrompt({ kind: "handoff", task: "改副标题" }, "PM");
  assert.match(give, /^\[PM 把这件事交给你\]：改副标题/);
  // 兜底：没写 kind 按问处理，超长会截断
  const fallback = handoffPrompt({ task: "x".repeat(900) }, "PM");
  assert.match(fallback, /^\[PM 问你\]/);
  assert.ok(fallback.length < 700);
});
