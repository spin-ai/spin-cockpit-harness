#!/usr/bin/env node
/**
 * ACP 续跑（session/resume）自检：这是「应用重启后能不能接着干」的唯一证据。
 *
 * 做法（不碰用户 userData，不联网）：
 *   1) 起一个 dsh --profile acp，session/new 拿到 sessionId；
 *   2) **直接 SIGKILL** 掉进程（模拟应用被杀，而不是优雅关闭）；
 *   3) 起第二个进程，session/list 应能看到那个会话；
 *   4) session/resume({ sessionId, cwd, mcpServers }) 应该成功，并且带着 configOptions 回来；
 *   5) 顺带验两条负面事实：缺 cwd 报 Invalid params；同一进程里 resume 活跃会话会失败。
 *
 * 用法：npm test -- acp-resume [dsh 路径]
 * 没有 dsh 二进制时**跳过**（退出码 0），因为 CI 的 Linux/Windows runner 上不一定有内置运行时。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  process.argv[2],
  path.join(root, "resources", "dsh", process.platform === "win32" ? "dsh.exe" : "dsh"),
  spawnSync(process.platform === "win32" ? "where" : "which", ["dsh"], { encoding: "utf8" }).stdout?.trim().split("\n")[0],
].filter(Boolean);

const bin = candidates.find((p) => p && existsSync(p));
if (!bin) {
  console.log("[acp-resume] 跳过：没找到 dsh 二进制（用 node scripts/bundle-dsh.mjs 准备内置运行时）");
  process.exit(0);
}

const home = mkdtempSync(path.join(os.tmpdir(), "acp-resume-home-"));
const cwd = mkdtempSync(path.join(os.tmpdir(), "acp-resume-cwd-"));
let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else { failures += 1; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

/** 起一个会话进程，返回 { call, kill, sessions } */
function launch() {
  const child = spawn(bin, ["--profile", "acp"], { cwd, env: { ...process.env, DSH_HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let seq = 0;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const slot = msg.id != null ? pending.get(msg.id) : null;
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.error) slot.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else slot.resolve(msg.result);
  });
  child.stderr.on("data", () => {});
  const call = (method, params = {}, timeoutMs = 20000) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, timeoutMs).unref?.();
  });
  return { child, call, kill: (signal = "SIGKILL") => { try { child.kill(signal); } catch { /* 已退出 */ } } };
}

console.log(`ACP 续跑自检 · ${bin}\n`);

const one = launch();
let sessionId = "";
try {
  await one.call("initialize", { protocolVersion: 2, info: { name: "acp-resume-selftest", version: "0" }, capabilities: {} });
  const created = await one.call("session/new", { cwd, mcpServers: [] });
  sessionId = created?.sessionId || "";
  check("session/new 拿到 sessionId", Boolean(sessionId), sessionId.slice(0, 8));

  // 同进程里 resume 活跃会话：必须失败（这条写进 ARCH，避免以后误用）
  let activeErr = "";
  try { await one.call("session/resume", { sessionId, cwd, mcpServers: [] }); } catch (err) { activeErr = String(err?.message || err); }
  check("活跃会话不能在同一进程内 resume", /already active|Invalid params/i.test(activeErr), activeErr.slice(0, 60));
} finally {
  one.kill("SIGKILL");
}

// 等进程真的死掉
await new Promise((r) => setTimeout(r, 300));

const two = launch();
try {
  await two.call("initialize", { protocolVersion: 2, info: { name: "acp-resume-selftest", version: "0" }, capabilities: {} });
  const list = await two.call("session/list", {});
  const found = (list?.sessions || []).some((s) => s.sessionId === sessionId);
  check("重启后 session/list 还能看到它", found, `${(list?.sessions || []).length} 个会话`);

  let missingCwdErr = "";
  try { await two.call("session/resume", { sessionId }); } catch (err) { missingCwdErr = String(err?.message || err); }
  check("resume 缺 cwd 会被拒（参数形状记进 ARCH）", /Invalid params/i.test(missingCwdErr), missingCwdErr.slice(0, 60));

  const resumed = await two.call("session/resume", { sessionId, cwd, mcpServers: [] });
  check("resume 成功并带回 configOptions", Array.isArray(resumed?.configOptions), `${(resumed?.configOptions || []).length} 个配置项`);

  const bogus = await two.call("session/resume", { sessionId: "00000000-0000-0000-0000-000000000000", cwd, mcpServers: [] }).then(() => "").catch((err) => String(err?.message || err));
  check("不存在的 sessionId 会报错，不会静默造一个新会话", Boolean(bogus), bogus.slice(0, 60));
} finally {
  two.kill("SIGKILL");
}

rmSync(home, { recursive: true, force: true });
rmSync(cwd, { recursive: true, force: true });
console.log(`\nACP 续跑：${failures ? "failed" : "passed"}`);
process.exit(failures ? 1 : 0);
