#!/usr/bin/env node
/**
 * 文档校验：状态头 / 状态词 / 链接 / 索引登记。
 *
 * 规则见 docs/README.md §7，索引见 §5。
 * 只检查 docs/ 下的文档；resources/wiki/ 是发布到 GitHub Wiki 的另一套语料，
 * 里面的 ./wiki/*.png 由 scripts/publish-wiki.mjs 在发布时改写，不在此校验。
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsDir = path.join(root, "docs");
const INDEX = path.join(docsDir, "README.md");

const LAYERS = new Set(["需求", "架构", "指南", "叙事"]);
const STATUS = new Set(["已落地", "部分落地", "提案", "记录", "已取代"]);
const HEAD = /^> 层：(\S+) · 状态：(\S+) · 核对：(\d{4}-\d{2}-\d{2}) · 覆盖：(.+)$/;

const checks = [];
const check = (ok, label) => { checks.push({ ok, label }); if (!ok) process.exitCode = 1; };

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.name.endsWith(".md")) out.push(abs);
  }
  return out;
}

const files = walk(docsDir).filter((abs) => abs !== INDEX);
const index = fs.readFileSync(INDEX, "utf8");
const toPosix = (p) => p.split(path.sep).join("/");

let links = 0;
for (const abs of files) {
  const rel = toPosix(path.relative(root, abs));
  const text = fs.readFileSync(abs, "utf8");

  // 1. 状态头
  const first = text.split("\n")[0].trim();
  const head = first.match(HEAD);
  check(Boolean(head), `${rel} · 状态头`);
  if (head) {
    check(LAYERS.has(head[1]), `${rel} · 层 ${head[1]}`);
    check(STATUS.has(head[2]), `${rel} · 状态 ${head[2]}`);
    check(!head[4].includes(" · "), `${rel} · 覆盖 不含 · `);
  }

  // 2. 索引登记
  check(index.includes(`](${toPosix(path.relative(docsDir, abs))})`), `${rel} · 已在 docs/README.md §5 登记`);

  // 3. 链接
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    links += 1;
    const clean = target.split("#")[0];
    if (!clean) continue;
    const resolved = path.resolve(path.dirname(abs), clean);
    check(fs.existsSync(resolved), `${rel} · 链接 ${target}`);
  }
}

// 4. 索引里列出的文件必须存在
for (const match of index.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
  const target = match[1];
  check(fs.existsSync(path.resolve(docsDir, target)), `docs/README.md · 索引项 ${target}`);
}

const failed = checks.filter((c) => !c.ok);
for (const item of checks) if (!item.ok) console.log(`✗ ${item.label}`);
console.log(`\nDocs: ${files.length} 篇 · ${links} 条内链 · ${checks.length} 项检查 · ${failed.length} 项失败`);
console.log(`Docs verification: ${process.exitCode ? "failed" : "passed"}`);
