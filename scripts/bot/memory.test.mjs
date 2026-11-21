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

// 记忆接线：真实记忆库注入正文，别人的私有条目进不来

const tmpMem = fs.mkdtempSync(path.join(os.tmpdir(), "bot-mem-"));

const realMem = createMemory({ dir: tmpMem });
realMem.entryUpsert({ layer: "L4", title: "共享结论", body: "提交前必须跑 typecheck" });
realMem.entryUpsert({ layer: "L4", title: "别人的私事", body: "只有另一个 bot 该知道", owner: "bot:other" });

const recallStore = { state: { bots: [], botTurns: [], todos: [{ id: "t1", title: "待输入", status: "waiting_input", confirmed: true }] }, persist() {} };

const captured = [];

const recallBots = createBots({
  store: recallStore,
  now: () => NOON,
  memory: () => realMem,
  chat: async (messages) => { captured.push(messages[0].content); return { text: "有一条待确认。", usage: { totalTokens: 5 } }; },
  chatStream: async () => ({ text: "好", usage: {} }),
  key: () => "k",
});
recallBots.ensureSeed();
recallBots.list()[0].intro = false;

await test("真记忆库接线：注入的是正文，且别的 bot 的私有条目不进来", async () => {
  await recallBots.tick({ botId: recallBots.list()[0].id });
  const system = captured.at(-1) || "";
  assert.match(system, /提交前必须跑 typecheck/, "共享条目的正文要进 system");
  assert.doesNotMatch(system, /只有另一个 bot 该知道/, "owner 不是自己的条目不能漏进来");
  realMem.close?.();
  fs.rmSync(tmpMem, { recursive: true, force: true });
});
