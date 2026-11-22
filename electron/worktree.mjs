import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || process.cwd();
// 老安装仍在 ~/Documents/YieldMind/worktrees；新安装用 Cockpit Harness
const LEGACY_ROOT = path.join(HOME, "Documents", "YieldMind", "worktrees");
// HARNESS_WORKTREE_ROOT 只给用例用：测试不能在用户 Documents 下建 worktree
const ROOT = process.env.HARNESS_WORKTREE_ROOT || (fs.existsSync(path.join(HOME, "Documents", "YieldMind"))
  ? LEGACY_ROOT
  : path.join(HOME, "Documents", "Cockpit Harness", "worktrees"));

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

export function repoRoot(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return null;
  const r = run("git", ["rev-parse", "--show-toplevel"], cwd);
  return r.ok && r.out ? r.out : null;
}

/**
 * mode:
 * - never：原地跑，不建 worktree
 * - auto：git 仓库才建（默认）
 * - always：要求 git；不是仓库时报错，避免用户以为已经隔离
 */
export function prepareWorktree({ cwd, todoKey, runId, mode = "auto" }) {
  const repo = repoRoot(cwd);
  if (mode === "never") return { cwd, branch: null, repo, created: false, skipped: "never" };
  if (!repo) {
    if (mode === "always") return { cwd, branch: null, repo: null, created: false, error: "worktree=always 但当前目录不是 git 仓库" };
    return { cwd, branch: null, repo: null, created: false };
  }

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

/**
 * 清掉同一次派活（key + runId）上次留下的 worktree。
 * 目录名是 `<key>-<runId>-<stamp>`；进程在 `git worktree add` 之后、写 startedAt 之前挂掉，
 * 就会留下一个没人认领的目录（run 重启后还是 queued，没有 cwd）。同一个 run 只会有一个是活的。
 */
export function removeStaleWorktrees(cwd, todoKey, runId) {
  const repo = repoRoot(cwd);
  if (!repo || !runId) return 0;
  const safeKey = String(todoKey || "todo").replace(/[^a-zA-Z0-9_-]/g, "");
  const root = path.join(ROOT, path.basename(repo));
  const prefix = `${safeKey}-${runId}-`;
  let names = [];
  try { names = fs.readdirSync(root).filter((n) => n.startsWith(prefix)); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    const dir = path.join(root, name);
    const r = run("git", ["worktree", "remove", "--force", dir], repo);
    if (!r.ok) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    if (!fs.existsSync(dir)) removed += 1;
  }
  if (removed) { try { run("git", ["worktree", "prune"], repo); } catch { /* ignore */ } }
  return removed;
}

export const WORKTREE_ROOT = ROOT;
/** 历史上两套根并存（YieldMind 与 Cockpit Harness）；清理时要都认 */
export const WORKTREE_ROOTS = [...new Set([ROOT, path.join(HOME, "Documents", "Cockpit Harness", "worktrees"), LEGACY_ROOT])];
export const underWorktreeRoot = (dir) => WORKTREE_ROOTS.some((root) => path.resolve(dir).startsWith(path.resolve(root) + path.sep));

/** 列出仓库下所有 worktree（含主工作区） */
export function listWorktrees(repo) {
  const r = run("git", ["worktree", "list", "--porcelain"], repo);
  if (!r.ok) return [];
  const out = [];
  let cur = null;
  for (const line of r.out.split("\n")) {
    if (line.startsWith("worktree ")) { cur = { dir: line.slice(9) }; out.push(cur); }
    else if (cur && line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (cur && line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (cur && line === "detached") cur.detached = true;
  }
  return out.map((w) => {
    const ageMs = (() => { try { return Date.now() - fs.statSync(w.dir).mtimeMs; } catch { return Infinity; } })();
    return { ...w, isMain: path.resolve(w.dir) === path.resolve(repo), ageDays: Math.round(ageMs / 86400000) };
  });
}

/**
 * 清理 harness 自己建的 worktree：
 * - 只动 ROOT 下的目录（不碰主工作区和用户自己的 worktree）
 * - 分支默认保留（避免删掉未合并的提交）；mergedOnly=true 时只删已并入 base 的分支
 */
export function pruneWorktrees(repo, { keepDays = 0, mergedOnly = true, base = "HEAD", exclude = [] } = {}) {
  const removed = [];
  const kept = [];
  const skip = new Set((exclude || []).map((d) => path.resolve(d)));
  for (const w of listWorktrees(repo)) {
    if (w.isMain) continue;
    if (!underWorktreeRoot(w.dir)) continue;
    if (skip.has(path.resolve(w.dir))) { kept.push({ ...w, reason: "正在运行" }); continue; }
    if (Number.isFinite(w.ageDays) && w.ageDays < keepDays) { kept.push(w); continue; }
    const rm = run("git", ["worktree", "remove", "--force", w.dir], repo);
    if (!rm.ok) { kept.push({ ...w, error: rm.err || "remove failed" }); continue; }
    let branchDeleted = false;
    if (w.branch) {
      const merged = run("git", ["branch", "--merged", base, "--format=%(refname:short)"], repo);
      const isMerged = merged.ok && merged.out.split("\n").map((x) => x.trim()).includes(w.branch);
      if (!mergedOnly || isMerged) branchDeleted = run("git", ["branch", "-D", w.branch], repo).ok;
    }
    removed.push({ dir: w.dir, branch: w.branch || "", branchDeleted });
  }
  return { removed, kept };
}
