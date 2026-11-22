#!/usr/bin/env node
/**
 * E2E 统一入口：自己起一个隔离 userData 的 Electron，再跑某一套用例。
 *
 * 用法：
 *   npm run test:e2e                              # 默认 requirements（UI / 设置 / 主题 / Git / Notes / 适配器）
 *   npm run test:e2e -- --list                    # 列出 requirements 用例
 *   npm run test:e2e -- --only=THEME,GIT          # 只跑分组 / 编号前缀
 *   npm run test:e2e -- --keep                    # 保留 userData 与产物
 *   npm run test:e2e -- --suite=smoke             # 旧式套件：smoke / git / notes / preview / md-rich
 *
 * 旧式套件（suites/*.mjs 里除了 requirements 的那几个）自己 attach 到已运行实例，
 * 所以窗口由本 runner 起、端口也由它分配，套件脚本只负责驱动。
 *
 * 前置：已运行 npm run build（使用 dist/index.html）。
 */
import fs from "node:fs";
import path from "node:path";
import { freePort, installHelpers, launchApp, repoRoot, screenshot, tempDataDir } from "./harness.mjs";
import { TESTS } from "./suites/requirements.mjs";

/** 旧式套件：自己 attach 到已运行实例，由本 runner 负责起窗口。 */
const LEGACY_SUITES = ["smoke", "git", "notes", "preview", "md-rich", "execution"];

const root = repoRoot();
const args = process.argv.slice(2);
const list = args.includes("--list");
const keep = args.includes("--keep");
const runSkipped = args.includes("--run-skipped");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
const portArg = args.find((a) => a.startsWith("--port="));
const port = portArg ? Number(portArg.slice("--port=".length)) : await freePort();
const suiteArg = args.find((a) => a.startsWith("--suite="));
const suite = suiteArg ? suiteArg.slice("--suite=".length).trim().toLowerCase() : "requirements";

if (!LEGACY_SUITES.includes(suite) && suite !== "requirements") {
  console.error(`未知套件 ${suite}；可选：requirements, ${LEGACY_SUITES.join(", ")}`);
  process.exit(2);
}

// 旧式套件：起一个隔离实例 → spawn 套件脚本（它自己 attach 到同一端口）→ 收窗口
if (suite !== "requirements") {
  const { spawn } = await import("node:child_process");
  const dataDir = tempDataDir();
  let app;
  let code = 1;
  try {
    console.log(`[e2e] suite=${suite} · app data: ${dataDir}`);
    app = await launchApp({ root, port, dataDir });
    code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(root, "scripts", "e2e", "suites", `${suite}.mjs`), String(port)], { cwd: root, stdio: "inherit" });
      child.on("exit", (c) => resolve(c ?? 1));
    });
  } catch (err) {
    console.error(`[e2e] 启动/执行失败：${String(err?.stack || err)}`);
  } finally {
    try { await app?.close(); } catch { /* ignore */ }
    if (!keep && !code) fs.rmSync(dataDir, { recursive: true, force: true });
    else console.log(`[e2e] 保留数据目录：${dataDir}`);
  }
  process.exit(code);
}

if (list) {
  for (const test of TESTS) {
    console.log(`${test.skip ? "SKIP" : "TEST"} ${test.group.padEnd(8)} ${test.id.padEnd(10)} ${test.title}${test.skip ? `  — ${test.skip}` : ""}`);
  }
  process.exit(0);
}

const selected = TESTS.filter((test) => !only || only.some((prefix) => test.group === prefix || test.id.startsWith(prefix)));
if (!selected.length) {
  console.error("没有匹配的用例；用 --list 查看。");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const artifacts = path.join(root, "release", "e2e", stamp);
fs.mkdirSync(artifacts, { recursive: true });
const dataDir = tempDataDir();
fs.mkdirSync(path.join(dataDir, "projects"), { recursive: true });
// Fake ACP：不依赖真实模型；POSIX 下用 shim 启动 Node 脚本
const fakeScript = path.join(root, "scripts", "e2e", "fixtures", "fake-dsh.mjs");
const fakeShim = path.join(dataDir, "fake-dsh");
let fakeDsh = null;
if (process.platform !== "win32") {
  fs.writeFileSync(fakeShim, `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`);
  fs.chmodSync(fakeShim, 0o755);
  fakeDsh = fakeShim;
}

let app;
let cdp;
let failed = 0;
let passed = 0;
let skipped = 0;
const results = [];

try {
  console.log(`[e2e] app data: ${dataDir}`);
  app = await launchApp({ root, port, dataDir, extraEnv: { FAKE_DSH_HOLD_MS: "10000", FAKE_DSH_LOG: path.join(dataDir, "fake-dsh.log") } });
  cdp = await (await import("./harness.mjs")).connect(port);
  await installHelpers(cdp);

  const ev = async (expression) => cdp.evaluate(expression);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = () => ev("window.harness.getState()");
  const action = async (type, payload = {}) => {
    const result = await ev(`(async()=>await window.harness.action(${JSON.stringify(type)}, ${JSON.stringify(payload)}))()`);
    return result && Object.prototype.hasOwnProperty.call(result, "result") ? result.result : result;
  };
  const send = (method, params = {}) => cdp.send(method, params);
  const ctx = { root, dataDir, tmp: dataDir, artifacts, ev, send, sleep, state, action, fakeDsh };

  // 等 renderer 首屏
  const ready = await ev(`(async()=>{const t=Date.now(); while(Date.now()-t<20000){ if(document.querySelector(".app") && window.harness) return true; await new Promise(r=>setTimeout(r,100)); } return false;})()`);
  if (!ready) throw new Error("应用首屏未就绪");

  for (const test of selected) {
    if (test.skip && !runSkipped) {
      console.log(`SKIP ${test.id.padEnd(10)} ${test.title} — ${test.skip}`);
      skipped += 1;
      results.push({ id: test.id, status: "skip", reason: test.skip });
      continue;
    }
    const started = Date.now();
    try {
      await Promise.race([
        test.fn(ctx),
        new Promise((_, reject) => setTimeout(() => reject(new Error("用例超时（90s）")), 90000)),
      ]);
      passed += 1;
      console.log(`PASS ${test.id.padEnd(10)} ${test.title} · ${Date.now() - started}ms`);
      results.push({ id: test.id, status: "pass", ms: Date.now() - started });
    } catch (err) {
      failed += 1;
      const message = String(err?.stack || err?.message || err);
      console.error(`FAIL ${test.id.padEnd(10)} ${test.title}\n${message}`);
      const shot = await screenshot(cdp, path.join(artifacts, `${test.id}.png`));
      results.push({ id: test.id, status: "fail", error: message, screenshot: shot });
    }
  }

  fs.writeFileSync(path.join(artifacts, "results.json"), JSON.stringify({ stamp, dataDir, results }, null, 2));
  console.log(`\n[e2e] ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`[e2e] artifacts: ${artifacts}`);
  if (failed) console.log(`[e2e] app log: ${app.logPath}`);
} catch (err) {
  console.error(`[e2e] 启动/执行失败：${String(err?.stack || err)}`);
  failed += 1;
} finally {
  try { cdp?.close(); } catch { /* ignore */ }
  try { await app?.close(); } catch { /* ignore */ }
  if (!keep && !failed) fs.rmSync(dataDir, { recursive: true, force: true });
  else console.log(`[e2e] 保留数据目录：${dataDir}`);
}

process.exit(failed ? 1 : 0);
