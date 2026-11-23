/**
 * Items 台账（P0-3）的不变量：
 *
 * 1. 状态机 planned / working / waiting / needs_you / done / canceled；
 *    waiting 必须写清在等什么，完成 / 取消只改自己的台账（不动审批）；
 * 2. ask 最多 5 问 × 8 选项，recommended 每个问题只能一个；
 * 3. snooze（later / tomorrow / monday / week）上限 366 天；stale 3/5/7/14/never；
 * 4. 分页 50 条一页、翻页不重排、snoozed 不计入 needs-you；
 * 5. 带凭据的链接拒收；每个 bot 的编号各自从 #1 开始。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NOON, test } from "./_harness.mjs";
import { openDb } from "../../electron/db.mjs";
import {
  ITEM_PAGE_SIZE, applyItemSet, createItems, isSnoozed, isStale, itemCounts, itemLabel,
  normalizeAsk, normalizeItem, pageItems, snoozeUntil,
} from "../../electron/bot/items.mjs";

const fakeStore = () => ({ state: { botItems: [], botItemLinks: [], botItemEvents: [] }, seq: 0, persist() {}, nextId(p) { this.seq += 1; return `${p}${this.seq}`; } });

await test("item 校验：标题必填、状态合法、waiting 必须说等什么", () => {
  assert.equal(normalizeItem({}, { botId: "b1", now: NOON }).code, "item_title");
  assert.equal(normalizeItem({ title: "x", status: "nope" }, { botId: "b1", now: NOON }).code, "item_status");
  const waiting = normalizeItem({ title: "等 CI", status: "waiting" }, { botId: "b1", now: NOON });
  assert.equal(waiting.ok, false);
  assert.match(waiting.error, /waiting_on/);
  assert.equal(normalizeItem({ title: "等 CI", status: "waiting", waitingOn: "PR #12 的 CI" }, { botId: "b1", now: NOON }).ok, true);
  assert.equal(normalizeItem({ title: "x", stale: 9 }, { botId: "b1", now: NOON }).code, "item_stale");
  assert.equal(normalizeItem({ title: "x", stale: "never" }, { botId: "b1", now: NOON }).item.stale, 0);
});

await test("item 校验：ask 5 问 × 8 选项，recommended 每个问题最多一个", () => {
  assert.equal(normalizeAsk({ questions: Array.from({ length: 6 }, (_, i) => ({ text: `q${i}` })) }).ok, false);
  assert.equal(normalizeAsk({ questions: [{ text: "要合吗", options: Array.from({ length: 9 }, (_, i) => `o${i}`) }] }).ok, false);
  assert.equal(normalizeAsk({ questions: [{ text: "要合吗", options: [{ label: "合", recommended: true }, { label: "等", recommended: true }] }] }).ok, false);
  const ok = normalizeAsk({ context: "CI 红了", questions: [{ text: "要我修吗", options: [{ label: "修", recommended: true }, "先别动"] }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ask.questions[0].options, [{ label: "修", recommended: true }, { label: "先别动", recommended: false }]);
  assert.equal(normalizeAsk(null).ask, null);
});

await test("item 校验：带凭据的链接拒收，普通链接照收", () => {
  const bad = normalizeItem({ title: "看日志", links: [{ kind: "url", ref: "https://x.dev/log?access_token=abc" }] }, { botId: "b1", now: NOON });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /凭据/);
  const good = normalizeItem({ title: "看日志", links: [{ kind: "pr", ref: "https://github.com/o/r/pull/3", title: "PR #3" }] }, { botId: "b1", now: NOON });
  assert.equal(good.ok, true);
  assert.equal(good.links[0].kind, "pr");
});

await test("状态机：working → waiting（要写等什么）→ done 关单；重开清 snooze", () => {
  const created = normalizeItem({ title: "查 CI" }, { botId: "b1", now: NOON }).item;
  const working = applyItemSet(created, { status: "working" }, { now: NOON + 1000 });
  assert.equal(working.item.status, "working");
  assert.equal(working.item.closedAt, 0);
  const waiting = applyItemSet(working.item, { status: "waiting" }, { now: NOON + 2000 });
  assert.equal(waiting.ok, false, "没有 waiting_on 不能进 waiting");
  const waiting2 = applyItemSet(working.item, { status: "waiting", waitingOn: "PR #12 CI" }, { now: NOON + 2000 });
  assert.equal(waiting2.item.waitingOn, "PR #12 CI");
  const done = applyItemSet(waiting2.item, { status: "done" }, { now: NOON + 3000 });
  assert.equal(done.item.closedAt, NOON + 3000);
  const snoozed = applyItemSet({ ...done.item, snoozeUntil: NOON + 999999 }, { status: "working" }, { now: NOON + 4000 });
  assert.equal(snoozed.item.snoozeUntil, 0, "重开就不再 snooze");
  assert.equal(snoozed.item.closedAt, 0);
});

await test("snooze / stale：四种写法 + 上限 366 天", () => {
  const later = snoozeUntil("later", NOON);
  assert.ok(later > NOON && later <= NOON + 366 * 24 * 3600_000);
  const tomorrow = new Date(snoozeUntil("tomorrow", NOON));
  assert.equal(tomorrow.getHours(), 9);
  assert.equal(tomorrow.getDate() - new Date(NOON).getDate(), 1);
  const monday = new Date(snoozeUntil("monday", NOON));
  assert.equal(monday.getDay(), 1);
  assert.ok(snoozeUntil("week", NOON) > NOON);
  assert.equal(snoozeUntil("乱写", NOON), -1);
  assert.equal(snoozeUntil("", NOON), 0);
  assert.ok(snoozeUntil("2030-01-01 09:00", NOON) <= NOON + 366 * 24 * 3600_000, "上限 366 天");

  const item = { status: "working", stale: 7, createdAt: NOON, updatedAt: NOON };
  assert.equal(isStale(item, NOON + 6 * 24 * 3600_000), false);
  assert.equal(isStale(item, NOON + 8 * 24 * 3600_000), true);
  assert.equal(isStale({ ...item, status: "done" }, NOON + 8 * 24 * 3600_000), false);
});

await test("计数：needs_you 只算等你且没 snooze 的", () => {
  const items = [
    { status: "needs_you", createdAt: NOON, updatedAt: NOON },
    { status: "needs_you", createdAt: NOON, updatedAt: NOON, snoozeUntil: NOON + 60_000 },
    { status: "waiting", createdAt: NOON, updatedAt: NOON },
    { status: "done", createdAt: NOON, updatedAt: NOON },
    { status: "planned", createdAt: NOON, updatedAt: NOON, stale: 3 },
  ];
  const c0 = itemCounts(items, NOON + 30_000);
  assert.equal(c0.needsYou, 1, "snooze 中的那条不算等你");
  const c = itemCounts(items, NOON + 10 * 24 * 3600_000);
  assert.equal(c.needsYou, 2, "snooze 到点后又算等你");
  assert.equal(c.needs_you, 2);
  assert.equal(c.open, 4, "done 不算开着");
  assert.equal(c.done, 1);
  assert.equal(c.stale, 1, "只有显式设了 stale 天数的才计入陈旧");
  assert.equal(isSnoozed(items[1], NOON + 30_000), true);
});

await test("分页：200 条首屏只读 50，翻页不重排，size 封顶 100", () => {
  const items = Array.from({ length: 200 }, (_, i) => ({
    id: `it${i}`, botId: "b1", seq: i + 1, title: `活 ${i}`, status: i % 5 === 0 ? "done" : "planned",
    createdAt: NOON - i * 1000, updatedAt: NOON - i * 1000,
  }));
  const p1 = pageItems(items, { page: 1, now: NOON });
  assert.equal(p1.size, ITEM_PAGE_SIZE);
  assert.equal(p1.rows.length, 50);
  assert.equal(p1.total, 160, "done 默认不进列表");
  const p2 = pageItems(items, { page: 2, now: NOON });
  assert.equal(p2.rows.length, 50);
  assert.equal(p1.rows[0].id, pageItems(items, { page: 1, now: NOON }).rows[0].id, "同一页两次读顺序一致");
  assert.notEqual(p1.rows[0].id, p2.rows[0].id);
  assert.equal(pageItems(items, { size: 9999, now: NOON }).size, 100);
  assert.equal(pageItems(items, { page: 99, now: NOON }).page, 4, "越界页落到最后一页");
});

await test("读写：每个 bot 编号各自从 #1 开始，set / comment 落事件，列表按更新排", () => {
  const store = fakeStore();
  const l = createItems({ store, now: () => NOON });
  const a1 = l.add({ botId: "b1", title: "查 CI 为什么红", body: "看 e2e" });
  assert.equal(a1.ok, true);
  assert.equal(itemLabel(a1.item), "#1");
  const a2 = l.add({ botId: "b1", title: "补文档", status: "planned" });
  assert.equal(itemLabel(a2.item), "#2");
  const b1 = l.add({ botId: "b2", title: "另一个 bot 的活" });
  assert.equal(itemLabel(b1.item), "#1", "编号按 bot 各自从 1 开始");

  const set = l.set({ botId: "b1", item: "#1", status: "working" });
  assert.equal(set.ok, true);
  assert.equal(set.item.status, "working");
  const miss = l.set({ botId: "b2", item: "#9", status: "done" });
  assert.equal(miss.ok, false, "找不到就是找不到（不跨 bot 猜）");

  l.comment({ botId: "b1", item: "#1", text: "定位到 e2e 是 flaky" });
  const detail = l.get({ botId: "b1", item: "#1" });
  assert.equal(detail.events.at(-1).text, "定位到 e2e 是 flaky");
  assert.equal(detail.label, "#1");

  const list = l.list({ botId: "b1" });
  assert.equal(list.total, 2);
  assert.equal(list.rows[0].label, "#1", "刚更新的排在前面");
  assert.equal(list.counts.working, 1);
  assert.equal(l.countsByBot().b1.open, 2);
});

await test("读写：ask 落库带 askedAt；answer 评论把卡片标成 answered", () => {
  const store = fakeStore();
  const l = createItems({ store, now: () => NOON });
  const res = l.add({
    botId: "b1", title: "要不要合 PR #12", status: "needs_you",
    ask: { context: "CI 绿了", questions: [{ text: "合吗", options: [{ label: "合", recommended: true }, "等"] }] },
  });
  assert.equal(res.ok, true);
  assert.equal(res.item.ask.askedAt, NOON);
  assert.equal(res.item.ask.questions[0].options[0].recommended, true);
  const answered = l.comment({ botId: "b1", item: "#1", text: "合", author: "owner", kind: "answer" });
  assert.equal(answered.item.ask.status, "answered");
  assert.equal(answered.item.ask.answer, "合");
});

await test("落库：三张表在 openDb → flush → 重开后逐字段一致", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-items-"));
  const db = await openDb(dir);
  const l = createItems({ store: db, now: () => NOON });
  const added = l.add({
    botId: "b1", title: "查 CI 为什么红", body: "看 e2e 日志", status: "waiting", waitingOn: "PR #12 CI",
    stale: 7, links: [{ kind: "pr", ref: "https://github.com/o/r/pull/12", title: "PR #12" }],
    ask: { context: "CI 绿了", questions: [{ text: "要我合吗", options: [{ label: "合", recommended: true }, "等"] }] },
  });
  assert.equal(added.ok, true);
  l.comment({ botId: "b1", item: "#1", text: "定位到 flaky" });
  db.flush();
  db.close();
  const again = await openDb(dir);
  try {
    assert.equal(again.state.botItems.length, 1);
    const row = again.state.botItems[0];
    assert.equal(row.title, "查 CI 为什么红");
    assert.equal(row.status, "waiting");
    assert.equal(row.waitingOn, "PR #12 CI");
    assert.equal(row.stale, 7);
    assert.equal(row.ask.questions[0].options[0].recommended, true);
    assert.equal(again.state.botItemLinks[0].kind, "pr");
    assert.equal(again.state.botItemEvents.length, 2, "created + comment 两条事件");
    assert.equal(again.state.botItemEvents.at(-1).text, "定位到 flaky");
  } finally {
    again.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
