#!/usr/bin/env node
/**
 * 只更新渲染层：把仓库里的 dist 换进已安装 App 的 app.asar。
 *
 * 为什么有它：`npm run pack` 每次都要重新解压/下载 Electron、重打 160MB 的 asar，
 * 改一行 UI 也要 1–2 分钟。只改渲染层（src/）时用这个脚本，约 15–25 秒，不用网络。
 *
 * 用法：
 *   npm run build && node scripts/install-renderer.mjs
 *   node scripts/install-renderer.mjs --no-restart
 *
 * 注意：**只换 dist**。改了 electron/ 主进程代码时必须走 `npm run pack && node scripts/install-mac.mjs`。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const APP = "/Applications/Cockpit Harness.app";
const ASAR = path.join(APP, "Contents/Resources/app.asar");
const DIST = path.join(ROOT, "dist");
const restart = !process.argv.includes("--no-restart");

const fail = (msg) => { console.error(`[renderer] ${msg}`); process.exit(1); };
if (!fs.existsSync(path.join(DIST, "index.html"))) fail("dist 不存在，先跑 npm run build");
if (!fs.existsSync(ASAR)) fail(`找不到 ${ASAR}`);

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ch-renderer-"));
const nextAsar = path.join(os.tmpdir(), `ch-renderer-${Date.now()}.asar`);

try {
  console.log("[renderer] 解包 app.asar…");
  asar.extractAll(ASAR, stage);
  console.log("[renderer] 换 dist…");
  fs.rmSync(path.join(stage, "dist"), { recursive: true, force: true });
  fs.cpSync(DIST, path.join(stage, "dist"), { recursive: true });
  console.log("[renderer] 重新打包 app.asar…");
  await asar.createPackageWithOptions(stage, nextAsar, {});

  console.log("[renderer] 退出正在运行的 Cockpit Harness…");
  try { execFileSync("osascript", ["-e", 'tell application "Cockpit Harness" to quit'], { stdio: "ignore" }); } catch { /* ignore */ }
  for (let i = 0; i < 10; i++) {
    try { execFileSync("pgrep", ["-f", `${APP}/Contents/MacOS/`], { stdio: "ignore" }); } catch { break; }
    execFileSync("sleep", ["0.3"]);
  }
  try { execFileSync("pkill", ["-f", `${APP}/Contents/MacOS/`], { stdio: "ignore" }); } catch { /* ignore */ }

  console.log("[renderer] 替换 asar…");
  fs.copyFileSync(nextAsar, ASAR);
  execFileSync("xattr", ["-dr", "com.apple.quarantine", APP], { stdio: "ignore" });
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(nextAsar, { force: true });
}

console.log("[renderer] 完成");
if (restart) {
  execFileSync("open", ["-g", "-j", "-a", APP], { stdio: "ignore" });
  console.log("[renderer] 已后台启动");
}
