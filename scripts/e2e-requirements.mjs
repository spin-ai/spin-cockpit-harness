#!/usr/bin/env node
/**
 * 验收用例 E2E runner：启动隔离 userData 的 Electron，按 TEST-REQ-modules-original.md
 * 的 P0 子集执行 UI / 设置 / 主题 / Git Wiki / 文件 / Notes / 适配器检查。
 *
 * 用法：
 *   npm run test:e2e:requirements
 *   npm run test:e2e:requirements -- --list
 *   npm run test:e2e:requirements -- --only=THEME,GIT
 *   npm run test:e2e:requirements -- --keep
 *
 * 前置：已运行 npm run build（使用 dist/index.html）。
 */
import fs from "node:fs";
import path from "node:path";
import { freePort, installHelpers, launchApp, repoRoot, screenshot, tempDataDir } from "./e2e/harness.mjs";
import { TESTS } from "./e2e/suites/requirements.mjs";

const root = repoRoot();
const args = process.argv.slice(2);
const list = args.includes("--list");
const keep = args.includes("--keep");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
const portArg = args.find((a) => a.startsWith("--port="));
const port = portArg ? Number(portArg.slice("--port=".length)) : await freePort();

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

let app;
let cdp;
let failed = 0;
let passed = 0;
let skipped = 0;
const results = [];

try {
  console.log(`[e2e] app data: ${dataDir}`);
  app = await launchApp({ root, port, dataDir });
  cdp = await (await import("./e2e/harness.mjs")).connect(port);
  await installHelpers(cdp);

  const ev = async (expression) => cdp.evaluate(expression);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const state = () => ev("window.harness.getState()");
  const action = async (type, payload = {}) => {
    const result = await ev(`(async()=>await window.harness.action(${JSON.stringify(type)}, ${JSON.stringify(payload)}))()`);
    return result && Object.prototype.hasOwnProperty.call(result, "result") ? result.result : result;
  };
  const ctx = { root, dataDir, tmp: dataDir, artifacts, ev, sleep, state, action };

  // 等 renderer 首屏
  const ready = await ev(`(async()=>{const t=Date.now(); while(Date.now()-t<20000){ if(document.querySelector(".app") && window.harness) return true; await new Promise(r=>setTimeout(r,100)); } return false;})()`);
  if (!ready) throw new Error("应用首屏未就绪");

  for (const test of selected) {
    if (test.skip) {
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
