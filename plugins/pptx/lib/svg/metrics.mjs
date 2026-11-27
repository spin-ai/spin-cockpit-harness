/** 文本宽度估算：SVG 没有排版引擎，门禁和自动换行都要一个稳定的近似值。 */
export function estimateCharWidth(ch, size) {
  const code = ch.codePointAt(0) || 0;
  if (code >= 0x2e80) return size; // CJK / 全角
  if (ch === " ") return size * 0.28;
  if (/[0-9]/.test(ch)) return size * 0.56;
  if (/[A-Z]/.test(ch)) return size * 0.63;
  if (/[ilI.,:;'!|]/.test(ch)) return size * 0.28;
  if (/[mwMW]/.test(ch)) return size * 0.82;
  return size * 0.55;
}

export function estimateTextWidth(text, size) {
  let width = 0;
  for (const ch of String(text || "")) width += estimateCharWidth(ch, size);
  return width;
}

/** 按宽度硬换行（中文按字、英文按词），返回行数组 */
export function wrapText(text, maxWidth, size) {
  const source = String(text || "").trim();
  if (!source) return [];
  const lines = [];
  let current = "";
  const flush = () => { if (current.trim()) lines.push(current.trim()); current = ""; };
  const tokens = source.match(/[\u2e80-\u9fff\uac00-\ud7ff\uf900-\ufaff]|[^\s\u2e80-\u9fff]+|\s+/g) || [];
  for (const token of tokens) {
    if (token === "\n") { flush(); continue; }
    if (!current && /^\s+$/.test(token)) continue;
    if (estimateTextWidth(current + token, size) > maxWidth && current.trim()) {
      flush();
      if (/^\s+$/.test(token)) continue;
    }
    current += token;
  }
  flush();
  return lines;
}
