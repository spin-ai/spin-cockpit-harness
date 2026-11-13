#!/usr/bin/env node
/**
 * 检查 node-pty 的 spawn-helper 可执行位（终端起不来最常见的原因）。
 * 用法：node scripts/verify-pty.mjs [--app <App 目录>]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const i = argv.indexOf("--app");
const appDir = i >= 0 ? path.resolve(argv[i + 1]) : "";
const bases = appDir
  ? [path.join(appDir, "Contents", "Resources", "app.asar.unpacked", "node_modules", "node-pty"), path.join(appDir, "resources", "app.asar.unpacked", "node_modules", "node-pty")]
  : [path.join(root, "node_modules", "node-pty")];

const required = process.platform === "win32" ? [] : ["spawn-helper"];
let bad = 0;
let checked = 0;
for (const base of bases) {
  if (!fs.existsSync(base)) continue;
  const dirs = [path.join(base, "build", "Release"), ...(fs.existsSync(path.join(base, "prebuilds"))
    ? fs.readdirSync(path.join(base, "prebuilds")).map((n) => path.join(base, "prebuilds", n)) : [])];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of required) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      checked += 1;
      const mode = fs.statSync(file).mode;
      const executable = (mode & 0o111) === 0o111;
      console.log(`${executable ? "✓" : "✗"} ${file.replace(root + "/", "")} (${(mode & 0o777).toString(8)})`);
      if (!executable) bad += 1;
    }
  }
}
if (!checked) { console.log("✗ 没找到 node-pty 的 spawn-helper（依赖未安装？）"); process.exitCode = 1; }
else if (bad) { console.log(`\n✗ ${bad} 个 spawn-helper 不可执行 → 终端会报 posix_spawnp failed。修：node scripts/fix-pty-perms.mjs`); process.exitCode = 1; }
else console.log("\npty perms: ok");
