#!/usr/bin/env node
/**
 * WADE 开发环境预检。
 *
 * 迁移自 spin-yieldmind-app，但模型从 Anthropic 换成当前 opencode 已认证的
 * DeepSeek：opencode 没有 Anthropic key 时，wade plan/implement 会直接 run failed。
 *
 * 检查：
 * 1. .wade.yml 能被 wade 解析
 * 2. 配置里的每个 model 都在 `opencode models` 里
 * 3. GitHub feature-plan label 存在
 * 4. git user.name / user.email 存在（否则 WADE commit 会失败）
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fail = (message) => { console.error(`✗ ${message}`); process.exitCode = 1; };
const ok = (message) => console.log(`✓ ${message}`);
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const configPath = path.join(root, ".wade.yml");
if (!fs.existsSync(configPath)) {
  fail("缺少 .wade.yml；先运行 wade init --ai opencode");
  process.exit();
}

try {
  run("wade", ["check-config"]);
  ok(".wade.yml 有效");
} catch (error) {
  fail(`.wade.yml 无效：${error.stderr || error.message}`);
}

const config = fs.readFileSync(configPath, "utf8");
const models = [...config.matchAll(/^\s*model:\s*([^\s#]+)\s*$/gm)].map((m) => m[1]);
let available = new Set();
try {
  available = new Set(run("opencode", ["models"]).split("\n").map((line) => line.trim()).filter(Boolean));
} catch (error) {
  fail(`无法读取 opencode 模型：${error.stderr || error.message}`);
}
const missing = [...new Set(models)].filter((model) => !available.has(model));
if (missing.length) {
  fail(`WADE 模型未认证/不存在：${missing.join(", ")}；运行 opencode auth list，或把 .wade.yml 改成已认证模型`);
} else {
  ok(`WADE 模型可用：${[...new Set(models)].join(", ")}`);
}

try {
  const labels = run("gh", ["label", "list", "--limit", "100"]);
  if (!labels.split("\n").some((line) => line.startsWith("feature-plan\t"))) fail("缺少 GitHub label：feature-plan");
  else ok("GitHub label feature-plan 存在");
} catch (error) {
  fail(`无法读取 GitHub label（gh 未登录？）：${error.stderr || error.message}`);
}

try {
  const name = run("git", ["config", "user.name"]);
  const email = run("git", ["config", "user.email"]);
  if (!name || !email) fail("git user.name / user.email 未配置，WADE 提交会失败");
  else ok(`git 提交身份：${name} <${email}>`);
} catch {
  fail("git user.name / user.email 未配置，WADE 提交会失败");
}

if (process.exitCode) process.exit(process.exitCode);
console.log("\nWADE preflight passed");
