/**
 * harness.db 落盘基准：sql.js（旧）vs node:sqlite + WAL（新）。
 *
 * 旧实现每次 persist 都是「DELETE 全表 → 逐行 INSERT → db.export() → writeFileSync」，
 * 新实现是「DELETE 全表 → 逐行 INSERT → COMMIT（WAL）」。
 * 这个脚本只量这一段，不加载 app。
 *
 *   npm run db:bench
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import initSqlJs from "sql.js";

const COUNTS = { todos: 120, runs: 400, messages: 4000, events: 200 };
const ROUNDS = 12;

const SCHEMA = `
CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT, status TEXT, created_at INTEGER);
CREATE TABLE runs (id TEXT PRIMARY KEY, todo_id TEXT, status TEXT, tokens_in INTEGER, tokens_out INTEGER, duration_ms INTEGER, created_at INTEGER);
CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT, created_at INTEGER);
CREATE TABLE events (id TEXT PRIMARY KEY, ts INTEGER, type TEXT, text TEXT);
`;

function seed() {
  const todos = Array.from({ length: COUNTS.todos }, (_, i) => [`t${i}`, `任务 ${i}`, "queued", 1700000000000 + i]);
  const runs = Array.from({ length: COUNTS.runs }, (_, i) => [`r${i}`, `t${i % COUNTS.todos}`, "done", 1200, 800, 5400, 1700000000000 + i]);
  const messages = Array.from({ length: COUNTS.messages }, (_, i) => [
    `m${i}`, `th${i % 40}`, i % 2 ? "assistant" : "user",
    `这是一条用于压测的消息内容 ${i}，长度接近真实对话里的一段话，用来避免测试数据过于理想化。`,
    1700000000000 + i,
  ]);
  const events = Array.from({ length: COUNTS.events }, (_, i) => [`e${i}`, 1700000000000 + i, "run.done", `事件 ${i}`]);
  return { todos, runs, messages, events };
}

function bench(fn) {
  const times = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const t0 = process.hrtime.bigint();
    fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return {
    p50: times[Math.floor(times.length / 2)],
    p95: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
    max: times[times.length - 1],
  };
}

const fmt = (n) => `${n.toFixed(1)} ms`;

const data = seed();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-db-bench-"));

// ── 旧：sql.js ─────────────────────────────────────────────────────
const SQL = await initSqlJs({ locateFile: (f) => path.join(process.cwd(), "node_modules/sql.js/dist", f) });
const legacyFile = path.join(dir, "legacy.db");
const legacy = new SQL.Database();
legacy.run(SCHEMA);

function persistLegacy() {
  legacy.run("BEGIN");
  for (const t of ["todos", "runs", "messages", "events"]) legacy.run(`DELETE FROM ${t}`);
  for (const row of data.todos) legacy.run("INSERT INTO todos VALUES (?,?,?,?)", row);
  for (const row of data.runs) legacy.run("INSERT INTO runs VALUES (?,?,?,?,?,?,?)", row);
  for (const row of data.messages) legacy.run("INSERT INTO messages VALUES (?,?,?,?,?)", row);
  for (const row of data.events) legacy.run("INSERT INTO events VALUES (?,?,?,?)", row);
  legacy.run("COMMIT");
  fs.writeFileSync(legacyFile, Buffer.from(legacy.export()));
}

// ── 新：node:sqlite + WAL ─────────────────────────────────────────
const modernFile = path.join(dir, "modern.db");
const modern = new DatabaseSync(modernFile);
modern.exec("PRAGMA journal_mode=WAL");
modern.exec("PRAGMA synchronous=NORMAL");
modern.exec(SCHEMA);
const stmts = {
  todos: modern.prepare("INSERT INTO todos VALUES (?,?,?,?)"),
  runs: modern.prepare("INSERT INTO runs VALUES (?,?,?,?,?,?,?)"),
  messages: modern.prepare("INSERT INTO messages VALUES (?,?,?,?,?)"),
  events: modern.prepare("INSERT INTO events VALUES (?,?,?,?)"),
};
const dels = Object.fromEntries(["todos", "runs", "messages", "events"].map((t) => [t, modern.prepare(`DELETE FROM ${t}`)]));

function persistModern() {
  modern.exec("BEGIN IMMEDIATE");
  try {
    for (const t of ["todos", "runs", "messages", "events"]) dels[t].run();
    for (const row of data.todos) stmts.todos.run(...row);
    for (const row of data.runs) stmts.runs.run(...row);
    for (const row of data.messages) stmts.messages.run(...row);
    for (const row of data.events) stmts.events.run(...row);
    modern.exec("COMMIT");
  } catch (err) {
    modern.exec("ROLLBACK");
    throw err;
  }
}

const legacyStats = bench(persistLegacy);
const modernStats = bench(persistModern);
const legacySize = fs.statSync(legacyFile).size;
const modernSize = fs.statSync(modernFile).size;

const rows = Object.values(COUNTS).reduce((n, v) => n + v, 0);
console.log(`\nharness.db 落盘基准 · ${rows} 行 / 每次全量重写 · ${ROUNDS} 轮\n`);
console.log(`旧 sql.js        p50 ${fmt(legacyStats.p50).padEnd(10)} p95 ${fmt(legacyStats.p95).padEnd(10)} max ${fmt(legacyStats.max)}`);
console.log(`新 node:sqlite   p50 ${fmt(modernStats.p50).padEnd(10)} p95 ${fmt(modernStats.p95).padEnd(10)} max ${fmt(modernStats.max)}`);
console.log(`\n提速 p50 ≈ ${(legacyStats.p50 / modernStats.p50).toFixed(1)}× · 主库文件 ${(legacySize / 1024).toFixed(0)} KB → ${(modernSize / 1024).toFixed(0)} KB（另加 -wal）`);

modern.close();
fs.rmSync(dir, { recursive: true, force: true });
