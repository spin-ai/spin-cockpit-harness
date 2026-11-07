#!/usr/bin/env node
/**
 * Git（Source Control）冒烟：状态 / diff / 暂存 / 提交 / 分支。
 *
 * 前置：隔离 userData 的实例带调试端口在跑（会自建 /tmp/git-fixture 仓库）：
 *   COCKPIT_USER_DATA=/tmp/cockpit-e2e \
 *     ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . --remote-debugging-port=9223
 *
 * 用法：node scripts/e2e-git.mjs [port]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const port = Number(process.argv[2] || 9223);
const REPO = "/tmp/git-fixture";
fs.rmSync(REPO, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
const sh = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" });
sh("init", "-q", "-b", "main");
sh("config", "user.email", "e2e@example.com");
sh("config", "user.name", "E2E");
fs.writeFileSync(`${REPO}/a.txt`, "line1\nline2\n");
fs.writeFileSync(`${REPO}/b.txt`, "old\n");
sh("add", "-A");
sh("commit", "-q", "-m", "init: 初始提交");
fs.writeFileSync(`${REPO}/a.txt`, "line1\nline2 changed\nline3\n");
fs.writeFileSync(`${REPO}/new.txt`, "new file\n");
fs.writeFileSync(`${REPO}/b.txt`, "old\nstaged line\n");
sh("add", "b.txt");
/** 建立/重连 CDP（vite 首次优化依赖会强制 reload，旧 session 会卡住） */
async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((t) => t.type === "page");
  if (!target) throw new Error("no page target");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  socket.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (msg) => (msg.error ? rej(new Error(msg.error.message)) : res(msg)));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
    return r.result?.result?.value;
  };
  return { socket, evaluate };
}

const HELPERS = `window.__t={wait:(ms)=>new Promise(r=>setTimeout(r,ms)),click(el){el.dispatchEvent(new MouseEvent("click",{bubbles:true}))},
 setValue(el,v){const p=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}))},
 async until(fn,ms=8000){const t0=Date.now();while(Date.now()-t0<ms){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,80));}return null;}}; true`;

let conn = await connect();
await conn.evaluate(HELPERS);
let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " · " + d : ""}`); };
/** 单步带超时 + 断线重连重试：页面 reload 时不至于让整个脚本挂住 */
const run = async (code, tries = 3) => {
  for (let i = 1; i <= tries; i += 1) {
    try {
      return await Promise.race([
        conn.evaluate(`(async()=>{ ${code} })()`),
        new Promise((_, rej) => setTimeout(() => rej(new Error("eval timeout")), 20000)),
      ]);
    } catch (err) {
      if (i === tries) throw err;
      await new Promise((r) => setTimeout(r, 800));
      conn = await connect();
      await conn.evaluate(HELPERS);
    }
  }
};
const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" });

// 打开项目 + Git 视图
let r = await run(`
  await window.harness.action("addProject", { path: "${REPO}", name: "git-fixture" });
  const s = await window.harness.getState();
  const p = s.projects.find((x) => x.name === "git-fixture");
  await window.harness.action("switchProject", { id: p.id });
  await __t.wait(600);
  const rail = [...document.querySelectorAll(".rail-btn")].find((b) => b.textContent.trim() === "Git");
  if (!rail) return { error: "no git rail" };
  __t.click(rail);
  const page = await __t.until(() => document.querySelector(".git-page"));
  const head = await __t.until(() => document.querySelector(".git-page .page-head .muted"));
  return { page: !!page, head: head?.textContent, files: [...document.querySelectorAll(".git-file .mono")].map((e) => e.textContent.trim()) };`);
check("Git 视图：分支 + 变更文件列表", r.page === true && (r.head || "").includes("main") && r.files.includes("a.txt") && r.files.includes("new.txt"), JSON.stringify(r));

// 选中文件看 diff
r = await run(`
  const row = [...document.querySelectorAll(".git-file")].find((el) => el.textContent.includes("a.txt"));
  __t.click(row);
  const d = await __t.until(() => document.querySelector(".git-diff"), 5000);
  const add = [...d.querySelectorAll(".git-diff-line.add")].map((e) => e.textContent.trim());
  const del = [...d.querySelectorAll(".git-diff-line.del")].map((e) => e.textContent.trim());
  return { add, del, stat: document.querySelector(".git-diff-stat")?.textContent };`);
check("Diff 渲染（增删行 + 统计）", r.add.some((l) => l.includes("line2 changed")) && r.del.length >= 1, JSON.stringify(r));

// 暂存未跟踪文件 + 全部暂存按钮
r = await run(`
  const row = [...document.querySelectorAll(".git-file")].find((el) => el.textContent.includes("new.txt"));
  const btn = row && [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === "暂存");
  if (!btn) return { error: "no stage button" };
  __t.click(btn);
  await __t.wait(900);
  const stagedSection = document.querySelector(".git-side .panel");
  return { staged: [...stagedSection.querySelectorAll(".git-file .mono")].map((e) => e.textContent.trim()) };`);
check("UI 暂存文件", r.staged?.includes("new.txt"), JSON.stringify(r));

// 提交
r = await run(`
  const ta = document.querySelector(".git-commit-msg");
  __t.setValue(ta, "e2e: 暂存并提交");
  await __t.wait(200);
  const btn = [...document.querySelectorAll(".git-side .btn")].find((b) => b.textContent.includes("提交"));
  if (!btn) return { error: "no commit btn" };
  __t.click(btn);
  await __t.wait(2000);
  return { head: document.querySelector(".git-page .page-head .muted")?.textContent, output: document.querySelector(".git-output")?.textContent?.slice(0, 60) || "" };`);
const log = git("log", "--oneline", "-3");
check("UI 提交成功（写进仓库）", /e2e: 暂存并提交/.test(log), log.split("\n")[0]);
check("提交后工作区减少（b.txt 已提交、new.txt 已提交）", git("status", "--porcelain").trim().split("\n").filter(Boolean).length === 1, git("status", "--porcelain").trim().replace(/\n/g, " | "));

// 分支切换
r = await run(`
  const branch = await window.harness.gitBranches();
  const res = await window.harness.gitCheckout(undefined, "feature/x", true);
  await __t.wait(800);
  const st = await window.harness.gitStatus();
  return { created: res.ok, branch: st.branch, output: res.error || "" };`);
check("新建并切换分支", r.created === true && r.branch === "feature/x", JSON.stringify(r));
check("git 里确实切过去了", git("rev-parse", "--abbrev-ref", "HEAD").trim() === "feature/x", git("rev-parse", "--abbrev-ref", "HEAD").trim());

conn.socket.close();
console.log(fails ? `${fails} 项失败` : "全部通过");
process.exit(fails ? 1 : 0);
