/**
 * harness.db 往返自检：node:sqlite + WAL。
 *
 *   npm run db:selftest
 *
 * 覆盖：
 *  1. 写入 → flush → 重新打开，数据与原状态一致
 *  2. undefined / boolean 参数归一化（老状态里常见，node:sqlite 会直接拒收）
 *  3. WAL 文件存在；close() 后合并回主库，单文件即可备份
 *  4. 空库首次打开、二次打开都可用（迁移幂等）
 *  5. onTranscript 钩子：新增 / 改写消息、新增事件都会同步给 L1 索引
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { openDb, SCHEMA } from "../electron/db.mjs";

const results = [];
const ok = (name, detail) => { results.push({ name, detail, ok: true }); console.log(`✓ ${name} · ${detail}`); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-db-selftest-"));
try {
  // ── 0. 兼容旧库：sql.js 写出来的文件必须能直接打开 ────────────────
  //     这是真实升级路径：老用户的 harness.db 就是 sql.js 的 export() 产物。
  const SQL = await initSqlJs({ locateFile: (f) => path.join(process.cwd(), "node_modules/sql.js/dist", f) });
  const legacy = new SQL.Database();
  legacy.run(SCHEMA);
  const columns = SCHEMA.match(/CREATE TABLE IF NOT EXISTS todos \(([^)]*)\)/)[1]
    .split(",").map((c) => c.trim().split(/\s+/)[0]).join(",");
  legacy.run(
    // 列数跟着 SCHEMA 走，别写死：todos 加过 mission_state / bot_id，写死会静默错位
    `INSERT INTO todos (${columns}) VALUES (${columns.split(",").map(() => "?").join(",")})`,
    ["t-old", "#0", "旧库里的任务", "", "[]", "done", null, "P2", "", null, "[]", "[]", "[]", 0, 0, dir, 11, 12, 0, null, "task", null, null],
  );
  legacy.run("INSERT INTO meta VALUES ('seq', '150')");
  fs.writeFileSync(path.join(dir, "harness.db"), Buffer.from(legacy.export()));
  legacy.close();
  ok("旧库文件", "sql.js export 产物已就位");

  // ── 1. 首次打开 + 写入 ────────────────────────────────────────────
  const db = await openDb(dir);
  assert.equal(db.state.todos.length, 1, "应能读出旧库里的任务");
  assert.equal(db.state.todos[0].title, "旧库里的任务");
  assert.ok(db.state.seq >= 150, "seq 应至少是旧库里的值（thread 迁移会继续递增）");
  ok("旧库升级", "旧 todos / meta 直接可读，无需手工迁移");
  const file = db.file;
  assert.ok(fs.existsSync(file), "首次打开应创建 harness.db");
  ok("首次打开", path.basename(file));

  db.state.projects.push({
    id: "p1", name: "demo", path: dir, desc: "", color: "slate", status: "in_progress",
    createdAt: 1, lastOpenedAt: 2, alias: "",
  });
  db.state.todos.push({
    id: "t1", key: "#1", title: "往返", desc: "", acceptance: ["a"], status: "queued",
    agentId: null, priority: "P1", due: "", parentId: null, tags: ["x"], subtasks: [],
    blockedBy: [], missingWriteback: false, lastRunFailed: false, cwd: dir, projectId: "p1",
    kind: "task", missionState: null, createdAt: 3, updatedAt: 4,
  });
  db.state.threads.push({ id: "th1", todoId: "t1", title: "往返", projectId: "p1", project: "", agentId: null, createdAt: 5, updatedAt: 6, model: "", modelName: "", effort: "", kind: "chat" });
  db.state.messages.push({
    id: "m1", threadId: "th1", todoId: "t1", runId: null, role: "user", kind: "text",
    content: "hello", injected: false, createdAt: 7, delivery: null, context: { a: 1 },
  });
  // 一次运行的可读产出：只存在内存里的话，重启后「这次跑出了什么」就没了
  db.state.runs.push({
    id: "r1", todoId: "t1", agentId: "a1", status: "failed", trigger: "assign",
    startedAt: 10, endedAt: 20, cost: 0, tokens: null, error: "boom", cwd: "", branch: null,
    hostId: null, createdAt: 10, kind: "worker",
    result: "TypeError: x is not a function", resultSource: "error", resultTruncated: true, resultAt: 20,
  });
  // undefined / boolean：不能把整批写坏
  db.state.events.push({ id: "e1", ts: 8, type: "test", text: undefined });
  db.state.pluginKv.push({ pluginId: "ai.cockpit.notes", key: "k", value: { nested: true }, updatedAt: 9 });
  db.state.settings = { ...db.state.settings, theme: "dark" };
  db.state.seq = 200;

  db.flush();
  assert.ok(fs.existsSync(`${file}-wal`) || fs.statSync(file).size > 0, "flush 后应有落盘结果");
  ok("写入 + flush", `${(fs.statSync(file).size / 1024).toFixed(0)} KB`);

  // ── 2. 重新打开校验 ──────────────────────────────────────────────
  db.close();
  const again = await openDb(dir);
  assert.equal(again.state.todos.length, 2, "旧库 1 条 + 新增 1 条");
  const roundTrip = again.state.todos.find((t) => t.id === "t1");
  assert.ok(roundTrip, "新增的 t1 应该落盘");
  assert.equal(roundTrip.missionState, null);
  assert.deepEqual(roundTrip.tags, ["x"]);
  assert.equal(again.state.messages[0].content, "hello");
  assert.deepEqual(again.state.messages[0].context, { a: 1 });
  assert.equal(again.state.events[0].type, "test");
  assert.equal(again.state.events[0].text, null, "undefined 应归一化成 null，而不是让整批写入失败");
  const runRt = again.state.runs.find((r) => r.id === "r1");
  assert.equal(runRt?.result, "TypeError: x is not a function", "runs.result 要能往返（重启后还能看这次跑出了什么）");
  assert.equal(runRt?.resultSource, "error", "runs.result_source 要能往返（来源不能丢）");
  assert.equal(runRt?.resultTruncated, true, "runs.result_truncated 要能往返");
  assert.equal(runRt?.resultAt, 20, "runs.result_at 要能往返");
  assert.deepEqual(again.state.pluginKv[0].value, { nested: true });
  assert.equal(again.state.settings.theme, "dark");
  assert.equal(again.state.seq, 200);
  ok("重新打开", "todos / messages / events / plugin_kv / settings / seq 全部一致");

  // ── 3. addMessage / 事件 API 仍走同一套落盘 ──────────────────────
  const msg = again.addMessage("th1", null, "assistant", "text", "第二段");
  again.addEvent("test.add", "second");
  again.flush();
  const third = await openDb(dir);
  assert.equal(third.state.messages.length, 2);
  assert.equal(third.state.messages.find((m) => m.id === msg.id)?.content, "第二段");
  assert.ok(third.state.events.some((e) => e.type === "test.add"));
  ok("addMessage / addEvent", "增量 API 与全量落盘一致");

  // ── 4. 关闭后单文件可备份（WAL 已合并）──────────────────────────
  third.close();
  assert.ok(!fs.existsSync(`${file}-wal`) || fs.statSync(`${file}-wal`).size === 0, "close() 后 -wal 应为空");
  const copy = path.join(dir, "backup.db");
  fs.copyFileSync(file, copy);
  process.env.COCKPIT_SELFTEST_DIR = dir;
  const { DatabaseSync } = await import("node:sqlite");
  const probe = new DatabaseSync(copy);
  const n = probe.prepare("SELECT COUNT(*) AS n FROM messages").get().n;
  probe.close();
  assert.equal(n, 2, "单独复制 harness.db 应包含全部数据");
  ok("单文件备份", `copy 后仍能读到 ${n} 条消息`);

  // ── 5. onTranscript：L1 索引钩子（主进程靠它增量维护 bigram 索引）────
  const indexed = [];
  const hooked = await openDb(dir, { onTranscript: (row) => indexed.push(row) });
  const hMsg = hooked.addMessage("th1", null, "user", "text", "钩子要抓到这条");
  hooked.updateMessage(hMsg.id, { content: "钩子抓到了改写后的内容" });
  hooked.addEvent("test.index", "钩子也要抓事件");
  hooked.flush();
  hooked.close();
  assert.ok(
    indexed.some((r) => r.kind === "message" && r.refId === hMsg.id && r.text.includes("改写后")),
    "updateMessage 改写正文时应重新同步索引",
  );
  assert.ok(
    indexed.some((r) => r.kind === "event" && /钩子也要抓事件/.test(r.text)),
    "addEvent 应同步索引（带 type 前缀）",
  );
  ok("onTranscript 钩子", `新增 / 改写 / 事件各触发一次（共 ${indexed.length} 行）`);

  // ── bot_turns / threads 显式列序 ──────────────────────────────
  // 这两张表的 todo_id/proposal（bot_turns）与 kind/bot_id（threads）都是后来 ALTER 追加的，
  // �理列序跟 CREATE 不一样；一旦退回按位置插入，persist 就会把
  // cost / created_at / todo_id / proposal 整体错位（todo_id 变成「{}」，起任务永远报「已经建过」。
  const rt = await openDb(dir);
  rt.state.threads.push({ id: "th-rt", todoId: null, title: "机器人会话", projectId: null, project: "", agentId: null,
    createdAt: 1, updatedAt: 2, model: "", modelName: "", effort: "", kind: "bot", botId: "bot-rt",
    digest: "更早的对话：用户问过 A，我答过 B" });
  rt.state.botTurns.push({ id: "bt-rt", botId: "bot-rt", channel: "local", trigger: { kind: "tick" }, input: "in",
    injected: [], reply: "out", decision: "silent", reason: "no-signal", runId: null, todoId: null,
    proposal: { title: "建议" }, cost: { total: 3 }, createdAt: 1700000000000, threadId: "th-rt",
    stopReason: "达到 8 轮工具上限", context: { chars: 1234, memory: 600, digest: true },
    routineProposal: { name: "早报", kind: "daily", prompt: "汇总" },
    handoff: { to: "b2", toName: "小B", task: "查部署" } });
  rt.state.botRevisions.push({ id: "rev-rt", botId: "bot-rt", at: 1700000000000, by: "owner", data: { name: "旧名字", persona: { mission: "旧职责" } } });
  rt.persist(); rt.flush(); rt.close();
  const rt2 = await openDb(dir);
  const turn = (rt2.state.botTurns || []).find((t) => t.id === "bt-rt");
  const th = rt2.state.threads.find((t) => t.id === "th-rt");
  assert.equal(turn?.todoId, null, "bot_turns.todo_id 不能被写成 cost 的 JSON");
  assert.deepEqual(turn?.proposal, { title: "建议" }, "bot_turns.proposal 要能往返");
  assert.deepEqual(turn?.cost, { total: 3 }, "bot_turns.cost 要能往返");
  assert.equal(turn?.createdAt, 1700000000000, "bot_turns.created_at 要能往返");
  assert.equal(turn?.threadId, "th-rt", "bot_turns.thread_id 要能往返（多会话靠它分组）");
  assert.equal(turn?.stopReason, "达到 8 轮工具上限", "bot_turns.stop_reason 要能往返");
  assert.deepEqual(turn?.context, { chars: 1234, memory: 600, digest: true }, "bot_turns.context 要能往返");
  assert.equal(turn?.routineProposal?.name, "早报", "bot_turns.routine_proposal 要能往返");
  assert.equal(turn?.handoff?.to, "b2", "bot_turns.handoff 要能往返");
  const rev = (rt2.state.botRevisions || []).find((r) => r.id === "rev-rt");
  assert.equal(rev?.data?.name, "旧名字", "bot_revisions 要能往返（人格历史）");
  assert.equal(th?.kind, "bot", "threads.kind 不能与 bot_id 写反");
  assert.equal(th?.botId, "bot-rt", "threads.bot_id 不能与 kind 写反");
  assert.match(th?.digest || "", /更早的对话/, "threads.digest 要能往返（长对话靠它）");
  rt2.close();
  ok("bot_turns / threads 列序", "todo_id / proposal / cost / created_at / thread_id 与 kind / bot_id 往返一致");

  const failed = results.filter((r) => !r.ok);
  console.log(`\nDB selftest: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
