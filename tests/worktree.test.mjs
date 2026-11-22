// worktree 生命周期：崩溃残留清理 + 目录隔离。
// 跑法：npm test -- worktree
//
// 只碰临时目录：HARNESS_WORKTREE_ROOT 把 worktree 根指到 mkdtemp，
// 否则会往用户 ~/Documents/<...>/worktrees 里建真目录。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-worktree-"));
process.env.HARNESS_WORKTREE_ROOT = path.join(tmp, "worktrees");

const { prepareWorktree, removeStaleWorktrees, repoRoot } = await import("../electron/worktree.mjs");

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (err) { console.error(`✗ ${name}\n  ${err?.message || err}`); process.exitCode = 1; }
}

const git = (cwd, ...args) => spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8" });
function makeRepo(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "README.md"), `${name}\n`);
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  return dir;
}

const repoA = makeRepo("repo-a");
const repoB = makeRepo("repo-b");
/** prepareWorktree 的目录名是 `<key>-<runId>-<stamp>`；这里直接按同一规则造残留 */
const dirFor = (repo, key, runId, stamp) => path.join(path.dirname(path.join(process.env.HARNESS_WORKTREE_ROOT, path.basename(repo), "x")), `${key}-${runId}-${stamp}`);

check("git 仓库识别：非仓库返回 null", () => {
  const plain = fs.mkdtempSync(path.join(tmp, "plain-"));
  assert.equal(repoRoot(plain), null);
});

check("prepareWorktree：建的目录名带 key 与 runId，并且落在临时根下", () => {
  const wt = prepareWorktree({ cwd: repoA, todoKey: "#1058", runId: "r1924", mode: "auto" });
  assert.equal(wt.created, true);
  assert.equal(path.dirname(wt.cwd), path.join(process.env.HARNESS_WORKTREE_ROOT, "repo-a"));
  assert.match(path.basename(wt.cwd), /^1058-r1924-[a-z0-9]+$/);
  assert.equal(fs.realpathSync(repoRoot(wt.cwd)), fs.realpathSync(wt.cwd), "worktree 里 rev-parse 应该指向自己");
});

check("removeStaleWorktrees：删掉同一 run 的残留，不动其它 run", () => {
  // 上一次进程死在 git worktree add 之后：run 还是 queued、没有 cwd，目录没人认领
  const stale = path.join(process.env.HARNESS_WORKTREE_ROOT, "repo-b", "1058-r1924-p3htr");
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  const add = spawnSync("git", ["worktree", "add", "-b", "harness/1058-r1924-p3htr", stale, "HEAD"], { cwd: repoB, encoding: "utf8" });
  assert.equal(add.status, 0, add.stderr);
  const keep = prepareWorktree({ cwd: repoB, todoKey: "#1067", runId: "r1704", mode: "auto" });
  assert.equal(keep.created, true);

  assert.equal(removeStaleWorktrees(repoB, "#1058", "r1924"), 1);
  assert.equal(fs.existsSync(dirFor(repoB, "1058", "r1924", "p3htr")), false, "残留目录应该没了");
  assert.equal(fs.existsSync(keep.cwd), true, "其它 run 的 worktree 不能被顺手删掉");
  // git 侧的登记也要清掉，否则 `git worktree list` 会一直挂着一条失效路径
  const listed = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: repoB, encoding: "utf8" }).stdout;
  assert.equal(listed.includes("1058-r1924-p3htr"), false);
});

check("removeStaleWorktrees：没有残留时返回 0，不报错", () => {
  assert.equal(removeStaleWorktrees(repoA, "#9999", "r1"), 0);
  assert.equal(removeStaleWorktrees(path.join(tmp, "no-repo"), "#1058", "r1924"), 0);
  assert.equal(removeStaleWorktrees(repoA, "#1058", ""), 0, "没有 runId 不能按前缀乱删");
});

check("prepareWorktree mode=always：不是 git 仓库时报错，不静默原地跑", () => {
  const plain = fs.mkdtempSync(path.join(tmp, "plain2-"));
  const wt = prepareWorktree({ cwd: plain, todoKey: "#1", runId: "r1", mode: "always" });
  assert.equal(wt.created, false);
  assert.match(String(wt.error), /always/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed`);
