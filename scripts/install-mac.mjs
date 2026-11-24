#!/usr/bin/env node
/**
 * 把刚打好的 macOS 安装包装到本机（默认 /Applications），方便直接双击验证。
 *
 *   node scripts/install-mac.mjs                 # 装到 /Applications（必要时回落到 ~/Applications）
 *   node scripts/install-mac.mjs --open          # 装完顺手启动
 *   node scripts/install-mac.mjs --dest ~/Applications
 *   SKIP_LOCAL_INSTALL=1 npm run dist:mac        # 打包但跳过安装（CI/只出包时）
 *
 * 行为：
 * 1. 先优雅退出正在运行的 Cockpit Harness（AppleScript quit → 3s 后仍活着则 SIGTERM）
 * 2. ditto 覆盖目标 App（保留 xattr / 资源分支）
 * 3. 去掉 com.apple.quarantine（本地自签/未签名包双击不被 Gatekeeper 拦）
 * 4. 打印版本 + 内置 dsh 版本，便于确认装的是新包
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const APP_NAME = "Cockpit Harness.app";
const SRC = path.join(ROOT, "release", "mac-arm64", APP_NAME);

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };

if (process.env.SKIP_LOCAL_INSTALL === "1") {
  console.log("[install] SKIP_LOCAL_INSTALL=1，跳过本机安装");
  process.exit(0);
}
if (process.platform !== "darwin") {
  console.log("[install] 非 macOS，跳过");
  process.exit(0);
}
if (!fs.existsSync(SRC)) {
  console.error(`[install] 找不到构建产物：${SRC}\n先跑 npm run dist:mac`);
  process.exit(1);
}

function writableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch { return false; }
}

let destDir = valueOf("--dest");
if (!destDir) destDir = writableDir("/Applications") ? "/Applications" : path.join(os.homedir(), "Applications");
if (!writableDir(destDir)) {
  console.error(`[install] 目标目录不可写：${destDir}`);
  process.exit(1);
}
const DEST = path.join(destDir, APP_NAME);

function running() {
  const res = spawnSync("pgrep", ["-f", `${APP_NAME}/Contents/MacOS/`], { encoding: "utf8" });
  return res.status === 0 && String(res.stdout || "").trim().length > 0;
}

function quitApp() {
  if (!running()) return;
  console.log("[install] 退出正在运行的 Cockpit Harness…");
  spawnSync("osascript", ["-e", 'tell application "Cockpit Harness" to quit'], { encoding: "utf8" });
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    if (!running()) return;
    spawnSync("sleep", ["0.2"]);
  }
  if (running()) {
    const pids = String(spawnSync("pgrep", ["-f", `${APP_NAME}/Contents/MacOS/`], { encoding: "utf8" }).stdout || "")
      .split("\n").map((x) => x.trim()).filter(Boolean);
    for (const pid of pids) { try { process.kill(Number(pid), "SIGTERM"); } catch { /* ignore */ } }
    console.log(`[install] SIGTERM ${pids.length} 个进程`);
  }
  // SIGTERM 后仍活着的（旧窗口卡住）必须硬杀：残留进程会继续显示旧界面，让人以为「装了还是老样子」
  const t1 = Date.now();
  while (Date.now() - t1 < 2000) {
    if (!running()) return;
    spawnSync("sleep", ["0.2"]);
  }
  if (running()) {
    const pids = String(spawnSync("pgrep", ["-f", `${APP_NAME}/Contents/MacOS/`], { encoding: "utf8" }).stdout || "")
      .split("\n").map((x) => x.trim()).filter(Boolean);
    for (const pid of pids) { try { process.kill(Number(pid), "SIGKILL"); } catch { /* ignore */ } }
    console.log(`[install] SIGKILL ${pids.length} 个残留进程`);
  }
}

function plist(app, key) {
  const res = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(app, "Contents", "Info.plist")], { encoding: "utf8" });
  return res.status === 0 ? String(res.stdout).trim() : null;
}

quitApp();

console.log(`[install] ${SRC}\n      →  ${DEST}`);
try {
  if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true });
  execFileSync("ditto", [SRC, DEST], { stdio: "inherit" });
} catch (err) {
  console.error(`[install] 拷贝失败：${String(err?.message || err)}`);
  console.error("[install] 若 /Applications 需要权限，试：sudo chown -R $(whoami) /Applications 或 --dest ~/Applications");
  process.exit(1);
}

// 未签名包：去掉隔离属性，避免双击被拦
spawnSync("xattr", ["-dr", "com.apple.quarantine", DEST], { encoding: "utf8" });

// 补一次 ad-hoc 签名。electron-builder 跳过签名时（identity 为 null），Electron 自带的
// linker-signed 签名和重打后的资源对不上，`spctl` 会报 “code has no resources but signature
// indicates they must be present”，macOS 因此缓存不了校验结果，新拷贝的 700MB+ 包首次启动要
// 重新验一遍完整性（表现就是“启动中”卡很久）。
const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", DEST], { encoding: "utf8" });
if (sign.status !== 0) {
  console.log(`[install] ad-hoc 签名失败（不影响运行，但首次启动会慢）：${String(sign.stderr || "").trim().split("\n")[0]}`);
} else {
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", DEST], { encoding: "utf8" });
  console.log(verify.status === 0 ? "[install] ad-hoc 签名 OK" : `[install] 签名校验未过：${String(verify.stderr || "").trim().split("\n")[0]}`);
}

const version = plist(DEST, "CFBundleShortVersionString") || "unknown";
const dsh = path.join(DEST, "Contents", "Resources", "dsh", "dsh");
let dshVersion = "未内置";
if (fs.existsSync(dsh)) {
  const res = spawnSync(dsh, ["--version"], { encoding: "utf8", timeout: 15000 });
  dshVersion = String(res.stdout || res.stderr || "").trim().split("\n")[0] || "unknown";
}
console.log(`[install] 已安装 v${version} · dsh ${dshVersion}`);

// 构建产物（release/mac-arm64/*.app）会同时出现在 Spotlight / Launchpad：
// 装完后删掉 staging app，只留 DMG（可分发）和 /Applications（已安装），避免看起来装了两份。
try {
  const releaseDir = path.join(ROOT, "release");
  for (const entry of fs.readdirSync(releaseDir)) {
    if (!entry.startsWith("mac")) continue;
    const full = path.join(releaseDir, entry);
    if (fs.statSync(full).isDirectory()) {
      fs.rmSync(full, { recursive: true, force: true });
      console.log(`[install] 清理构建 staging：release/${entry}`);
    }
  }
} catch { /* 清理失败不影响安装 */ }

// 构建产物目录不要被 Spotlight 索引（DMG 仍保留）
try {
  fs.writeFileSync(path.join(ROOT, "release", ".metadata_never_index"), "");
} catch { /* 目录不可写就跳过 */ }

if (has("--open")) {
  console.log("[install] 启动…");
  spawnSync("open", ["-a", DEST], { stdio: "inherit" });
}
