#!/usr/bin/env node
/**
 * 端到端验收：用**真实的** bot 运行时问三个真问题。
 *
 * 为什么要另起一条：`tests/bot/*` 里的 `chatStream` 是假实现，只能证明管道铺好了；
 * `scripts/preview-bot.mjs` 是 mock 的渲染层，只能证明界面长得对。两者都回答不了
 * 「它到底会不会去读、读到的东西会不会进回答」。这个脚本用生产同一份
 * `createBots` + `chatStream` + `workspace.mjs` + git，在本仓库上跑三问，
 * 把每一轮的 `context / cost / stopReason / tools / trace` 原样落下来。
 *
 * 三问覆盖（见 REQ-bot-intelligence §7 的验收口径）：
 *   Q1 读事实   → C1 观察面：能不能给出 path:line
 *   Q2 看改动   → C1 + C3：会不会先查再答`，而不是让你自己贴
 *   Q3 查停因   → C3 + B12：能不能从运行账里说出「为什么失败」
 *
 * 为什么不用 Electron：AGENTS.md §5 要求验证时不抢焦点；而且这里不需要窗口，
 * 主进程的 bot 运行时本身就是纯 Node（`electron/bot/index.mjs` 没有 electron 依赖）。
 * 记忆库用临时目录，不碰用户 userData。
 *
 * 用法：
 *   ARK_API_KEY=... node scripts/probe-bot-answers.mjs
 *   node scripts/probe-bot-answers.mjs --model=deepseek-v4-flash --root=. --verbose
 *
 * 退出码：0 三问全过 · 1 有问答没通过 · 2 缺少 key
 * 产出：`.preview/probe-bot-answers.json` + 控制台一行一结论
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chat as arkChat, chatStream as arkChatStream, resolveArkKey } from "../electron/knowledge/ark.mjs";
import { createBots } from "../electron/bot/index.mjs";
import { createMemory } from "../electron/memory/index.mjs";
import { grepWorkspace, listWorkspace, readWorkspaceFile } from "../electron/bot/workspace.mjs";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
};
const verbose = argv.includes("--verbose");
const root = path.resolve(flag("root", process.cwd()));
const key = resolveArkKey(flag("key", ""));
const model = flag("model", "deepseek-v4-flash");
const OUT_DIR = path.join(root, ".preview");

if (!key) {
  console.error("缺少 ARK_API_KEY：先 `export ARK_API_KEY=...`（不会打印、不会落盘）");
  process.exit(2);
}

/* ---------------------------------------------------------------- 夹具 */

/** 一次失败运行：Q3 的问题对象。字段与 `state.runs` 同形（见 src/types.ts 的 Run） */
const FAILED_RUN = {
  id: "r-fail-1",
  todoId: "t-1",
  agentId: "a-1",
  title: "修登录页空指针",
  status: "failed",
  cwd: root,
  startedAt: Date.now() - 1000 * 60 * 8,
  endedAt: Date.now() - 1000 * 60 * 7,
  durationMs: 61_000,
  exitCode: 1,
  error: "TypeError: Cannot read properties of undefined (reading 'id')  at Login.tsx:42:18",
  errorClass: "other",
  result: "TypeError: Cannot read properties of undefined (reading 'id')\n  at Login.tsx:42:18\n  at AuthStore.current (auth.ts:88:12)",
  resultSource: "error",
  resultTruncated: false,
  terminalId: null,
};

const state = {
  bots: [], botTurns: [], botRevisions: [], routines: [], threads: [], messages: [],
  todos: [{ id: "t-1", key: "T-1", title: "修登录页空指针", status: "todo", confirmed: false, projectId: "p1", agentId: "a-1" }],
  runs: [FAILED_RUN],
  projects: [{ id: "p1", name: path.basename(root), path: root }],
  activeProjectId: "p1",
  agents: [{ id: "a-1", alias: "SE", name: "SE · 前端", role: "worker" }],
  events: [], artifacts: [], terminals: [],
};

const store = {
  state,
  persist() { /* 探针不落盘 */ },
  addMessage(threadId, runId, role, kind, content) {
    state.messages.push({
      id: `m${state.messages.length + 1}`, threadId, runId, role, kind,
      content: String(content || ""), createdAt: Date.now(),
    });
  },
};

/* ------------------------------------------------- 真实工具执行器（同生产口径） */

const clip = (s, n) => {
  const text = String(s ?? "");
  return text.length <= n ? { text, truncated: false } : { text: `${text.slice(0, n - 1)}…`, truncated: true };
};

async function git(args) {
  try {
    const { stdout } = await run("git", args, { cwd: root, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, stdout: String(stdout || "") };
  } catch (err) {
    return { ok: false, error: String(err?.stderr || err?.message || err).slice(0, 400) };
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)),
  ]);
}

/** 只做 Q1–Q3 需要的工具；其余明确回「探针不执行」，不假装测过 */
async function runTool(name, args = {}, ctx = {}) {
  const bot = ctx?.bot;
  const limit = (v, d, max) => Math.min(Math.max(Number(v) || d, 1), max);
  switch (name) {
    case "workspace_list":
      return listWorkspace({ root, rel: String(args.path || ""), depth: Number(args.depth) || 1 });
    case "workspace_read":
      return readWorkspaceFile({ root, rel: String(args.path || ""), offset: Number(args.offset) || 0, limit: Number(args.limit) || 200 });
    case "workspace_grep":
      return grepWorkspace({ root, query: String(args.query || ""), path: String(args.path || ""), limit: Number(args.limit) || 40 });
    case "git_status": {
      const res = await git(["status", "--porcelain=v1", "-b"]);
      if (!res.ok) return { error: res.error };
      return clip(res.stdout, 10_000);
    }
    case "git_log": {
      const res = await git(["log", "--oneline", "-n", String(limit(args.limit, 10, 30))]);
      if (!res.ok) return { error: res.error };
      return clip(res.stdout, 10_000);
    }
    case "git_diff": {
      const a = ["diff"];
      if (args.staged === true) a.push("--cached");
      if (args.stat !== false) a.push("--stat");
      if (args.path) a.push("--", String(args.path));
      const res = await git(a);
      if (!res.ok) return { error: res.error };
      return clip(res.stdout || "（没有未提交改动）", 12_000);
    }
    case "run_log": {
      const id = String(args.runId || "").trim();
      const doc = id ? state.runs.find((r) => r.id === id) : state.runs.at(-1);
      if (!doc) return { error: `没有 ${id || "任何"} 运行` };
      const msgs = state.messages
        .filter((m) => m.runId === doc.id)
        .slice(-limit(args.limit, 8, 30))
        .map((m) => ({ role: m.role, text: String(m.content || "").slice(0, 400) }));
      return {
        runId: doc.id,
        task: doc.title || doc.todoId,
        agent: state.agents.find((a) => a.id === doc.agentId)?.alias || doc.agentId,
        status: doc.status,
        exitCode: doc.exitCode ?? null,
        durationMs: doc.durationMs ?? null,
        error: doc.error || null,
        resultSource: doc.resultSource || null,
        result: String(doc.result || "").slice(-1200) || null,
        messages: msgs,
      };
    }
    case "memory_search": {
      const query = String(args.query || "").trim();
      if (!query) return { entries: [], notes: [] };
      const owner = bot?.id ? `bot:${bot.id}` : "";
      const entries = memory.entrySearch({ query, limit: limit(args.limit, 6, 12), owner });
      return { entries: entries.map((e) => ({ layer: e.layer, title: e.title, body: String(e.body || "").slice(0, 240) })) };
    }
    case "todo_list":
      return { total: state.todos.length, rows: state.todos.map((t) => ({ key: t.key, title: t.title, status: t.status })) };
    case "run_status":
      return { running: 0, rows: state.runs.map((r) => ({ runId: r.id, status: r.status, error: r.error || null })) };
    default:
      return { error: `探针不执行 ${name}` };
  }
}

/* ---------------------------------------------------------------- 三问 */

const LINE_NO = 20;
const target = (() => {
  for (const file of ["README.md", "AGENTS.md", "package.json"]) {
    try {
      const got = readWorkspaceFile({ root, rel: file, offset: LINE_NO - 1, limit: 1 });
      if (String(got.text || "").trim()) return { file, text: String(got.text).trim() };
    } catch { /* 换下一个 */ }
  }
  return null;
})();
if (!target) {
  console.error(`读不到第 ${LINE_NO} 行（root=${root}）`);
  process.exit(1);
}

const changedFiles = await (async () => {
  const res = await git(["status", "--porcelain=v1"]);
  return res.ok
    ? res.stdout.split("\n").map((l) => l.slice(3).trim()).filter(Boolean)
    : [];
})();

const QUESTIONS = [
  {
    id: "Q1",
    label: "读事实",
    ask: `${target.file} 第 ${LINE_NO} 行是什么？把那一行原样贴出来，不要解释。`,
    expectTools: ["workspace_read", "workspace_grep"],
    verify: ({ answer }) => strip(answer).length > 0 && containsRun(answer, target.text),
    reason: `回答里要出现第 ${LINE_NO} 行的原文`,
  },
  {
    id: "Q2",
    label: "看改动",
    ask: "现在工作区里 git 改了什么？按文件给我统计，不要提交、不要暂存。",
    expectTools: ["git_status", "git_diff"],
    verify: ({ answer }) => changedFiles.length === 0 || changedFiles.some((f) => answer.includes(path.basename(f))),
    reason: "回答里要出现真实改动过的文件名",
  },
  {
    id: "Q3",
    label: "查停因",
    ask: "r-fail-1 这次运行为什么失败？把最后一条错误贴出来。",
    expectTools: ["run_log", "run_status"],
    verify: ({ answer }) => /TypeError|undefined|'id'|Login\.tsx/i.test(answer),
    reason: "回答里要出现夹具里的失败原因（TypeError / Login.tsx）",
  },
];

const strip = (s) => String(s || "").replace(/[^\p{L}\p{N}]+/gu, "");
function containsRun(answer, source, n = 6) {
  const a = strip(answer);
  const s = strip(source);
  if (!a || !s) return false;
  for (let i = 0; i + n <= s.length; i += 1) if (a.includes(s.slice(i, i + n))) return true;
  return false;
}

/* ---------------------------------------------------------------- 跑 */

const tmpMem = fs.mkdtempSync(path.join(os.tmpdir(), "bot-e2e-"));
const memory = createMemory({ dir: tmpMem });

const bots = createBots({
  store,
  memory: () => memory,
  chat: arkChat,
  chatStream: arkChatStream,
  key: () => key,
  runTool: (name, args, ctx) => withTimeout(runTool(name, args, ctx), 20_000, `工具 ${name}`),
  onChange: () => {},
  log: { warn() {}, info() {} },
});
bots.ensureSeed();
// 内置种子 bot 已下线：探针自己建一个（固定 id，重复跑不会堆一串）
const bot = bots.save({ id: "bot-probe", name: "验收 bot" });
bot.intro = false;
bot.model = model;
bot.capability = "read";
bot.budget = { ...(bot.budget || {}), tokensPerTurn: 2048, tokensPerHour: 12_000 };
bot.persona = { ...(bot.persona || {}), mission: "回答关于这个仓库的事实，先查再答", duty: { report: "先结论，再证据（path:line）" } };
bots.save(bot);

console.log(`验收：${path.basename(root)} · bot=${bot.name} · model=${model}`);
console.log(`目标：${target.file}:${LINE_NO} · 改动文件 ${changedFiles.length} 个`);
console.log("");

const results = [];
for (const q of QUESTIONS) {
  process.stdout.write(`→ ${q.id} ${q.label} … `);
  const startedAt = Date.now();
  let row;
  try {
    const turn = await bots.reply(bot, q.ask, { onDelta: verbose ? (d) => process.stdout.write(d) : undefined });
    const tools = Array.isArray(turn.tools) ? turn.tools : [];
    const used = tools.filter((t) => !t.rejected).map((t) => t.name);
    const hit = used.some((n) => q.expectTools.includes(n));
    const ok = q.verify({ answer: String(turn.reply || ""), tools: used }) && hit;
    row = {
      id: q.id, label: q.label, ask: q.ask, ok,
      answer: String(turn.reply || ""),
      tools: used,
      toolDetail: tools.map((t) => ({ name: t.name, args: t.args, ms: t.ms, ok: t.ok, rejected: Boolean(t.rejected), preview: String(t.preview || "").slice(0, 200) })),
      rounds: turn.cost?.rounds ?? null,
      toolCalls: turn.cost?.toolCalls ?? null,
      tokens: turn.cost?.tokens ?? null,
      ms: turn.cost?.ms ?? (Date.now() - startedAt),
      stopReason: turn.stopReason || "",
      context: turn.context || null,
      turnId: turn.id,
      reason: ok ? "" : (hit ? q.reason : `没有用预期的工具（${q.expectTools.join(" / ")}），实际：${used.join(" / ") || "无"}`),
    };
    const secs = ((row.ms || 0) / 1000).toFixed(1);
    console.log(`${ok ? "通过" : "未通过"} · ${used.join(" → ") || "没调工具"} · ${secs}s${row.tokens ? ` · ${row.tokens} tok` : ""}`);
  } catch (err) {
    row = { id: q.id, label: q.label, ask: q.ask, ok: false, answer: "", tools: [], reason: String(err?.message || err).slice(0, 400), ms: Date.now() - startedAt };
    console.log(`报错 · ${row.reason}`);
  }
  results.push(row);
  if (verbose && row.answer) console.log(`  答：${row.answer.replace(/\s+/g, " ").slice(0, 300)}`);
  if (row.reason) console.log(`  ${row.reason}`);
}

console.log("");
console.log(`${"问".padEnd(4)}${"覆盖".padEnd(10)}${"结果".padEnd(8)}${"工具链".padEnd(28)}${"轮".padEnd(4)}${"tok".padEnd(8)}上下文`);
for (const r of results) {
  const ctx = r.context ? `${r.context.chars} 字符 · 记忆 ${r.context.memory}${r.context.digest ? " · 摘要" : ""}` : "未记录";
  console.log(`${r.id.padEnd(4)}${r.label.padEnd(10)}${(r.ok ? "✅ 通过" : "❌ 未过").padEnd(8)}${(r.tools.join(" → ") || "—").padEnd(28)}${String(r.rounds ?? "—").padEnd(4)}${String(r.tokens ?? "—").padEnd(8)}${ctx}`);
}

try {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, "probe-bot-answers.json");
  fs.writeFileSync(file, `${JSON.stringify({
    at: new Date().toISOString(),
    model,
    root: path.basename(root),
    target: { file: target.file, line: LINE_NO },
    results,
  }, null, 2)}\n`);
  console.log(`\n记录：${path.relative(root, file)}（含每轮 context / cost / stopReason / tools）`);
} catch { /* 写不进去不影响结论 */ }

const passed = results.filter((r) => r.ok).length;
console.log("");
if (passed === results.length) {
  console.log(`结论：${passed}/${results.length} 通过 —— 「去读再答」这条链路在真实仓库上成立。`);
  process.exit(0);
}
const bad = results.filter((r) => !r.ok);
console.log(`结论：${passed}/${results.length} 通过。没过的：${bad.map((r) => `${r.id}（${r.reason}）`).join("；")}`);
process.exit(1);
