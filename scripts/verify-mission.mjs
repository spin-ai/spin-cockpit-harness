#!/usr/bin/env node
/**
 * Keyless Mission 验证：
 *   1. SQLite schema / mission / delegation 持久化
 *   2. MCP stdio bridge 握手、tools/list、tools/call → HTTP Main
 *   3. dsh ACP supervisor profile + stdio MCP 挂载（不调用模型）
 *
 * 用法：node scripts/verify-mission.mjs
 * 缺少 resources/dsh 时跳过 dsh 部分（CI 打包前可能没有二进制）。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { openDb } from "../electron/db.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const ok = (name, detail = "") => { results.push({ ok: true, name, detail }); console.log(`✓ ${name}${detail ? ` · ${detail}` : ""}`); };
const fail = (name, err) => { results.push({ ok: false, name, detail: String(err?.stack || err) }); console.error(`✗ ${name}\n${String(err?.stack || err)}`); };

function waitLine(child) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdout });
    const timer = setTimeout(() => { rl.close(); reject(new Error("timeout")); }, 15000);
    rl.once("line", (line) => { clearTimeout(timer); rl.close(); resolve(line); });
    child.once("exit", (code) => { clearTimeout(timer); rl.close(); reject(new Error(`exited ${code}`)); });
  });
}

async function jsonRpc(child, method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: method + "-1", method, params }) + "\n");
  for (;;) {
    const line = await waitLine(child);
    const msg = JSON.parse(line);
    if (msg.id === method + "-1") {
      if (msg.error) throw new Error(msg.error.message || method);
      return msg.result;
    }
  }
}

async function testBridge() {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: { ok: true, echo: JSON.parse(raw).name } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const child = spawn(process.execPath, [path.join(root, "electron/mcp-bridge.mjs")], {
    env: { ...process.env, COCKPIT_MCP_URL: `http://127.0.0.1:${port}/call`, COCKPIT_MCP_TOKEN: "test", COCKPIT_MISSION_ID: "m-test" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    const init = await jsonRpc(child, "initialize", { protocolVersion: "2024-11-05", capabilities: {} });
    assert.equal(init.serverInfo.name, "cockpit-mission");
    const list = await jsonRpc(child, "tools/list", {});
    assert.ok(list.tools.some((t) => t.name === "mission_plan"));
    assert.ok(list.tools.some((t) => t.name === "task_delegate"));
    const call = await jsonRpc(child, "tools/call", { name: "mission_plan", arguments: { plan: { steps: [] } } });
    assert.match(call.content[0].text, /mission_plan/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].missionId, "m-test");
    ok("MCP bridge", `${list.tools.length} tools · HTTP forwarded`);
  } finally {
    child.kill("SIGTERM");
    server.close();
  }
}

async function testDshProfile() {
  const bin = path.join(root, "resources/dsh", process.platform === "win32" ? "dsh.exe" : "dsh");
  if (!fs.existsSync(bin)) { console.log("… 跳过 dsh profile（resources/dsh 不存在）"); return; }
  const fake = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, result: {} })); });
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const port = fake.address().port;
  const patch = path.join(root, "electron/dsh-supervisor.patch.yml");
  const bridge = path.join(root, "electron/mcp-bridge.mjs");
  const child = spawn(bin, ["--profile", "acp", "--patch", patch], { cwd: root, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] });
  try {
    await jsonRpc(child, "initialize", { protocolVersion: 2, info: { name: "verify-mission", version: "0" }, capabilities: {} });
    const mcpServers = [{
      name: "cockpit", command: process.execPath, args: [bridge],
      env: [
        { name: "COCKPIT_MCP_URL", value: `http://127.0.0.1:${port}/call` },
        { name: "COCKPIT_MCP_TOKEN", value: "verify" },
        { name: "COCKPIT_MISSION_ID", value: "m-verify" },
      ],
    }];
    const session = await jsonRpc(child, "session/new", { cwd: root, mcpServers });
    assert.ok(session.sessionId);
    assert.ok(Array.isArray(session.configOptions));
    await jsonRpc(child, "session/close", { sessionId: session.sessionId });
    ok("dsh supervisor profile", "ACP + patch + stdio MCP mount");
  } finally {
    child.kill("SIGTERM");
    fake.close();
  }
}

async function testDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-mission-db-"));
  try {
    const db = await openDb(dir);
    db.state.todos.push({
      id: "t1", key: "#1", title: "mission", desc: "", acceptance: [], status: "queued", agentId: null,
      priority: "P1", due: "", parentId: null, tags: ["mission"], subtasks: [], blockedBy: [],
      missingWriteback: false, lastRunFailed: false, confirmed: false, cwd: dir, projectId: null,
      kind: "mission", missionState: "plan_review", createdAt: 1, updatedAt: 1,
    });
    db.state.missionPlans.push({ id: "mp1", missionId: "t1", revision: 1, status: "draft", plan: { steps: [] }, createdAt: 1, approvedAt: null });
    db.state.delegations.push({
      id: "d1", missionId: "t1", supervisorRunId: "r1", childTodoId: "t2", childRunId: "r2", agentId: "a1",
      planStepKey: "s1", title: "child", brief: "", acceptance: [], status: "queued",
      resultSummary: "", artifacts: [], branch: null, createdAt: 1, updatedAt: 1, completedAt: null,
    });
    db.flush();
    const again = await openDb(dir);
    assert.equal(again.state.missionPlans.length, 1);
    assert.equal(again.state.delegations.length, 1);
    assert.equal(again.state.todos[0].missionState, "plan_review");
    again.flush();
    ok("SQLite Mission schema", "mission_plans + delegations round-trip");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

try {
  await testDb();
  await testBridge();
  await testDshProfile();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMission verification: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
} catch (err) {
  fail("Mission verification", err);
  process.exitCode = 1;
}
