#!/usr/bin/env node
/**
 * 人物画像的接线自检（静态、不启动 Electron）。
 *   node scripts/verify-persona-wiring.mjs
 *
 * 为什么需要：这个模块的接线是「渲染层 act("xxx") → 主进程 API 对象 → MCP 工具名」三处手抄，
 * 任何一处改了名字都不会报错，只会静默变成「点了没反应」或「工具不存在」。
 * 已经踩过：`autoConfirmStats` 参数在改成 measures 后成了死参数，但谁也没报错。
 *
 * 检查三件事：
 *   ① Persona.tsx 里 act("…") 调用的每个 person* 动作，主进程都有
 *   ② wiki-mcp-bridge.mjs 里声明的每个工具，主进程都有对应的 name === "…" 分支
 *   ③ 主进程登记的 person* 动作没有被前端使用的，列出来（只提示，不算失败）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`✗ ${msg}`); };
const ok = (msg) => console.log(`✓ ${msg}`);

const ui = read("src/components/Persona.tsx");
const main = read("electron/main.mjs");
const bridge = read("electron/wiki-mcp-bridge.mjs");

// 主进程 API 对象：两空格缩进 + `name: async (` 或 `name: (` / `name: (...)
const actions = new Set(
  [...main.matchAll(/^ {2}([A-Za-z][\w]*):\s*(?:async\s*)?\(/gm)].map((m) => m[1]),
);
if (actions.size < 50) fail(`主进程动作表只认出 ${actions.size} 个，正则可能失效了`);
else ok(`主进程动作表：${actions.size} 个`);

// ① 前端调用 → 后端存在
const called = [...new Set([...ui.matchAll(/act\("([A-Za-z][\w]*)"(?:,\s*(\{[^}]*\}))?/g)].map((m) => m[1]))];
const missing = called.filter((name) => !actions.has(name));
if (missing.length) fail(`人物页调用了不存在的动作：${missing.join(", ")}`);
else ok(`人物页调用的 ${called.length} 个动作都存在`);

// 参数形状：payload 里出现的关键字必须是后端接受的（只查我们新增的几个高频口误）
const SHAPES = {
  personaReviewResolve: ["id", "keep"],
  personaReviewMany: ["personId", "keep"],
  personaMergeApply: ["keepId", "dropId"],
  personaMerge: ["keepId", "aliasIds"],
  personaAsOf: ["personId", "at", "mode"],
  personaInject: ["personId", "maxChars", "query"],
};
for (const [action, keys] of Object.entries(SHAPES)) {
  const m = ui.match(new RegExp(`act\\("${action}"(?:,\\s*(\\{[\\s\\S]{0,200}?\\}))?\\)`));
  if (!m) continue;
  // 先把模板字符串挖掉，否则 `${asOfAt}T23:59:59` 里的 `T23:` 会被当成字段名
  const payload = (m[1] || "").replace(/`[^`]*`/g, "``");
  const usedKeys = [...payload.matchAll(/([A-Za-z][\w]*)\s*:/g)].map((x) => x[1]);
  const unknown = usedKeys.filter((k) => !keys.includes(k));
  if (unknown.length) fail(`act("${action}") 传了后端不认识的字段：${unknown.join(", ")}`);
}
ok("新增动作的字段名与后端一致");

// ② MCP 工具 → 主进程分支
const tools = [...new Set([...bridge.matchAll(/\{\s*name:\s*"([a-z_]+)"/g)].map((m) => m[1]))];
const unhandled = tools.filter((name) => !main.includes(`name === "${name}"`));
if (unhandled.length) fail(`MCP 工具在主进程没有分支：${unhandled.join(", ")}`);
else ok(`MCP 工具 ${tools.length} 个都有对应分支`);

// ③ 主进程有、前端没用（提示）
const personaActions = [...actions].filter((a) => a.startsWith("persona"));
const unused = personaActions.filter((a) => !called.includes(a));
if (unused.length) console.log(`· 主进程有但人物页没直接用（正常：给 Agent / 脚本用）：${unused.join(", ")}`);

console.log(failures === 0 ? "\n接线自检通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
