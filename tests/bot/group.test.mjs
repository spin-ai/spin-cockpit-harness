/**
 * 群聊路由：@ 的解析与投递。失败时应该是「没人回」或「明确报错」，
 * 不能退化成主管 + 第一个成员双答，也不能把代码块 / 路径里的 @ 当地址。
 */

import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import { compileContext, createBots } from "../../electron/bot/index.mjs";
import {
  openGroupAsks,
  settleGroupAsks,
  crossTopicDigest,
  groupAudience,
  groupContextLines,
  groupMarkdown,
  parseGroupMentions,
  replyMentions,
} from "../../electron/bot/group.mjs";

const MEMBERS = [
  { id: "pm", name: "PM · 项目经理", role: "supervisor", whoCanAsk: "group" },
  { id: "de", name: "DE-A · 前端", role: "worker", whoCanAsk: "group" },
  { id: "boss", name: "私人助理", role: "worker", whoCanAsk: "owner" },
];

await test("@ 解析：全名 / 短名 / 大小写都算同一个人；按最长匹配", () => {
  const full = parseGroupMentions("@DE-A · 前端 看一下", MEMBERS);
  assert.deepEqual(full.ids, ["de"]);
  const short = parseGroupMentions("@de-a 看一下", MEMBERS);
  assert.deepEqual(short.ids, ["de"]);
  assert.equal(short.mentions[0].word.length, 4);
});

await test("@ 解析：代码块 / 行内代码 / 引用 / 路径里的 @ 不叫醒人", () => {
  const text = [
    "看这段：",
    "```ts",
    "// @DE-A · 前端 在代码里",
    "```",
    "`@PM · 项目经理` 也是代码",
    "> @DE-A · 前端 引用",
    '他说「@DE-A · 前端 是名字」',
    "路径 @src/a.ts 和 @/tmp/b 不是地址",
  ].join("\n");
  const parsed = parseGroupMentions(text, MEMBERS);
  assert.deepEqual(parsed.ids, []);
  assert.equal(parsed.everyones, false);
});

await test("@ 解析：同名歧义要报出来，不猜一个人", () => {
  const members = [{ id: "a", name: "PM", whoCanAsk: "group" }, { id: "b", name: "PM · 项目经理", whoCanAsk: "group" }];
  const parsed = parseGroupMentions("@PM 谁来", members);
  assert.equal(parsed.ambiguous, true);
  assert.deepEqual(parsed.ids, []);
});

await test("投递：mentions 模式没 @ 到人 = 0 个收件人（不回退成主管+成员）", () => {
  const a = groupAudience({ text: "大家看下", members: MEMBERS, mode: { kind: "mentions" } });
  assert.deepEqual(a.ids, []);
  assert.equal(a.noOne, true);
});

await test("投递：@everyone 叫全体，但 owner-only 的 bot 不进群", () => {
  const a = groupAudience({ text: "@everyone 开会", members: MEMBERS, mode: { kind: "mentions" } });
  assert.deepEqual(a.ids, ["pm", "de"]);
  assert.equal(a.addressed, true);
});

await test("投递：all / bot 模式；固定成员不在群里要可读地失败", () => {
  const all = groupAudience({ text: "开始", members: MEMBERS, mode: { kind: "all" } });
  assert.deepEqual(all.ids, ["pm", "de"]);
  const fixed = groupAudience({ text: "开始", members: MEMBERS, mode: { kind: "bot", botId: "de" } });
  assert.deepEqual(fixed.ids, ["de"]);
  const gone = groupAudience({ text: "开始", members: MEMBERS, mode: { kind: "bot", botId: "missing" } });
  assert.deepEqual(gone.ids, []);
  assert.equal(gone.replierMissing, true);
});

await test("投递：开头的 @不存在 要作为 unknown 报出来", () => {
  const a = groupAudience({ text: "@nobody 看一下", members: MEMBERS, mode: { kind: "mentions" } });
  assert.deepEqual(a.unknown, ["nobody"]);
  assert.deepEqual(a.ids, []);
});

await test("成员回复里的 @：只唤醒本机其他成员，跳过自己 / everyone / 代码 / 引用", () => {
  const text = "@PM · 项目经理 你定；`@DE-A · 前端` 不用看；@everyone 别叫";
  assert.deepEqual(replyMentions(text, MEMBERS, "de"), ["pm"]);
  assert.deepEqual(replyMentions("@DE-A · 前端 我自己", MEMBERS, "de"), []);
  assert.deepEqual(replyMentions("@none 谁", MEMBERS, "de"), []);
});

await test("GROUP.md：群名 / 共识 / 成员 / 话题 / 回复规则都在，声明只读", () => {
  const text = groupMarkdown(
    { name: "发布群", memo: "本周只修 P0", threads: [{ id: "t1", title: "发布检查" }], replyMode: { kind: "mentions", pace: "serial" } },
    [{ id: "b1", name: "PM · 项目经理", duty: "盯发布" }, { id: "b2", name: "DE-A · 前端" }],
  );
  assert.match(text, /# 发布群/);
  assert.match(text, /群共识：本周只修 P0/);
  assert.match(text, /PM · 项目经理：盯发布/);
  assert.match(text, /发布检查/);
  assert.match(text, /@ 谁谁回/);
  assert.match(text, /依次/);
  assert.match(text, /只读镜像；手改不回写/);
});

await test("群话题会话不进 1:1 的 Chats 列表", () => {
  const state = {
    bots: [{ id: "b1", name: "B", persona: {}, kind: "bot", capability: "read" }],
    threads: [
      { id: "th-home", kind: "bot", botId: "b1", title: "我的会话", createdAt: 1, updatedAt: 2 },
      { id: "th-group", kind: "bot", botId: "b1", title: "项目群 · 主话题", createdAt: 3, updatedAt: 4 },
    ],
    messages: [{ id: "m1", threadId: "th-home", role: "user", content: "你好", createdAt: 2 }],
    botGroups: [{ id: "g1", name: "项目群", memberIds: ["b1"], sessions: { main: { b1: "th-group" } } }],
    botTurns: [],
  };
  const store = { state, persist() {} };
  const bots = createBots({ store, now: () => 5, memory: () => ({ inject: () => ({ items: [] }) }), key: () => "k" });
  assert.deepEqual(bots.chats("b1").map((c) => c.id), ["th-home"]);
});

await test("跨话题摘要：只看别的话题，排除自己 / 系统行；进 system prompt", () => {
  const group = { threads: [{ id: "t1", title: "发布" }] };
  const messages = [
    { threadId: "t1", author: "owner", text: "发布几点？" },
    { threadId: "t1", author: "bot", botName: "PM", text: "今晚 8 点" },
    { threadId: "t1", author: "system", text: "【交接】不该进" },
    { threadId: "main", author: "owner", text: "主线这句不该进" },
  ];
  const digest = crossTopicDigest(group, messages, "main");
  assert.match(digest, /发布/);
  assert.match(digest, /今晚 8 点/);
  assert.equal(digest.includes("不该进"), false);
  const ctx = compileContext({ id: "b", name: "B", persona: {}, capability: "read" }, "", { inGroup: true, groupDigest: digest });
  assert.match(ctx.system, /其他话题最近/);
  assert.ok(ctx.sectionChars.groupDigest > 0);
});

await test("群共识进 system prompt：成员都看得到，空则不注入", () => {
  const base = { id: "b", name: "成员", persona: {}, capability: "read" };
  const withMemo = compileContext(base, "", { inGroup: true, groupMemo: "本周只修 P0，不改首页视觉" });
  assert.match(withMemo.system, /群共识/);
  assert.match(withMemo.system, /P0/);
  assert.ok(withMemo.sectionChars.groupMemo > 0);
  const empty = compileContext(base, "", { inGroup: true, groupMemo: "" });
  assert.equal(empty.system.includes("群共识"), false);
  assert.equal(empty.sectionChars.groupMemo, 0);
});

await test("群聊上下文：带上一轮别人的话，不带自己的，不带本轮未说的", () => {
  const messages = [
    { seq: 1, author: "owner", text: "第一句" },
    { seq: 2, author: "bot", botId: "pm", botName: "PM", text: "我先说" },
    { seq: 3, author: "bot", botId: "de", botName: "DE-A", text: "我跟" },
    { seq: 4, author: "owner", text: "第二句" },
    { seq: 5, author: "bot", botId: "pm", botName: "PM", text: "本轮主管" },
  ];
  const ctx = groupContextLines(messages, { ownerSeq: 4, botId: "pm" });
  assert.match(ctx, /第一句|我先说/);
  assert.match(ctx, /第一句/, "owner 的历史也在（作为群里的共识）");
  assert.match(ctx, /DE-A：我跟/);
  assert.equal(ctx.includes("本轮主管"), false, "还没说的不能拼进去");
  assert.equal(ctx.includes("PM：我先说"), false, "自己的话不重复拼");
});

await test("群提问卡：开着的才列出来 / 人一说话结掉这个话题 / 超期不列", () => {
  const now = 1_700_000_000_000;
  const H = 3600 * 1000;
  const msgs = [
    { id: "g1", groupId: "grp", threadId: "", author: "bot", botId: "b1", botName: "PM", text: "要改吗？", createdAt: now,
      meta: { ask: { text: "要改吗？", status: "open", createdAt: now } } },
    { id: "g2", groupId: "grp", threadId: "th2", author: "bot", botId: "b2", botName: "DE-A", text: "另一话题", createdAt: now + 1000,
      meta: { ask: { text: "另一话题", status: "open", createdAt: now + 1000 } } },
    { id: "g3", groupId: "grp", threadId: "", author: "bot", botId: "b2", text: "划掉的", createdAt: now,
      meta: { ask: { text: "划掉的", status: "dismissed", createdAt: now } } },
    { id: "g4", groupId: "grp", threadId: "", author: "bot", botId: "b1", text: "旧的", createdAt: now - 8 * 24 * H,
      meta: { ask: { text: "旧的", status: "open", createdAt: now - 8 * 24 * H } } },
    { id: "g5", groupId: "grp", threadId: "", author: "owner", text: "没有卡", createdAt: now, meta: null },
  ];
  const open = openGroupAsks(msgs, { now });
  assert.deepEqual(open.map((a) => a.messageId), ["g2", "g1"], "新的在前；划掉 / 超期 / 没卡的不列");
  assert.equal(open[1].botName, "PM", "卡上要能标出是谁问的");
  const changed = settleGroupAsks(msgs, { groupId: "grp", threadId: "", status: "answered", now: now + 2000 });
  assert.equal(changed, 1, "只结这个话题里开着的");
  assert.equal(msgs[0].meta.ask.status, "answered");
  assert.equal(msgs[0].meta.ask.answeredAt, now + 2000);
  assert.equal(msgs[1].meta.ask.status, "open", "别的话题不动");
  assert.equal(msgs[3].meta.ask.status, "expired", "超期的标 expired，不算被答掉（和 1:1 askOpen 同口径）");
  assert.equal(settleGroupAsks(msgs, { groupId: "grp", threadId: "", now: now + 3000 }), 0, "已经是 answered / expired 的不重复计数");
});
