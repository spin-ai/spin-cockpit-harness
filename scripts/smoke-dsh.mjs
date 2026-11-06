#!/usr/bin/env node
/**
 * 对打包用的 dsh 单文件运行时做冒烟测试：
 *   1) --version
 *   2) ACP initialize
 *   3) ACP session/new
 *
 * 用法：node scripts/smoke-dsh.mjs [path-to-dsh]
 * 默认读 resources/dsh/dsh（Windows 为 dsh.exe）。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = process.argv[2] || path.join(root, "resources", "dsh", process.platform === "win32" ? "dsh.exe" : "dsh");

if (!existsSync(bin)) {
  console.error(`[smoke:dsh] not found: ${bin}`);
  process.exit(1);
}

const version = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30000 });
const text = (version.stdout || version.stderr || "").trim();
if (version.status !== 0) {
  console.error(`[smoke:dsh] --version failed (${version.status}): ${text}`);
  process.exit(1);
}
console.log(`[smoke:dsh] ${bin}`);
console.log(`[smoke:dsh] version: ${text.split("\n").pop()}`);

const home = mkdtempSync(path.join(os.tmpdir(), "dsh-smoke-"));
const cwd = mkdtempSync(path.join(os.tmpdir(), "dsh-cwd-"));
const child = spawn(bin, ["--profile", "acp"], {
  cwd,
  env: { ...process.env, DSH_HOME: home },
  stdio: ["pipe", "pipe", "pipe"],
});
const rl = readline.createInterface({ input: child.stdout });
const timeout = setTimeout(() => {
  console.error("[smoke:dsh] ACP timeout");
  child.kill("SIGKILL");
  cleanup(1);
}, 90000);

let initialized = false;
let stderr = "";
child.stderr.on("data", (b) => { stderr += b.toString(); });

function send(message) {
  child.stdin.write(JSON.stringify(message) + "\n");
}

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === 1) {
    if (msg.error) { console.error("[smoke:dsh] initialize error:", msg.error); cleanup(1); return; }
    initialized = true;
    console.log(`[smoke:dsh] initialize OK · ${msg.result?.agentInfo?.name}`);
    send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd, mcpServers: [] } });
  } else if (msg.id === 2) {
    if (msg.error) { console.error("[smoke:dsh] session/new error:", msg.error); cleanup(1); return; }
    console.log(`[smoke:dsh] session/new OK · ${msg.result?.sessionId}`);
    cleanup(0);
  }
});

child.on("exit", (code) => {
  if (!initialized) {
    console.error(`[smoke:dsh] exited early (${code})${stderr ? `\n${stderr}` : ""}`);
    cleanup(1);
  }
});

let cleaned = false;
function cleanup(code) {
  if (cleaned) return;
  cleaned = true;
  clearTimeout(timeout);
  try { child.kill("SIGTERM"); } catch { /* ignore */ }

  // On Windows the dsh process can release its temp-directory handles slightly
  // after exit. Wait for close, then retry the removal instead of failing the
  // whole package job on a transient EPERM.
  const remove = () => {
    for (const dir of [home, cwd]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      } catch (err) {
        console.warn(`[smoke:dsh] cleanup warning for ${dir}: ${err.message}`);
      }
    }
    process.exit(code);
  };
  const delay = () => setTimeout(remove, 500);
  if (child.exitCode !== null) delay();
  else child.once("close", delay);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: 2, info: { name: "smoke-dsh", version: "0" }, capabilities: {} },
});
