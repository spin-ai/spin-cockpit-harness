/**
 * 静默标记（P0-1）的不变量：
 *
 * 1. 宽松匹配三种装饰：`**NO_REPLY**` / `NO_REPLY.` / `> NO_REPLY`，以及代码围栏包住；
 * 2. 被点名时标记前的正文要发出去；没被点名时正文只留审计；
 * 3. `decision=quiet` 落库（正文在，可审计），notifyDecision 对它一律不弹。
 */
import assert from "node:assert/strict";
import { NOON, makeBot, test } from "./_harness.mjs";
import { QUIET_MARKER, isQuiet, quietOf } from "../../electron/bot/quiet.mjs";
import { notifyAllowed, notifyDecision } from "../../electron/bot/notify.mjs";
import { createBots } from "../../electron/bot/index.mjs";

await test("静默：三种装饰 + 代码围栏都算标记", () => {
  assert.equal(QUIET_MARKER, "NO_REPLY");
  for (const text of ["NO_REPLY", "**NO_REPLY**", "NO_REPLY.", "> NO_REPLY", "  no_reply  ", "```\nNO_REPLY\n```", "```text\nNO_REPLY\n```", "- NO_REPLY"]) {
    const q = quietOf(text);
    assert.equal(q.quiet, true, `「${text}」应当静默`);
    assert.equal(q.text, "", "静默时不该再发正文");
  }
});

await test("静默：正文里的提及不算标记（标记后面还有话 / 不在结尾）", () => {
  assert.equal(isQuiet("模型约定用 NO_REPLY 表示不说话。"), false);
  assert.equal(isQuiet("NO_REPLY 之后就结束了"), false);
  const q = quietOf("我把 CI 修好了，NO_REPLY");
  assert.equal(q.quiet, true, "标记在结尾 = 静默");
  assert.equal(q.body, "我把 CI 修好了，", "标记前的正文要留下（审计）");
});

await test("静默：被点名时保留标记前的正文并原样发出", () => {
  const q = quietOf("CI 红了，是 flaky 的 e2e。\n\n**NO_REPLY**", { addressed: true });
  assert.equal(q.quiet, false);
  assert.equal(q.text, "CI 红了，是 flaky 的 e2e。");
  const empty = quietOf("NO_REPLY.", { addressed: true });
  assert.equal(empty.quiet, true, "被点名但只有标记 = 没什么要补充");
});

await test("静默：通知层直接返回，不进未读也不弹", () => {
  assert.equal(notifyAllowed({}, "quiet"), false);
  const verdict = notifyDecision({ reply: "有正文也不弹", kind: "quiet", now: NOON, unread: 0 });
  assert.equal(verdict.send, false);
  assert.match(verdict.reason, /静默/);
});

await test("静默：主动开口落 decision=quiet，正文留库但不镜像进会话", async () => {
  const store = { state: { bots: [], botTurns: [], routines: [], messages: [], threads: [] }, persist() {}, addMessage: () => { throw new Error("quiet 不该镜像进会话"); } };
  let calls = 0;
  const b = createBots({
    store, now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    chat: async () => {
      calls += 1;
      return { text: "看着没什么事。\nNO_REPLY", usage: { totalTokens: 7 } };
    },
    key: () => "k",
  });
  b.ensureSeed();
  const saved = makeBot(b, { id: "bq1", name: "安静", capability: "read" });
  // 造一个非日程候选：最新一次失败运行
  store.state.runs = [{ id: "r1", todoId: null, status: "failed", agentId: "a1", startedAt: NOON - 120_000, endedAt: NOON - 60_000, createdAt: NOON - 120_000 }];
  store.state.todos = [];
  store.state.agents = [];
  const turns = await b.tick({ botId: saved.id, force: true });
  const turn = turns.at(-1);
  assert.equal(calls, 1);
  assert.equal(turn?.decision, "quiet");
  assert.match(turn.reason, /NO_REPLY/);
  assert.equal(turn.reply, "看着没什么事。", "正文仍落库，可审计");
  assert.equal(notifyDecision({ reply: turn.reply, kind: "quiet", now: NOON }).send, false);
});

await test("静默：被动回复里只给标记 → quiet；带正文 → replied 且去掉标记", async () => {
  const store = { state: { bots: [], botTurns: [] }, persist() {} };
  const mk = (text) => createBots({
    store, now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    chatStream: async () => ({ text }),
    key: () => "k",
  });
  const quietBots = mk("NO_REPLY");
  quietBots.ensureSeed();
  const qb = makeBot(quietBots, { id: "bq2" });
  const turn = await quietBots.reply(qb, "在吗");
  assert.equal(turn.decision, "quiet");
  assert.equal(turn.reply, "");

  const speakBots = mk("结论：CI 是 flaky。\n\n**NO_REPLY**");
  speakBots.ensureSeed();
  const sb = makeBot(speakBots, { id: "bq3" });
  const answered = await speakBots.reply(sb, "CI 为什么红？");
  assert.equal(answered.decision, "replied");
  assert.equal(answered.reply, "结论：CI 是 flaky。");
});
