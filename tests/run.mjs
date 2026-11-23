#!/usr/bin/env node
/**
 * 统一测试入口：跑 `tests/*.test.mjs`（每个文件自己断言、失败退出非 0）。
 *
 * 为什么不是 node:test：这些用例要拿 Electron 的 Node（内置 node:sqlite / FTS5）、
 * 要起真实临时目录、有的还要 node-pty，用 `node:test` 跑会把三层运行时揉在一起。
 * 这里统一的是「入口和分组」，不是「断言库」。
 *
 * 用法：
 *   npm test                 # 全跑
 *   npm test -- persona      # 只跑名字匹配的
 *   npm test -- knowledge-index -- --ark   # `--` 之后透传给用例
 *   npm test --list
 *
 * 分组见 GROUPS；新增用例直接加进 groups 或按文件命名放进来即可。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const here = path.join(root, "tests");

/** 需要 Electron 内置 Node 的用例（node:sqlite FTS5）。 */
const ELECTRON_NODE = new Set(["knowledge-index.test.mjs", "knowledge-engines.test.mjs"]);

const GROUPS = {
  core: ["acp-resume.test.mjs", "agent-bridge.test.mjs", "browser-tools.test.mjs", "db.test.mjs", "tool-family.test.mjs", "preview-doc.test.mjs", "preview-format.test.mjs", "preview-permissions.test.mjs", "preview-tunnel.test.mjs", "mission.test.mjs", "worktree.test.mjs"],
  persona: ["persona-import.test.mjs", "persona-lifecycle.test.mjs"],
  knowledge: ["knowledge-index.test.mjs", "knowledge-engines.test.mjs", "wiki-curate.test.mjs", "wiki-plugin.test.mjs", "zhulong.test.mjs"],
  memory: ["memory.test.mjs"],
  im: ["feishu.test.mjs", "im-pairing.test.mjs"],
  bot: ["bot/run.mjs"],
};

const rawArgs = process.argv.slice(2);
const passthrough = rawArgs.includes("--") ? rawArgs.slice(rawArgs.indexOf("--") + 1) : [];
const args = rawArgs.includes("--") ? rawArgs.slice(0, rawArgs.indexOf("--")) : rawArgs;
if (args.includes("--list")) {
  for (const [group, files] of Object.entries(GROUPS)) {
    console.log(`\n${group}`);
    for (const file of files) console.log(`  ${file}${ELECTRON_NODE.has(file) ? "  (electron node)" : ""}`);
  }
  process.exit(0);
}

const filters = args.filter((a) => !a.startsWith("-"));
const selected = Object.entries(GROUPS).flatMap(([group, files]) =>
  files.filter((f) => !filters.length || filters.some((s) => group.includes(s) || f.includes(s))).map((f) => ({ group, file: f })),
);
if (!selected.length) {
  console.error(`没有匹配的用例：${filters.join(" ")}；用 --list 查看。`);
  process.exit(2);
}

const electronBin = path.join(root, "node_modules", "electron", "dist", process.platform === "darwin"
  ? "Electron.app/Contents/MacOS/Electron"
  : process.platform === "win32" ? "electron.exe" : "electron");

function command(file) {
  const target = path.join(here, file);
  if (ELECTRON_NODE.has(file) && fs.existsSync(electronBin)) {
    return { cmd: electronBin, argv: [target, ...passthrough], env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  return { cmd: process.execPath, argv: [target, ...passthrough], env: {} };
}

const failures = [];
const started = Date.now();
for (const { group, file } of selected) {
  process.stdout.write(`\n── ${group}/${file} `);
  const { cmd, argv, env } = command(file);
  const code = await new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("exit", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  if (code !== 0) failures.push(`${group}/${file} (exit ${code})`);
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failures.length) {
  console.error(`\n✗ ${failures.length}/${selected.length} 失败（${seconds}s）`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\n✓ ${selected.length} 个测试文件全部通过（${seconds}s）`);
