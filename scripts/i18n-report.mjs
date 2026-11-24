#!/usr/bin/env node
/**
 * i18n 进度表：统计每个组件里还剩多少条「硬编码中文」。
 *
 * 不是拦截器（拦截会把现有半成品变成红灯），而是让「继续翻译」有一个可比的数字：
 * 每次翻译完一页，跑一次 `npm run i18n:report`，数字应该往下走。
 *
 * 为什么手写扫描器：
 *   - 上一版用正则配对引号，多行 JSX 会把引号配错（同一个改动两次报告能差几十条）；
 *   - 本仓库的 typescript 是 7.x 原生预览版，只提供 tsc 二进制，没有 JS AST API 可调。
 * 所以这里做一遍轻量词法扫描：正确跳过注释、字符串、模板（含 ${} 里的嵌套）、正则字面量，
 * 然后数两类「用户能看到的字」：字符串 / 模板的静态片段、JSX 文本。
 *
 * 不算：
 *   - 注释
 *   - `t("key", "中文")` 的第二个参数（中文模式的兜底，已经接进语言切换）
 *   - className / style / id / name / key 这类非文案属性里的值
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const isChinese = (s) => /[\u4e00-\u9fa5]/.test(s);

/** 非文案属性：写中文也只是技术串 */
const SKIP_ATTR = /(?:className|style|id|name|key|value|href|src|rel|type|data-[\w-]+)\s*=\s*$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 词法扫描：返回 { chars: 去掉注释后的源码（字符串保留原样）, strings: [{value,start,end}], regexes } */
function lex(text) {
  const strings = [];
  const chars = text.split("");
  const blank = (from, to) => { for (let k = from; k < to && k < chars.length; k++) if (chars[k] !== "\n") chars[k] = " "; };
  let i = 0;
  const n = text.length;
  let prevSignificant = "";

  const readString = (quote) => {
    const start = i;
    i++;
    let value = "";
    while (i < n) {
      const ch = text[i];
      if (ch === "\\") { value += text[i + 1] ?? ""; i += 2; continue; }
      if (ch === quote) { i++; break; }
      if (ch === "\n" && quote !== "`") { break; } // 未闭合：别把整份文件吞掉
      value += ch;
      i++;
    }
    strings.push({ value, start, end: i });
    blank(start + 1, i - 1); // 只抹内容，引号留着 —— t("key", "兜底") 的识别靠它
    return value;
  };

  const readTemplate = () => {
    const tplStart = i;
    i++; // `
    let pieceStart = i;
    while (i < n) {
      const ch = text[i];
      if (ch === "\\") { i += 2; continue; }
      if (ch === "`") {
        strings.push({ value: text.slice(pieceStart, i), start: pieceStart, end: i, template: true });
        i++;
        blank(tplStart + 1, i - 1);
        return;
      }
      if (ch === "$" && text[i + 1] === "{") {
        strings.push({ value: text.slice(pieceStart, i), start: pieceStart, end: i, template: true });
        i += 2;
        let depth = 1;
        const bodyStart = i;
        while (i < n && depth > 0) {
          const c = text[i];
          if (c === "{") depth++;
          else if (c === "}") { depth--; if (!depth) break; }
          else if (c === '"' || c === "'") { readString(c); continue; }
          else if (c === "`") { readTemplate(); continue; }
          i++;
        }
        blank(bodyStart, i); // ${...} 里的代码不再当成 JSX 文本
        i++;
        pieceStart = i;
        continue;
      }
      i++;
    }
    if (i > pieceStart) strings.push({ value: text.slice(pieceStart, i), start: pieceStart, end: i, template: true });
    blank(tplStart + 1, i - 1);
  };

  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const start = i;
      while (i < n && text[i] !== "\n") i++;
      blank(start, i);
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      blank(start, i);
      continue;
    }
    if (c === '"' || c === "'") {
      readString(c);
      prevSignificant = '"';
      continue;
    }
    if (c === "`") {
      readTemplate();
      prevSignificant = "`";
      continue;
    }
    // 正则字面量：只在「前一有效字符不像值」的位置才可能是正则
    if (c === "/" && /[=(,:;[!&|?{}]|^$/.test(prevSignificant)) {
      const start = i;
      i++;
      let ok = false;
      while (i < n) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === "\n") break;
        if (text[i] === "/") { i++; ok = true; break; }
        i++;
      }
      while (ok && i < n && /[gimsuy]/.test(text[i])) i++;
      blank(start, i);
      prevSignificant = ")";
      continue;
    }
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return { chars: chars.join(""), strings };
}

/** 这个字符串是不是 `t("key", "兜底")` 的第二个参数（用原文判断：模板里的 ${} 已被抹成空格） */
function isFallbackArg(raw, start) {
  const before = raw.slice(Math.max(0, start - 200), start).replace(/\s+$/, "");
  if (/(?:^|[^\w$])t\(\s*(["'])[^"']*\1\s*,\s*$/.test(before)) return true;
  // 状态表里的 [key, "中文"] 元组：和 t(key, 兜底) 等价，不算硬编码
  return /\[\s*["'][a-z][\w.]*["']\s*,\s*$/.test(before);
}

function collect(file, text) {
  const { chars, strings } = lex(text);
  const hits = [];

  for (const s of strings) {
    if (!isChinese(s.value)) continue;
    if (isFallbackArg(text, s.start)) continue;
    const before = chars.slice(Math.max(0, s.start - 60), s.start);
    if (SKIP_ATTR.test(before)) continue;
    hits.push(s.value.trim().slice(0, 40));
  }

  // JSX 文本：字符串/注释被抹成空格后，`>文字<` 之间就是用户看到的字
  for (const m of chars.matchAll(/>([^<>{}]+)</g)) {
    const value = m[1].trim();
    if (!value || !isChinese(value)) continue;
    hits.push(value.slice(0, 40));
  }
  return hits;
}

const rows = [];
for (const file of walk(path.join(ROOT, "src"))) {
  const hits = collect(file, fs.readFileSync(file, "utf8"));
  if (!hits.length) continue;
  rows.push({ file: path.relative(ROOT, file), count: hits.length, sample: [...new Set(hits)].slice(0, 3) });
}

rows.sort((a, b) => b.count - a.count);
const total = rows.reduce((sum, r) => sum + r.count, 0);
console.log(`i18n 进度 · ${rows.length} 个文件仍有硬编码中文 · 共 ${total} 条`);
for (const r of rows.slice(0, 20)) {
  console.log(`  ${String(r.count).padStart(4)}  ${r.file}   例如：${r.sample.join(" / ")}`);
}
if (rows.length > 20) console.log(`  …另外 ${rows.length - 20} 个文件`);

// 只报告，不设退出码：这是进度表，不是闸门
console.log("\n建议顺序：Bots.tsx（已接）→ Bot.tsx 页面 chrome → TaskPane / TaskChat 动作文案。正文与用户内容保持原语言。");
