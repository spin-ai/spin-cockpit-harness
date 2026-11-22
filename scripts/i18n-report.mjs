#!/usr/bin/env node
/**
 * i18n 进度表：统计每个组件里还剩多少条「硬编码中文」。
 *
 * 不是拦截器（拦截会把现有半成品变成红灯），而是让「继续翻译」有一个可比的数字：
 * 每次翻译完一页，跑一次 `npm run i18n:report`，数字应该往下走。
 *
 * 只统计 JSX 文本与字符串字面量里的中文，注释不算；`t("...", "中文")` 的 fallback 也不算
 * （那是给中文模式的兜底，已经接进语言切换）。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const isChinese = (s) => /[\u4e00-\u9fa5]/.test(s);

const rows = [];
for (const file of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, file);
  const text = stripComments(fs.readFileSync(file, "utf8"));
  const hits = [];
  // 1) 字符串字面量里带中文（排除 t("key", "中文") 的 fallback）
  for (const m of text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g)) {
    const value = m[2];
    if (!isChinese(value)) continue;
    const before = text.slice(Math.max(0, m.index - 100), m.index);
    if (/t\(\s*["'][^"']*["']\s*,\s*$/.test(before)) continue; // t("key", "中文") 的 fallback
    hits.push(value.trim().slice(0, 40));
  }
  if (!hits.length) continue;
  rows.push({ file: rel, count: hits.length, sample: [...new Set(hits)].slice(0, 3) });
}

rows.sort((a, b) => b.count - a.count);
const total = rows.reduce((sum, r) => sum + r.count, 0);
console.log(`i18n 进度 · ${rows.length} 个文件仍有硬编码中文 · 共 ${total} 条`);
for (const r of rows.slice(0, 20)) {
  console.log(`  ${String(r.count).padStart(4)}  ${r.file}   例如：${r.sample.join(" / ")}`);
}
console.log("\n建议顺序：Bots.tsx（已接）→ Bot.tsx 页面 chrome → TaskPane / TaskChat 动作文案。正文与用户内容保持原语言。");
