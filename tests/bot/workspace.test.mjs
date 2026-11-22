/**
 * 工作区只读工具的不变量：路径锁在项目根内、二进制/超大文件拒绝、搜索跳过依赖目录。
 * 这些是「bot 能看见东西」的前提；漏一条就是任意文件读取。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "./_harness.mjs";
import {
  grepWorkspace,
  listWorkspace,
  looksBinary,
  readWorkspaceFile,
  resolveInside,
} from "../../electron/bot/workspace.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bot-ws-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bot-ws-out-"));

fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "src", "app.ts"), "line0\nconst TODO_NEEDLE = 1;\nline2\nline3\n");
fs.writeFileSync(path.join(root, "README.md"), "hello\n");
fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "TODO_NEEDLE in dependency\n");
fs.mkdirSync(path.join(root, ".git"), { recursive: true });
fs.writeFileSync(path.join(root, ".git", "config"), "TODO_NEEDLE in git\n");
fs.writeFileSync(path.join(root, "logo.bin"), Buffer.from([0, 1, 2, 3]));
fs.writeFileSync(path.join(root, ".env"), "ARK_API_KEY=secret\n");
fs.writeFileSync(path.join(root, ".env.example"), "ARK_API_KEY=\n");
fs.writeFileSync(path.join(outside, "secret.txt"), "outside secret\n");
try { fs.symlinkSync(outside, path.join(root, "escape")); } catch { /* 某些文件系统不允许符号链接 */ }

await test("路径 jail：.. 与指向外部的符号链接都被拒", () => {
  const ok = resolveInside(root, "src/app.ts");
  assert.equal(ok.rel, "src/app.ts");
  assert.throws(() => resolveInside(root, "../etc/passwd"), /path outside project/);
  assert.throws(() => resolveInside(root, "/etc/passwd"), /path outside project/);
  if (fs.existsSync(path.join(root, "escape"))) {
    assert.throws(() => resolveInside(root, "escape/secret.txt"), /path outside project/);
  }
});

await test("读文件：按行分页，二进制拒绝", () => {
  const page = readWorkspaceFile({ root, rel: "src/app.ts", offset: 1, limit: 2 });
  assert.equal(page.totalLines, 4);
  assert.equal(page.text, "const TODO_NEEDLE = 1;\nline2");
  assert.equal(page.truncated, true, "后面还有行，应标 truncated");
  assert.throws(() => readWorkspaceFile({ root, rel: "logo.bin" }), /二进制/);
  assert.throws(() => readWorkspaceFile({ root, rel: "src" }), /目录/);
});

await test("列目录：跳过 .git / node_modules", () => {
  const list = listWorkspace({ root, depth: 2 });
  const paths = list.entries.map((e) => e.path);
  assert.ok(paths.includes("src"));
  assert.ok(paths.includes("src/app.ts"));
  assert.ok(paths.includes("README.md"));
  assert.equal(paths.some((p) => p.startsWith(".git")), false);
  assert.equal(paths.some((p) => p.startsWith("node_modules")), false);
});

await test("搜索：只搜源码，跳过依赖与 .git，返回 path:line", () => {
  const res = grepWorkspace({ root, query: "TODO_NEEDLE" });
  assert.deepEqual(res.matches.map((m) => `${m.path}:${m.line}`), ["src/app.ts:2"]);
  assert.equal(res.matches[0].text, "const TODO_NEEDLE = 1;");
  const scoped = grepWorkspace({ root, query: "hello", path: "README.md" });
  assert.equal(scoped.matches[0].path, "README.md");
  assert.throws(() => grepWorkspace({ root, query: "  " }), /query/);
});

await test("凭据文件：.env 拒绝读，.env.example 可以读", () => {
  assert.throws(() => readWorkspaceFile({ root, rel: ".env" }), /凭据文件/);
  assert.match(readWorkspaceFile({ root, rel: ".env.example" }).text, /ARK_API_KEY/);
  const res = grepWorkspace({ root, query: "secret" });
  assert.equal(res.matches.some((m) => m.path === ".env"), false, "搜索不能把 .env 带出来");
});

await test("二进制判定：前 8KB 有 NUL 即二进制", () => {
  assert.equal(looksBinary(Buffer.from("hello")), false);
  assert.equal(looksBinary(Buffer.from([104, 105, 0, 106])), true);
});

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });
