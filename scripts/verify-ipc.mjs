#!/usr/bin/env node
/**
 * 主进程 IPC 频道查重：`ipcMain.handle("x")` 注册两次会让应用在启动时直接崩
 * （Attempted to register a second handler for 'x'），而且崩在模块加载阶段，连窗口都出不来。
 *
 * 只做静态扫描：同一频道在 electron/main.mjs 里出现多次就报错。
 * 跑法：npm run verify:ipc
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = fs.readdirSync(path.join(root, "electron"))
  .filter((name) => name.endsWith(".mjs"))
  .map((name) => path.join("electron", name));

const seen = new Map(); // channel -> [file:line]
const pattern = /ipcMain\.(handle|on|handleOnce)\(\s*["'`]([^"'`]+)["'`]/g;
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      const key = `${match[1]}:${match[2]}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(`${rel}:${index + 1}`);
    }
  });
}

const dupes = [...seen.entries()].filter(([, where]) => where.length > 1);
if (dupes.length) {
  console.error("发现重复的 IPC 频道（应用启动会直接崩）：");
  for (const [key, where] of dupes) console.error(`  ✗ ${key} → ${where.join(", ")}`);
  process.exit(1);
}
console.log(`IPC: ${seen.size} 个频道，无重复（${files.length} 个主进程模块）`);
