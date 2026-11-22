#!/usr/bin/env node
/**
 * 真实网关探针：先证明「function calling 通」，再谈其它。
 *
 * 为什么必须有这一步：`REQ-bot-intelligence.md` 的 11 个只读工具、8 轮循环，
 * 全部押在「`/api/plan/v3` 的模型会真的调 tools」这一个没验证过的前提上。
 * 单测里的 `chatStream` 是假实现（`tests/bot/tools.test.mjs`），只能证明管道铺好了，
 * 不能证明水通。这个脚本用**生产同一份** `chatStream` + 同一份工具表 + 真实
 * `workspace.mjs` 读本仓库，一次跑完下面五件事：
 *
 *   1. gateway   —— 带 tools 的请求被接受（不是 4xx）
 *   2. tool_call —— 模型真的发起调用（不是只聊天）
 *   3. args      —— 流式分开到达的 id / name / arguments 拼得对，JSON 可解析
 *   4. feed_back —— 把 tool 结果按 OpenAI 结构回灌后，第二轮不被拒
 *   5. grounded  —— 最终回答引用了工具真实读到的内容（不是编的）
 *
 * 用法：
 *   ARK_API_KEY=... node scripts/probe-ark-tools.mjs
 *   node scripts/probe-ark-tools.mjs --model=deepseek-v4-flash --root=. --verbose
 *
 * 退出码：0 全部通过 · 1 有模型没通过（脚本会直说卡在哪一项）· 2 缺少 key
 *
 * 产出：`.preview/probe-ark-tools.json`（不打印 key，不写用户数据）
 */

import fs from "node:fs";
import path from "node:path";
import { CHAT_MODEL_CATALOG, chatStream, resolveArkKey } from "../electron/knowledge/ark.mjs";
import { botToolsFor } from "../electron/bot/tools.mjs";
import { readWorkspaceFile } from "../electron/bot/workspace.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
};
const verbose = argv.includes("--verbose");
const root = path.resolve(flag("root", process.cwd()));
const key = resolveArkKey(flag("key", ""));
const only = flag("model", "").split(",").map((s) => s.trim()).filter(Boolean);
const models = only.length ? only : CHAT_MODEL_CATALOG.map((m) => m.id);
const OUT_DIR = path.join(root, ".preview");

if (!key) {
  console.error("缺少 ARK_API_KEY：先 `export ARK_API_KEY=...`，或 `--key=...`（不会打印、不会落盘）");
  process.exit(2);
}

const lineNo = 20; // 1-based，与 README 的「下载」小节对齐；文件不够长时自动退回 package.json
function pickTarget() {
  for (const file of ["README.md", "package.json", "AGENTS.md"]) {
    try {
      const got = readWorkspaceFile({ root, rel: file, offset: lineNo - 1, limit: 1 });
      const text = String(got.text || "").trim();
      if (text) return { file, text, totalLines: got.totalLines };
    } catch { /* 换下一个 */ }
  }
  return null;
}
const target = pickTarget();
if (!target) {
  console.error(`找不到可读目标文件（root=${root}）`);
  process.exit(1);
}

/** 只执行探针需要的三个工具；其余一律回「探针不执行」，避免误以为被测过 */
function runProbeTool(name, args = {}) {
  try {
    if (name === "workspace_read") return readWorkspaceFile({ root, rel: String(args.path || ""), offset: args.offset, limit: args.limit });
    if (name === "workspace_list") return { note: "探针不执行 list，避免额外开销" };
    if (name === "workspace_grep") return { note: "探针不执行 grep，避免额外开销" };
    return { error: `探针不执行 ${name}` };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

/** 去标点/空白后的连续片段比对：模型常把 `|` `#` 之类的 markdown 吃掉 */
const strip = (s) => String(s || "").replace(/[^\p{L}\p{N}]+/gu, "");
function containsRun(answer, source, n = 6) {
  const a = strip(answer);
  const s = strip(source);
  if (!a || !s) return false;
  for (let i = 0; i + n <= s.length; i += 1) if (a.includes(s.slice(i, i + n))) return true;
  return false;
}

const empty = () => ({ gateway: false, tool_call: false, args: false, feed_back: false, grounded: false });
const detail = {};

async function probeModel(model) {
  const out = { model, ok: false, checks: empty(), ms: {}, usage: {}, note: "", answer: "", calls: [] };
  const tools = botToolsFor("read"); // 生产同一份：11 只读 + 3 自己 + routine_propose
  const messages = [
    {
      role: "system",
      content: "你是一个会在动手前先查文件的助手。必须用工具查，不要凭猜测回答；查到什么就贴什么。",
    },
    {
      role: "user",
      content: `用 workspace_read 读 ${target.file} 的第 ${lineNo} 行（offset=${lineNo - 1}, limit=1），把那一行原样贴出来，不要解释。`,
    },
  ];

  let t0 = Date.now();
  let res;
  try {
    res = await chatStream(messages, { key, model, maxTokens: 512, temperature: 0.2, tools });
    out.ms.first = Date.now() - t0;
    out.checks.gateway = true;
    out.usage.first = res?.usage || {};
  } catch (err) {
    out.note = `gateway 失败：${String(err?.message || err).slice(0, 300)}`;
    return out;
  }

  const calls = Array.isArray(res?.toolCalls) ? res.toolCalls : [];
  out.calls = calls.map((c) => ({ name: c.name, args: c.args }));
  if (!calls.length) {
    out.note = "网关接受了 tools，但模型没有发起调用（表现会和改造前一样：它只会聊）";
    out.answer = String(res?.text || "").slice(0, 400);
    return out;
  }
  out.checks.tool_call = true;

  const call = calls.find((c) => c.name === "workspace_read") || calls[0];
  let args = {};
  try { args = JSON.parse(call.args || "{}"); } catch { args = {}; }
  out.checks.args = Boolean(args && typeof args === "object" && String(args.path || "").trim());
  const result = runProbeTool(call.name, args);
  const resultText = JSON.stringify(result);

  const conversation = [
    ...messages,
    {
      role: "assistant",
      content: String(res?.text || ""),
      tool_calls: calls.map((c) => ({ id: c.id || c.name, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
    },
    { role: "tool", tool_call_id: call.id || call.name, content: resultText.slice(0, 8000) },
  ];
  t0 = Date.now();
  let res2;
  try {
    res2 = await chatStream(conversation, { key, model, maxTokens: 512, temperature: 0.2 });
    out.ms.second = Date.now() - t0;
    out.checks.feed_back = true;
    out.usage.second = res2?.usage || {};
  } catch (err) {
    out.note = `tool 结果回灌被拒：${String(err?.message || err).slice(0, 300)}`;
    return out;
  }

  const answer = String(res2?.text || "");
  out.answer = answer.slice(0, 600);
  const readBack = String(result?.text || "");
  out.checks.grounded = Boolean(readBack) && containsRun(answer, readBack);
  out.ok = Object.values(out.checks).every(Boolean);
  if (!out.checks.grounded) {
    out.note = readBack
      ? "读了，但回答没有引用读到的那一行（可能是它自己编的）"
      : `读失败：${String(result?.error || "空结果")}`;
  }
  return out;
}

const LABEL = {
  gateway: "tools 被接受",
  tool_call: "真的发起调用",
  args: "参数拼装正确",
  feed_back: "结果可回灌",
  grounded: "回答有依据",
};
const MARK = (v) => (v ? "✅" : "❌");

console.log(`探针目标：${target.file}:${lineNo} · root=${root}`);
console.log(`工具表：${botToolsFor("read").length} 个（production 同一份）`);
console.log("");

const results = [];
for (const model of models) {
  process.stdout.write(`→ ${model} … `);
  const r = await probeModel(model);
  results.push(r);
  console.log(r.ok ? "通过" : "未通过");
  if (verbose) {
    console.log(`  检查：${Object.entries(r.checks).map(([k, v]) => `${LABEL[k]}${MARK(v)}`).join(" · ")}`);
    if (r.answer) console.log(`  回答：${r.answer.replace(/\s+/g, " ")}`);
    if (r.calls.length) console.log(`  调用：${r.calls.map((c) => `${c.name}(${c.args})`).join(" | ")}`);
    if (r.note) console.log(`  备注：${r.note}`);
    console.log("");
  }
}

console.log("");
console.log(`${"模型".padEnd(24)}${Object.values(LABEL).map((l) => l.padEnd(14)).join("")}`);
for (const r of results) {
  console.log(`${r.model.padEnd(24)}${Object.keys(LABEL).map((k) => MARK(r.checks[k]).padEnd(14)).join("")}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log("");
  for (const r of failed) {
    console.log(`✗ ${r.model}：${r.checks.gateway ? (r.checks.tool_call ? (r.checks.args ? (r.checks.feed_back ? "答案没有引用工具内容" : "tool 结果回灌失败") : "工具调用参数为空/解析失败") : "模型没有发起工具调用") : "网关拒绝带 tools 的请求"}`);
    if (r.note) console.log(`  ${r.note}`);
  }
}

try {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, "probe-ark-tools.json");
  fs.writeFileSync(file, `${JSON.stringify({
    at: new Date().toISOString(),
    target: { file: target.file, line: lineNo },
    models: results,
  }, null, 2)}\n`);
  console.log(`\n报告：${path.relative(root, file)}`);
} catch { /* 报告写不进去不影响结论 */ }

// 结论只对「有模型全通」负责；全挂时明确指向下一步
if (!results.some((r) => r.ok)) {
  const anyCall = results.some((r) => r.checks.tool_call);
  console.log("");
  console.log(anyCall
    ? "结论：网关能调工具，但链路还没打通 —— 先查结果回灌与回答引用，再谈调参。"
    : "结论：改造的关键前提不成立 —— 模型不调工具，11 个只读工具对体感没有影响。先换模型 / 换网关，或明说「不支持 function calling」再决定要不要保留这一层。");
  process.exit(1);
}
console.log("\n结论：function calling 通。可以继续做上下文与记忆，不用再怀疑这一层。");
