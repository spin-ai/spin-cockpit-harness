#!/usr/bin/env node
/**
 * 修 node-pty 的 spawn-helper 可执行位。
 *
 * 现象：终端创建失败 —— `Error invoking remote method 'terminal:create': Error: posix_spawnp failed`
 * 原因：`node_modules/node-pty/prebuilds/<platform>/spawn-helper` 丢了 +x
 *      （拷贝/解压/CI 缓存常见），node-pty 必须靠它 fork pty。
 *
 * 用法：
 *   node scripts/fix-pty-perms.mjs            # 修 node_modules
 *   node scripts/fix-pty-perms.mjs --app DIR  # 修打包产物里的 .app（afterPack 会调）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const appDir = (() => {
  const i = argv.indexOf("--app");
  return i >= 0 ? path.resolve(argv[i + 1] || "") : "";
})();

const targets = [];
if (appDir) {
  // macOS: <App>.app/Contents/Resources/…；Linux/Windows: resources/…
  for (const rel of [
    path.join("Contents", "Resources", "app.asar.unpacked", "node_modules", "node-pty"),
    path.join("resources", "app.asar.unpacked", "node_modules", "node-pty"),
  ]) {
    const unpacked = path.join(appDir, rel);
    if (fs.existsSync(unpacked)) targets.push(unpacked);
  }
} else {
  const local = path.join(root, "node_modules", "node-pty");
  if (fs.existsSync(local)) targets.push(local);
}

let fixed = 0;
for (const base of targets) {
  const dirs = [path.join(base, "build", "Release")];
  const prebuilds = path.join(base, "prebuilds");
  if (fs.existsSync(prebuilds)) {
    for (const name of fs.readdirSync(prebuilds)) dirs.push(path.join(prebuilds, name));
  }
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/^(spawn-helper|.*\.node)$/.test(file)) continue;
      const full = path.join(dir, file);
      try {
        const mode = fs.statSync(full).mode;
        const next = mode | 0o755;
        if (next !== mode) { fs.chmodSync(full, next); fixed += 1; }
      } catch { /* 只读文件系统忽略 */ }
    }
  }
}
console.log(`[pty-perms] ${fixed ? `修复 ${fixed} 个文件的执行位` : "全部已可执行"}${appDir ? ` · ${appDir}` : ""}`);
