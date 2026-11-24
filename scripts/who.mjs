#!/usr/bin/env node
/**
 * 「谁在干活」一眼看板。
 *
 * 用法：npm run who
 *
 * 回答四个问题：
 *   1. 有几个 worktree、各自停在哪、干净不干净
 *   2. 本地跟远端差多少（要不要 pull）
 *   3. 现在有哪些 agent 进程的 cwd 在这个仓库（PID / 时长 / 忙闲）
 *   4. 最近几个提交是谁提的、还有哪些文件没提交（谁刚动过）
 *
 * 只读：不改工作区、不 fetch（要拉最新先自己 git fetch）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};
const pad = (s, n) => String(s).padEnd(n);
const ago = (ms) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 90) return `${s} 秒前`;
  if (s < 5400) return `${Math.round(s / 60)} 分钟前`;
  if (s < 172800) return `${Math.round(s / 3600)} 小时前`;
  return `${Math.round(s / 86400)} 天前`;
};
const dur = (sec) => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d${h}h` : h ? `${h}h${m}m` : `${m}m`;
};

// ── 1. worktree ────────────────────────────────────────────────────────────
console.log("## worktree");
const trees = git("worktree", "list", "--porcelain").split("\n\n").filter(Boolean).map((block) => {
  const lines = block.split("\n");
  const get = (k) => lines.find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) || "";
  return { path: get("worktree"), head: get("HEAD").slice(0, 7), branch: (get("branch") || "").replace("refs/heads/", ""), detached: lines.includes("detached") };
});
for (const t of trees) {
  const dirty = sh("git", ["-C", t.path, "status", "--porcelain"]).split("\n").filter(Boolean).length;
  const main = t.path === root ? "  ← 主仓库" : "";
  console.log(`  ${pad(t.head, 8)} ${pad(t.branch || "(detached)", 34)} ${pad(dirty ? `${dirty} 处未提交` : "干净", 12)} ${t.path}${main}`);
}
if (trees.length === 1) console.log("  （没有附加 worktree）");

// ── 2. 跟远端差多少 ────────────────────────────────────────────────────────
console.log("\n## 跟远端");
const up = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
if (!up) {
  console.log("  当前分支没有 upstream");
} else {
  const [behind, ahead] = git("rev-list", "--left-right", "--count", `HEAD...${up}`).split(/\s+/).map(Number);
  console.log(`  ${up}：落后 ${behind} · 领先 ${ahead}${behind ? "   ← 建议 git pull --ff-only" : ""}`);
  const fetched = Number(sh("git", ["-C", root, "log", "-1", "--format=%ct", up]).trim() || 0);
  if (fetched) console.log(`  upstream 最后一次提交：${ago(fetched * 1000)}`);
}

// ── 3. 活着的 agent 进程（cwd 在本仓库） ───────────────────────────────────
console.log("\n## agent 进程");
const agents = [];
const psOut = sh("ps", ["-Ao", "pid=,etime=,pcpu=,comm="]);
for (const line of psOut.split("\n")) {
  const m = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
  if (!m) continue;
  const [, pid, etime, cpu, comm] = m;
  if (!/\bpi$|^pi$|opencode|claude|codex/.test(comm.trim())) continue;
  const cwd = (sh("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]) || "").split("\n").find((l) => l.startsWith("n"))?.slice(1);
  if (cwd && (cwd === root || cwd.startsWith(`${root}/`))) agents.push({ pid, etime, cpu, comm, cwd });
}
if (!agents.length) console.log("  （没有跑在本仓库上的 agent 进程）");
for (const a of agents) {
  const parts = a.etime.split("-");
  const clock = parts.pop().split(":").map(Number);
  const days = parts.length ? Number(parts[0]) : 0;
  const sec = days * 86400 + clock[0] * 3600 + clock[1] * 60 + clock[2];
  const busy = Number(a.cpu) > 1 ? "忙" : "空闲";
  const self = String(a.pid) === String(process.ppid) ? "  ← 本会话" : "";
  console.log(`  PID ${pad(a.pid, 8)} ${pad(dur(sec), 8)} ${pad(busy, 5)} ${pad(a.cwd === root ? "." : a.cwd.slice(root.length + 1), 16)}${self}`);
}

// ── 4. 最近提交 + 未提交 ──────────────────────────────────────────────────
console.log("\n## 最近提交（谁提的）");
for (const line of git("log", "--format=%h\t%an\t%ar\t%s", "-6").split("\n").filter(Boolean)) {
  const [hash, author, when, subject] = line.split("\t");
  console.log(`  ${pad(hash, 8)} ${pad(author, 22)} ${pad(when, 14)} ${subject.slice(0, 60)}`);
}

console.log("\n## 未提交（谁刚动过）");
const status = git("status", "--porcelain").split("\n").filter(Boolean);
if (!status.length) console.log("  干净");
for (const line of status.slice(0, 12)) {
  const file = line.slice(3).trim();
  let when = "";
  try {
    when = ago(statSync(path.join(root, file)).mtimeMs);
  } catch {
    when = "（已删除）";
  }
  console.log(`  ${pad(line.slice(0, 2).trim() || "?", 4)} ${pad(when, 12)} ${file}`);
}

// 提示：worktree 级 git 身份
if (git("config", "--get", "extensions.worktreeConfig") === "true") {
  try {
    readFileSync(path.join(root, ".git", "config"), "utf8");
    console.log("\n提示：本仓库启用了 worktree 级 git 身份（extensions.worktreeConfig）—— 不同 worktree 可以用不同 user.name 提交，看到陌生作者先查 `git worktree list`。");
  } catch { /* ignore */ }
}
