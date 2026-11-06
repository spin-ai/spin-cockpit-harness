import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || process.cwd();
// 老安装仍在 ~/Documents/YieldMind/worktrees；新安装用 Cockpit Harness
const LEGACY_ROOT = path.join(HOME, "Documents", "YieldMind", "worktrees");
const ROOT = fs.existsSync(path.join(HOME, "Documents", "YieldMind"))
  ? LEGACY_ROOT
  : path.join(HOME, "Documents", "Cockpit Harness", "worktrees");

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

export function repoRoot(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return null;
  const r = run("git", ["rev-parse", "--show-toplevel"], cwd);
  return r.ok && r.out ? r.out : null;
}

export function prepareWorktree({ cwd, todoKey, runId }) {
  const repo = repoRoot(cwd);
  if (!repo) return { cwd, branch: null, repo: null, created: false };

  const safeKey = String(todoKey || "todo").replace(/[^a-zA-Z0-9_-]/g, "");
  const stamp = Date.now().toString(36).slice(-5);
  const branch = `harness/${safeKey}-${runId}-${stamp}`;
  const dir = path.join(ROOT, path.basename(repo), `${safeKey}-${runId}-${stamp}`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const add = run("git", ["worktree", "add", "-b", branch, dir, "HEAD"], repo);
  if (!add.ok) {
    return { cwd, branch: null, repo, created: false, error: add.err || "git worktree add failed" };
  }
  return { cwd: dir, branch, repo, created: true };
}

export function removeWorktree(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  const repo = repoRoot(dir);
  if (!repo) return false;
  const r = run("git", ["worktree", "remove", "--force", dir], repo);
  return r.ok;
}
