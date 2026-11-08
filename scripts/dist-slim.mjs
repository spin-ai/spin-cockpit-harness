#!/usr/bin/env node
/**
 * 瘦身打包：不带内置 dsh（沿用系统 PATH 里的 dsh）。
 *
 *   node scripts/dist-slim.mjs [--dir]     # 默认 mac dmg + 安装到本机；--dir 只出 unpacked
 *
 * 做法：把 resources/dsh 临时挪走（extraResources 就不会被塞进包），构建完再挪回来。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DSH = path.join(ROOT, "resources", "dsh");
const HIDDEN = path.join(ROOT, "resources", ".dsh-hidden");
const dirOnly = process.argv.includes("--dir");

const hadDsh = fs.existsSync(DSH);
try {
  if (hadDsh) {
    fs.rmSync(HIDDEN, { recursive: true, force: true });
    fs.renameSync(DSH, HIDDEN);
    console.log("[slim] 临时移出 resources/dsh（本次不内置执行引擎）");
  }
  execFileSync("npx", ["vite", "build"], { cwd: ROOT, stdio: "inherit" });
  const args = ["electron-builder", "--config.directories.output=release-slim"];
  if (!dirOnly) args.push("--mac", "dmg");
  execFileSync("npx", args, { cwd: ROOT, stdio: "inherit" });
  console.log(`[slim] 完成 → ${path.join(ROOT, "release-slim")}`);
  if (!dirOnly) {
    try { execFileSync("node", ["scripts/install-mac.mjs"], { cwd: ROOT, stdio: "inherit" }); } catch { /* 安装失败不影响出包 */ }
  }
} finally {
  if (hadDsh && fs.existsSync(HIDDEN)) {
    fs.rmSync(DSH, { recursive: true, force: true });
    fs.renameSync(HIDDEN, DSH);
    console.log("[slim] 已恢复 resources/dsh");
  }
}
