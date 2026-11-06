#!/usr/bin/env node
/**
 * 把 dsh 的单文件运行时复制进 App（extraResources/dsh）。
 *
 * 首选来源：PyPI 的 deepseek-harness-runtime-bin 平台 wheel。wheel 里是 pkg SEA
 * 单文件可执行体（自带 Node 与依赖），macOS / Linux x64+arm64 / Windows x64 都有
 * 预构建，所以可以在任意构建机上为其他平台准备资源，不需要在目标机器上编译。
 *
 * 也支持显式的源码构建产物：
 *   DSH_EXE_DIR=/path/to/dist-exe node scripts/bundle-dsh.mjs
 *   DSH_BIN=/path/to/dsh node scripts/bundle-dsh.mjs
 *
 * 用法：
 *   node scripts/bundle-dsh.mjs                         # 当前平台 / 默认版本
 *   node scripts/bundle-dsh.mjs --platform win --arch x64
 *   node scripts/bundle-dsh.mjs --platform linux --arch arm64 --version 0.2.1rc2
 *   node scripts/bundle-dsh.mjs --optional              # 失败则跳过（回退系统 dsh）
 *
 * 复制时统一改名为 dsh / dsh.exe / dsh-rg / dsh-spawn-helper。dsh 内部按
 * `${process.execPath}-rg` 和 `${process.execPath}-spawn-helper` 找旁路文件，
 * 所以主程序改名后旁路文件必须同步改名。
 */
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destDir = path.join(root, "resources", "dsh");
const cacheDir = path.join(root, "release", ".cache", "dsh-wheels");
const DEFAULT_VERSION = process.env.DSH_VERSION || "0.2.1rc2";
const WHEEL_PACKAGE = "deepseek-harness-runtime-bin";
const optional = process.argv.includes("--optional");

function flag(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const platform = normalizePlatform(flag("platform", process.platform));
const arch = normalizeArch(flag("arch", process.arch));
const versionArg = flag("version", DEFAULT_VERSION);
const pypiVersion = versionArg.replace(/-/g, "");
const wheelDir = process.env.DSH_WHEEL_DIR || "";
const wheelFile = process.env.DSH_WHEEL || "";

function normalizePlatform(value) {
  const v = String(value || "").toLowerCase();
  if (v === "darwin" || v === "mac" || v === "macos") return "macos";
  if (v === "win32" || v === "windows" || v === "win") return "win";
  if (v === "linux") return "linux";
  return v;
}

function normalizeArch(value) {
  const v = String(value || "").toLowerCase();
  if (v === "aarch64") return "arm64";
  if (v === "amd64" || v === "x86_64") return "x64";
  return v;
}

function fail(message) {
  if (optional) {
    console.warn(`[bundle:dsh] skipped: ${message}`);
    console.warn("[bundle:dsh] app 将回退到系统 PATH / 设置里的 dsh 可执行文件。");
    process.exit(0);
  }
  console.error(`[bundle:dsh] ${message}`);
  process.exit(1);
}

function wheelTag() {
  if (platform === "macos") return arch === "arm64" ? "macosx_14_0_arm64" : "macosx_14_0_x86_64";
  if (platform === "linux") return arch === "arm64" ? "manylinux_2_28_aarch64" : "manylinux_2_28_x86_64";
  if (platform === "win" && arch === "x64") return "win_amd64";
  return null;
}

const tag = wheelTag();
if (!tag) fail(`unsupported target ${platform}/${arch}（支持 macos/linux 的 arm64+x64，Windows 仅 x64）`);

const runtimeTag = platform === "win" ? "win-x64" : `${platform}-${arch}`;
const exeExt = platform === "win" ? ".exe" : "";
const runtimeBase = `deepseek-harness-sdk-runtime-${runtimeTag}`;

// ── 1) 显式源码构建产物（可选）────────────────────────────────────────
function sourceBuild() {
  if (process.env.DSH_BIN) {
    const bin = path.resolve(process.env.DSH_BIN);
    if (!existsSync(bin)) fail(`DSH_BIN not found: ${bin}`);
    return { bin, dir: path.dirname(bin), base: path.basename(bin).replace(/\.exe$/i, ""), origin: "DSH_BIN" };
  }
  if (process.env.DSH_EXE_DIR) {
    const dir = path.resolve(process.env.DSH_EXE_DIR);
    const bin = path.join(dir, runtimeBase + exeExt);
    if (!existsSync(bin)) fail(`DSH_EXE_DIR 里没有 ${runtimeBase}${exeExt}: ${dir}`);
    return { bin, dir, base: runtimeBase, origin: "DSH_EXE_DIR" };
  }
  return null;
}

const source = sourceBuild();

// ── 2) PyPI wheel ────────────────────────────────────────────────────
async function download(url, destination) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${url}`);
  mkdirSync(path.dirname(destination), { recursive: true });
  const tmp = `${destination}.part`;
  await pipeline(res.body, createWriteStream(tmp));
  rmSync(destination, { force: true });
  renameSync(tmp, destination);
}

async function findWheel() {
  if (wheelFile) {
    if (!existsSync(wheelFile)) fail(`DSH_WHEEL not found: ${wheelFile}`);
    return wheelFile;
  }
  if (wheelDir) {
    const direct = path.join(wheelDir, `${WHEEL_PACKAGE.replace(/-/g, "_")}-${pypiVersion}-py3-none-${tag}.whl`);
    if (existsSync(direct)) return direct;
    const found = (() => {
      try { return readdirSync(wheelDir).find((name) => name.endsWith(`-${tag}.whl`)); } catch { return null; }
    })();
    if (found) return path.join(wheelDir, found);
    fail(`DSH_WHEEL_DIR 里没有 ${tag} 的 wheel: ${wheelDir}`);
  }
  const file = path.join(cacheDir, `${WHEEL_PACKAGE.replace(/-/g, "_")}-${pypiVersion}-py3-none-${tag}.whl`);
  if (existsSync(file) && statSync(file).size > 10 * 1024 * 1024) return file;
  const metaUrl = `https://pypi.org/pypi/${WHEEL_PACKAGE}/${pypiVersion}/json`;
  console.log(`[bundle:dsh] resolving ${WHEEL_PACKAGE} ${pypiVersion} (${tag})…`);
  const meta = await (await fetch(metaUrl)).json();
  const artifact = (meta.urls || []).find((u) => String(u.filename || "").endsWith(`-${tag}.whl`));
  if (!artifact) fail(`PyPI 上没有 ${pypiVersion} 的 ${tag} wheel`);
  console.log(`[bundle:dsh] downloading ${artifact.filename} (${(artifact.size / 1048576).toFixed(1)} MB)…`);
  await download(artifact.url, file);
  return file;
}

function extractWheel(wheel, destination) {
  if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const unzip = spawnSync("unzip", ["-o", "-q", wheel, "-d", destination], { encoding: "utf8" });
  if (unzip.status === 0) return;
  const tar = spawnSync("tar", ["-xf", wheel, "-C", destination], { encoding: "utf8" });
  if (tar.status === 0) return;
  fail(`无法解压 wheel（unzip/tar 都失败）: ${unzip.stderr || tar.stderr}`);
}

async function wheelBuild() {
  const wheel = await findWheel();
  const extractDir = path.join(cacheDir, "extract", `${pypiVersion}-${runtimeTag}`);
  const runtimeRoot = path.join(extractDir, "deepseek_harness_runtime", "runtime");
  const exe = path.join(runtimeRoot, runtimeBase + exeExt);
  if (!existsSync(exe)) extractWheel(wheel, extractDir);
  if (!existsSync(exe)) fail(`wheel 里找不到 ${runtimeBase}${exeExt}: ${wheel}`);
  let wheelVersion = null;
  try {
    const downloads = JSON.parse(readFileSync(path.join(runtimeRoot, runtimeTag, "downloads.json"), "utf8"));
    wheelVersion = downloads.version || null;
  } catch { /* ignore */ }
  return { bin: exe, dir: runtimeRoot, base: runtimeBase, origin: `pypi-wheel ${path.basename(wheel)}`, wheelVersion };
}

const input = source || await wheelBuild();

// ── 3) 复制 + 校验 ───────────────────────────────────────────────────
const sourceBytes = statSync(input.bin).size;
if (sourceBytes < 1024 * 1024) fail(`${input.bin} 只有 ${sourceBytes} 字节，看起来是 dsh shim 而不是单文件运行时`);

mkdirSync(destDir, { recursive: true });
const destBin = path.join(destDir, `dsh${exeExt}`);

for (const name of ["dsh", "dsh.exe", "dsh-rg", "dsh-rg.exe", "dsh-spawn-helper", "dsh-spawn-helper.exe", "manifest.json"]) {
  rmSync(path.join(destDir, name), { force: true });
}

copyFileSync(input.bin, destBin);
chmodSync(destBin, 0o755);
const copied = [path.basename(destBin)];

function copySidecar(suffix) {
  const names = process.platform === "win32" || platform === "win"
    ? [`${input.base}${suffix}.exe`, `${input.base}${suffix}`]
    : [`${input.base}${suffix}`];
  const from = names.map((name) => path.join(input.dir, name)).find((p) => existsSync(p));
  if (!from) {
    console.warn(`[bundle:dsh] sidecar ${input.base}${suffix} not found, skipped`);
    return;
  }
  const to = path.join(destDir, `dsh${suffix}${platform === "win" ? ".exe" : ""}`);
  copyFileSync(from, to);
  chmodSync(to, 0o755);
  copied.push(path.basename(to));
}

copySidecar("-rg");
if (platform === "macos") copySidecar("-spawn-helper");

let version = input.wheelVersion || null;
if (platform === normalizePlatform(process.platform) && arch === normalizeArch(process.arch)) {
  const probe = spawnSync(destBin, ["--version"], { encoding: "utf8", timeout: 20000 });
  const probed = (probe.stdout || "").trim().split("\n").pop() || null;
  if (probed) version = probed;
  if (probe.status !== 0) {
    console.warn(`[bundle:dsh] warning: bundled dsh --version exited ${probe.status}${probe.error ? ` (${probe.error.message})` : ""}`);
  }
}

writeFileSync(path.join(destDir, "manifest.json"), JSON.stringify({
  name: "dsh",
  version,
  requestedVersion: versionArg,
  source: input.origin,
  platform,
  arch,
  runtimeTag,
  entry: path.basename(destBin),
  files: copied,
  bundledAt: new Date().toISOString(),
}, null, 2) + "\n");

console.log(`[bundle:dsh] ${copied.join(", ")} → resources/dsh`);
console.log(`[bundle:dsh] target ${platform}/${arch} · version ${version ?? "unknown"} · ${input.origin}`);
if (platform !== normalizePlatform(process.platform) || arch !== normalizeArch(process.arch)) {
  console.log("[bundle:dsh] cross-target: 当前主机不能直接执行该二进制，构建/CI 里需在目标平台做运行验证。");
}
