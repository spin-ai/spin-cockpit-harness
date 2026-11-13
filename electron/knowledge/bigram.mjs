/**
 * 中文 bigram 切分。
 *
 * FTS5 的两条路对中文都不好用（实测，SQLite 3.53）：
 *   unicode61 → 整段中文被当成一个 token，"知识库" 查不到
 *   trigram   → 要求查询 ≥3 字，"检索""天气" 这类两字词全部落空
 * 所以入库与查询统一切 bigram：把 "知识库检索" 变成 "知识 识库 库检 检索"。
 *
 * 英文/数字不切，保留原词；长度 1 的拉丁串直接丢弃（噪声大）。
 */

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const WORD_RE = /[a-z0-9_]+/g;

export function isCjk(ch) {
  return CJK_RE.test(ch);
}

/** 把文本切成「连续 CJK 段」与「非 CJK 段」。 */
function runs(text) {
  const out = [];
  let cur = "";
  let curCjk = null;
  for (const ch of text) {
    const cjk = isCjk(ch);
    if (curCjk === null || cjk === curCjk) {
      cur += ch;
      curCjk = cjk;
    } else {
      out.push({ cjk: curCjk, s: cur });
      cur = ch;
      curCjk = cjk;
    }
  }
  if (cur) out.push({ cjk: curCjk, s: cur });
  return out;
}

/**
 * 文本 → token 数组。
 * @param {string} text
 * @param {{ maxTokens?: number }} [opts]
 * @returns {string[]}
 */
export function tokens(text, { maxTokens = 4000 } = {}) {
  const out = [];
  const src = String(text ?? "").toLowerCase();
  for (const run of runs(src)) {
    if (run.cjk) {
      const chars = [...run.s];
      if (chars.length === 1) out.push(chars[0]);
      else for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
    } else {
      for (const m of run.s.matchAll(WORD_RE)) {
        if (m[0].length >= 2) out.push(m[0]);
      }
    }
    if (out.length >= maxTokens) break;
  }
  return out.slice(0, maxTokens);
}

/** 入库用：保留重复 token（保留词频，bm25 更准）。 */
export function bigramText(text, opts) {
  return tokens(text, opts).join(" ");
}

/** 查询用：去重（重复词没有意义）。 */
export function queryText(text, opts) {
  return [...new Set(tokens(text, opts))].join(" ");
}

/** 调试用：看一段文本被切成了什么。 */
export function explain(text) {
  return tokens(text).join(" ");
}
