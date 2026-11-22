/**
 * 机器人能「看见」的工作区：只读、路径 jail、结果有上限。
 *
 * 为什么单独一层：bot 的观察面不能靠「让模型自己跑命令」——
 * 那等于把任意执行塞进一个被动回复路径。这里只做三件事：
 *   1) 列目录 / 读文件 / 搜索（都限制在项目根内，符号链接也要过 jail）；
 *   2) 二进制、超大文件、忽略目录明确拒绝并说明原因；
 *   3) 每次返回都有字符上限，超了标 truncated，不静默截断。
 *
 * 纯函数 + 同步 fs：调用方（主进程）负责包一层 try/catch，把它变成 tool 结果。
 * 单测见 tests/bot/workspace.test.mjs。
 */

import fs from "node:fs";
import path from "node:path";

export const WORKSPACE_LIMITS = {
  listEntries: 200,
  readBytes: 2 * 1024 * 1024,
  readLines: 400,
  resultChars: 12000,
  grepFiles: 400,
  grepFileBytes: 512 * 1024,
  grepMatches: 40,
  walkDepth: 6,
};

/** 不进搜索/列表的目录：都是「别人的构建产物或依赖」，读它们只会把上下文塞满 */
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "release", "coverage", "target",
  ".next", ".nuxt", ".cache", ".turbo", ".venv", "venv", "__pycache__",
  ".pnpm-store", ".yarn", "Pods", "DerivedData", ".idea", ".gradle",
]);

export function isSkippedName(name) {
  const n = String(name || "");
  return n.startsWith(".git") || SKIP_DIRS.has(n);
}

/** 凭据文件：读进来就等于把 key 贴进上下文，一律拒绝（.env.example 除外） */
export function isSecretPath(rel) {
  const base = String(rel || "").split("/").pop() || "";
  if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(base)) return true;
  if (/^id_(rsa|ed25519|ecdsa)$/i.test(base)) return true;
  if ([".npmrc", ".netrc", ".git-credentials"].includes(base)) return true;
  return /^credentials(\.|$)/i.test(base);
}

/** 文本截断：按字符，不留半个代理对 */
export function clipChars(text, max = WORKSPACE_LIMITS.resultChars) {
  const s = String(text ?? "");
  if (s.length <= max) return { text: s, truncated: false };
  return { text: `${s.slice(0, Math.max(0, max - 1))}…`, truncated: true };
}

/** 二进制判定：前 8KB 有 NUL 就当二进制（与 file-kinds 的口径一致） */
export function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
}

/**
 * 把相对路径锁进 root：先做字面检查，再 realpath 一次防符号链接逃逸。
 * 空 rel = root 本身。绝对路径 / `..` 越界 / 指向外面的链接都抛。
 */
export function resolveInside(root, rel = "") {
  const base = fs.realpathSync(path.resolve(String(root || ".")));
  const literal = path.resolve(base, String(rel || ""));
  if (literal !== base && !literal.startsWith(base + path.sep)) throw new Error("path outside project");
  let real = literal;
  try {
    real = fs.realpathSync(literal);
  } catch {
    // 目标不存在：保留字面路径，让调用方给出「不存在」而不是「越界」
  }
  if (real !== base && !real.startsWith(base + path.sep)) throw new Error("path outside project");
  return { full: real, rel: path.relative(base, real).split(path.sep).join("/") || "." };
}

function relOf(base, full) {
  return path.relative(base, full).split(path.sep).join("/") || ".";
}

/** 列目录：只列一层或两层，带大小/是否目录；不跟进忽略目录 */
export function listWorkspace({ root, rel = "", depth = 1 } = {}) {
  const base = fs.realpathSync(path.resolve(String(root || ".")));
  const { full, rel: startRel } = resolveInside(base, rel);
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) throw new Error("不是目录：用 workspace_read 读文件");
  const maxDepth = Math.min(Math.max(Number(depth) || 1, 1), 2);
  const entries = [];
  const walk = (dir, level) => {
    if (entries.length >= WORKSPACE_LIMITS.listEntries) return;
    const dirents = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !isSkippedName(e.name))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const e of dirents) {
      if (entries.length >= WORKSPACE_LIMITS.listEntries) return;
      const abs = path.join(dir, e.name);
      let size = null;
      try { size = e.isFile() ? fs.statSync(abs).size : null; } catch { /* 权限/竞态：只报名字 */ }
      entries.push({ path: relOf(base, abs), dir: e.isDirectory(), size });
      if (level < maxDepth && e.isDirectory()) walk(abs, level + 1);
    }
  };
  walk(full, 1);
  return {
    root: startRel,
    entries,
    truncated: entries.length >= WORKSPACE_LIMITS.listEntries,
    note: "跳过 .git / node_modules / dist 等目录",
  };
}

/** 读文件：按行分页，超上限标 truncated；二进制/超大文件明确拒绝 */
export function readWorkspaceFile({ root, rel = "", offset = 0, limit = 200 } = {}) {
  const { full, rel: relPath } = resolveInside(root, rel);
  if (isSecretPath(relPath)) throw new Error("这是凭据文件（.env / 密钥），不读正文");
  if (full === fs.realpathSync(path.resolve(root))) throw new Error("这是目录：用 workspace_list");
  const stat = fs.statSync(full);
  if (stat.isDirectory()) throw new Error("这是目录：用 workspace_list");
  if (stat.size > WORKSPACE_LIMITS.readBytes) throw new Error(`文件太大（${stat.size} 字节 > ${WORKSPACE_LIMITS.readBytes}）`);
  const buf = fs.readFileSync(full);
  if (looksBinary(buf)) throw new Error("二进制文件，不读正文");
  const lines = buf.toString("utf8").split(/\r?\n/);
  // 文本文件通常以换行结尾：那不是「多一行」，不然后一行就是空的
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const start = Math.min(Math.max(Number(offset) || 0, 0), lines.length);
  const want = Math.min(Math.max(Number(limit) || 200, 1), WORKSPACE_LIMITS.readLines);
  const end = Math.min(lines.length, start + want);
  const clipped = clipChars(lines.slice(start, end).join("\n"));
  return {
    path: relPath,
    totalLines: lines.length,
    offset: start,
    lines: end - start,
    text: clipped.text,
    truncated: clipped.truncated || end < lines.length,
  };
}

/** 搜索：逐行匹配，跳过忽略目录/二进制/大文件；返回 path:line:text */
export function grepWorkspace({ root, query, path: rel = "", limit = WORKSPACE_LIMITS.grepMatches } = {}) {
  const needle = String(query || "").trim();
  if (!needle) throw new Error("query 不能为空");
  const base = fs.realpathSync(path.resolve(String(root || ".")));
  const start = resolveInside(base, rel);
  const cap = Math.min(Math.max(Number(limit) || WORKSPACE_LIMITS.grepMatches, 1), 100);
  const needleLower = needle.toLowerCase();
  const matches = [];
  let scanned = 0;

  const walk = (dir, depth) => {
    if (matches.length >= cap || scanned >= WORKSPACE_LIMITS.grepFiles || depth > WORKSPACE_LIMITS.walkDepth) return;
    let dirents;
    try { dirents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of dirents) {
      if (matches.length >= cap || scanned >= WORKSPACE_LIMITS.grepFiles) return;
      if (isSkippedName(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs, depth + 1); continue; }
      if (!e.isFile()) continue;
      if (isSecretPath(relOf(base, abs))) continue;
      let buf;
      try {
        const st = fs.statSync(abs);
        if (st.size > WORKSPACE_LIMITS.grepFileBytes) continue;
        buf = fs.readFileSync(abs);
      } catch { continue; }
      if (looksBinary(buf)) continue;
      scanned += 1;
      const lines = buf.toString("utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.toLowerCase().includes(needleLower)) continue;
        matches.push({ path: relOf(base, abs), line: i + 1, text: clipChars(line.trim(), 240).text });
        if (matches.length >= cap) return;
      }
    }
  };

  const stat = fs.statSync(start.full);
  if (stat.isDirectory()) walk(start.full, 0);
  else {
    // 单文件：直接扫，不 walk
    const buf = fs.readFileSync(start.full);
    if (!isSecretPath(start.rel) && !looksBinary(buf) && buf.length <= WORKSPACE_LIMITS.grepFileBytes) {
      scanned = 1;
      const lines = buf.toString("utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length && matches.length < cap; i += 1) {
        if (lines[i].toLowerCase().includes(needleLower)) {
          matches.push({ path: start.rel, line: i + 1, text: clipChars(lines[i].trim(), 240).text });
        }
      }
    }
  }
  return { query: needle, matches, scanned, truncated: matches.length >= cap || scanned >= WORKSPACE_LIMITS.grepFiles };
}
