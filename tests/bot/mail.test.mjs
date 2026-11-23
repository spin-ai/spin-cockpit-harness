/**
 * 群内同事消息（peer mail）：只送到人、只在同一话题、只送 pending；
 * prompt 里要说明是谁问的，且不冒充 owner。
 */

import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import { mailPrompt, pendingMailsFor } from "../../electron/bot/mail.mjs";

const MAILS = [
  { id: "m1", fromBotId: "a", toBotId: "b", groupId: "g", threadId: "t1", kind: "question", body: "CI 为什么红", status: "pending" },
  { id: "m2", fromBotId: "a", toBotId: "b", groupId: "g", threadId: "t1", kind: "handoff", body: "改一下 README", status: "answered" },
  { id: "m3", fromBotId: "c", toBotId: "b", groupId: "g", threadId: null, kind: "status", body: "发布完成", status: "pending" },
  { id: "m4", fromBotId: "a", toBotId: "d", groupId: "g", threadId: "t1", kind: "question", body: "不是给 b 的", status: "pending" },
];

await test("待回复：按群 / 话题 / 收件人 / pending 过滤；默认话题用 main", () => {
  assert.deepEqual(pendingMailsFor(MAILS, { groupId: "g", threadId: "t1", toBotId: "b" }).map((m) => m.id), ["m1"]);
  assert.deepEqual(pendingMailsFor(MAILS, { groupId: "g", threadId: "", toBotId: "b" }).map((m) => m.id), ["m3"]);
  assert.deepEqual(pendingMailsFor(MAILS, { groupId: "g", threadId: "t1", toBotId: "d" }).map((m) => m.id), ["m4"]);
  assert.deepEqual(pendingMailsFor(MAILS, { groupId: "g", threadId: "t1", toBotId: "b", excludeIds: ["m1"] }), []);
});

await test("prompt：带发送者与问题，标注只是背景，且能截断", () => {
  const text = mailPrompt([MAILS[0]], { a: "PM · 项目经理" });
  assert.match(text, /PM · 项目经理 问你/);
  assert.match(text, /CI 为什么红/);
  assert.match(text, /只作背景/);
  assert.ok(text.length <= 1200);
  assert.equal(mailPrompt([], {}), "");
});
