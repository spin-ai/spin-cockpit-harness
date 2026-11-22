import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import { eventRowsFromGh, isFreshEvent, parseGhJson } from "../../electron/bot/github.mjs";

await test("GitHub 事件：坏 JSON 当空，PR / CI 都能变成去重行", () => {
  assert.deepEqual(parseGhJson("{"), []);
  assert.deepEqual(parseGhJson('{"a":1}'), []);
  const rows = eventRowsFromGh({
    botId: "b1",
    now: 1000,
    prs: [{ number: 12, title: "fix login", url: "https://x/pr/12" }, { title: "no number" }],
    runs: [{ databaseId: 99, workflowName: "ci", displayTitle: "build", url: "https://x/run/99" }, {}],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].key, "pr:12");
  assert.match(rows[0].title, /PR #12/);
  assert.equal(rows[1].key, "ci:99");
  assert.match(rows[1].title, /CI 失败/);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
});

await test("GitHub 事件：过期不再提醒", () => {
  const e = { at: 1000 };
  assert.equal(isFreshEvent(e, 2000), true);
  assert.equal(isFreshEvent(e, 1000 + 13 * 60 * 60 * 1000), false);
});
