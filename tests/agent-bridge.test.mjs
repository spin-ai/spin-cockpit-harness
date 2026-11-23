/**
 * 终端 Agent 窄通道：CLI 参数 / PATH 垫片 / 截断口径。
 * 真正的 token 授权与线程归属在主进程；这里守住「只接受三种命令、不吞错参数、垫片可执行」。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test, report } from "./bot/_harness.mjs";
import {
  AGENT_CLI_COMMANDS,
  agentCliBinName,
  agentCliShimContent,
  clipAgentText,
  parseAgentCliArgs,
} from "../electron/agent-bridge.mjs";

await test("CLI 参数：whoami 不需要正文；note / report 接受 --text 或 --text-file", () => {
  assert.deepEqual(AGENT_CLI_COMMANDS, ["whoami", "note", "report"]);
  assert.deepEqual(parseAgentCliArgs(["whoami"]), { command: "whoami", text: "", textFile: "", json: false });
  const note = parseAgentCliArgs(["note", "--text", "跑起来了"]);
  assert.equal(note.command, "note");
  assert.equal(note.text, "跑起来了");
  const file = parseAgentCliArgs(["report", "--text-file", "/tmp/out.txt", "--json"]);
  assert.equal(file.textFile, "/tmp/out.txt");
  assert.equal(file.json, true);
});

await test("CLI 参数：未知命令 / 缺值 / note 没正文都要报错，不静默", () => {
  assert.match(parseAgentCliArgs([]).error, /用法/);
  assert.match(parseAgentCliArgs(["run"]).error, /用法/);
  assert.match(parseAgentCliArgs(["note", "--text"]).error, /需要一个值/);
  assert.match(parseAgentCliArgs(["note"]).error, /需要 --text/);
  assert.match(parseAgentCliArgs(["note", "--bogus", "x"]).error, /不认识参数/);
});

await test("正文截断：超长不产生半截代理对，末尾有省略号", () => {
  const text = clipAgentText("a".repeat(30), 10);
  assert.equal(text.length, 10);
  assert.ok(text.endsWith("…"));
  assert.equal(clipAgentText("短"), "短");
});

await test("PATH 垫片：Unix 用 node 模式跑脚本，路径被引号包住", () => {
  const shim = agentCliShimContent({ platform: "darwin", electronPath: "/Applications/Cockpit Harness.app/Contents/MacOS/Cockpit Harness", scriptPath: "/tmp/agent-cli.mjs" });
  assert.match(shim, /^#!\/bin\/sh/m);
  assert.match(shim, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(shim, /Cockpit Harness/);
  assert.match(shim, /"\$@"/);
  assert.equal(agentCliBinName("darwin"), "harness");
});

await test("PATH 垫片：Windows 生成 .cmd，保留 %*", () => {
  const shim = agentCliShimContent({ platform: "win32", electronPath: "C:\\Program Files\\Cockpit\\app.exe", scriptPath: "C:\\app\\agent-cli.mjs" });
  assert.match(shim, /@echo off/);
  assert.match(shim, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(shim, /%\\*/);
  assert.equal(agentCliBinName("win32"), "harness.cmd");
});

await test("CLI / MCP 脚本存在，主进程按 unpacked 路径能跑到", () => {
  const cli = path.join(process.cwd(), "electron", "agent-cli.mjs");
  assert.ok(fs.existsSync(cli), "electron/agent-cli.mjs 必须在仓库里");
  assert.match(fs.readFileSync(cli, "utf8"), /COCKPIT_AGENT_TOKEN/);
  const mcp = path.join(process.cwd(), "electron", "harness-mcp-bridge.mjs");
  assert.ok(fs.existsSync(mcp), "electron/harness-mcp-bridge.mjs 必须在仓库里");
  const text = fs.readFileSync(mcp, "utf8");
  assert.match(text, /harness_note/);
  assert.match(text, /harness_report/);
});

report("AgentBridge");
