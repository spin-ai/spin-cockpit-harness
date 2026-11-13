/**
 * 结构优先分块：标题 → 页 → 表 → 超长再按长度切。
 * 每个 chunk 记住 doc/page/heading/char 偏移，引用才能定位回去。
 */

export const DEFAULT_CHUNK = { maxChars: 800, minChars: 120, overlap: 80 };

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const SENTENCE_RE = /[^。！？!?；;\n]+[。！？!?；;]?/g;

const clean = (s) => String(s || "").replace(/\r\n/g, "\n").replace(/\u0000/g, "");

/** 按标题把一页切成若干 section（保留原文偏移）。 */
function sectionsOf(markdown) {
  const text = clean(markdown);
  const out = [];
  let heading = "";
  let start = 0;
  let buf = "";
  let cursor = 0;

  for (const line of text.split("\n")) {
    const lineStart = cursor;
    cursor += line.length + 1;
    const m = HEADING_RE.exec(line);
    if (m && buf.trim()) {
      out.push({ heading, text: buf, start, end: lineStart });
      buf = "";
      start = lineStart;
    }
    if (m) heading = m[2].trim();
    buf += `${line}\n`;
  }
  if (buf.trim()) out.push({ heading, text: buf, start, end: text.length });
  if (!out.length && text.trim()) out.push({ heading: "", text, start: 0, end: text.length });
  return out;
}

/** 超长 section 按句子窗口切，带 overlap。 */
function windowSplit(text, start, { maxChars, overlap }) {
  const out = [];
  const sentences = text.match(SENTENCE_RE) || [text];
  let buf = "";
  let bufStart = start;
  let offset = start;
  for (const s of sentences) {
    if (buf && buf.length + s.length > maxChars) {
      out.push({ text: buf, start: bufStart, end: bufStart + buf.length });
      const keep = buf.slice(Math.max(0, buf.length - overlap));
      bufStart = bufStart + buf.length - keep.length;
      buf = keep + s;
    } else {
      buf += s;
    }
    offset += s.length;
  }
  if (buf.trim()) out.push({ text: buf, start: bufStart, end: bufStart + buf.length });
  return out;
}

/**
 * @param {Array<{page_no:number, markdown:string}>} pages
 * @param {Partial<typeof DEFAULT_CHUNK>} [opts]
 */
export function chunkPages(pages, opts = {}) {
  const cfg = { ...DEFAULT_CHUNK, ...opts };
  const chunks = [];
  for (const page of pages) {
    const pageNo = Number(page.page_no) || 1;
    for (const section of sectionsOf(page.markdown)) {
      const body = section.text.trim();
      if (!body) continue;
      const pieces =
        body.length <= cfg.maxChars
          ? [{ text: section.text, start: section.start, end: section.end }]
          : windowSplit(section.text, section.start, cfg);
      for (const piece of pieces) {
        const text = piece.text.trim();
        if (text.length < 8) continue;
        chunks.push({
          page_no: pageNo,
          heading: section.heading || "",
          char_start: piece.start,
          char_end: piece.end,
          text,
        });
      }
    }
  }
  // 合并相邻的碎片（小标题下的零散一行），避免 chunk 过碎
  const merged = [];
  for (const c of chunks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.page_no === c.page_no && prev.heading === c.heading && prev.text.length + c.text.length <= cfg.minChars) {
      prev.text = `${prev.text}\n${c.text}`;
      prev.char_end = c.char_end;
    } else {
      merged.push({ ...c });
    }
  }
  return merged;
}
