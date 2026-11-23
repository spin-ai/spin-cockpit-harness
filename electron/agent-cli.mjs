#!/usr/bin/env node
/**
 * `harness` CLI：终端 Agent 调用主进程窄通道（whoami / note / report）。
 * 只做 HTTP + token；真正的权限、线程归属、脱敏在主进程。
 */
import fs from "node:fs";
import process from "node:process";
import { parseAgentCliArgs, clipAgentText } from "./agent-bridge.mjs";

const url = process.env.COCKPIT_AGENT_URL || "";
const token = process.env.COCKPIT_AGENT_TOKEN || "";
const parsed = parseAgentCliArgs(process.argv.slice(2));
if (parsed.error) {
  console.error(parsed.error);
  process.exit(2);
}
if (!url || !token) {
  console.error("这条终端不在受管 run 里（没有 COCKPIT_AGENT_URL / TOKEN）");
  process.exit(2);
}
let text = parsed.text;
if (parsed.textFile) {
  try { text = fs.readFileSync(parsed.textFile, "utf8"); } catch (err) {
    console.error(`读不了 ${parsed.textFile}：${String(err?.message || err)}`);
    process.exit(2);
  }
}
const body = JSON.stringify({ command: parsed.command, text: clipAgentText(text, 4000) });
let res;
try {
  res = await fetch(`${url}/call`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body,
  });
} catch (err) {
  console.error(`连不上主进程：${String(err?.message || err)}`);
  process.exit(1);
}
const data = await res.json().catch(() => null);
if (!res.ok || !data?.ok) {
  console.error(data?.error || `HTTP ${res.status}`);
  process.exit(1);
}
if (parsed.json || parsed.command === "whoami") console.log(JSON.stringify(data));
else if (parsed.command === "note") console.log("✓ 已记录");
else console.log("✓ 已汇报");
