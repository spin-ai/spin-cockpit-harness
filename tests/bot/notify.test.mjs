import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOUR, MIN, NOON, at, bot, test } from "./_harness.mjs";
import { buildSystemPrompt, collectCandidates, createBots, gatesFor, quietActive, scoreCandidate, DEFAULT_POLICY } from "../../electron/bot/index.mjs";
import { parseSseDelta } from "../../electron/knowledge/ark.mjs";
import { createMemory } from "../../electron/memory/index.mjs";
import { hasSecret, redactSecrets } from "../../electron/redact.mjs";
import { similarity, suppressionReason } from "../../electron/bot/guard.mjs";
import { NOTIFY_MAX_CHARS, notifyDecision } from "../../electron/bot/notify.mjs";
import { WAIT_LIMIT_MS, describeRoutine, nextRunAt, normalizeRoutine, routineDue, todayAt } from "../../electron/bot/routine.mjs";

// 通知节流：打扰的量化规则

await test("通知：180 字截断、每小时 3 条、未读太多不叠加、静音不弹", () => {
  const now = at(12).getTime();
  const long = "很长的内容".repeat(40);
  const cut = notifyDecision({ reply: long, now });
  assert.equal(cut.send, true);
  assert.ok(cut.text.length <= NOTIFY_MAX_CHARS);
  assert.match(cut.reason, /截断/);
  assert.equal(notifyDecision({ reply: "x", now, sentAt: [now - 1000, now - 2000, now - 3000] }).send, false);
  assert.equal(notifyDecision({ reply: "x", now, unread: 6 }).send, false);
  assert.equal(notifyDecision({ reply: "x", now, unread: 6, kind: "todo.waiting_input" }).send, true, "需要你决定的仍可弹");
  assert.equal(notifyDecision({ reply: "x", now, mutedUntil: now + 1000 }).send, false);
  assert.equal(notifyDecision({ reply: "x", now, quiet: true }).send, false);
});
