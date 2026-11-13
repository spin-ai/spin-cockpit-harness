/**
 * 多格式解析。三层降级：
 *   L1 文本直抽（md/txt/html/pdf 文本层/docx/xlsx/pptx/epub）
 *   L2 PDF → 页图（渲染交给 UI，这里只抽文本）
 *   L3 扫描件 / 复杂版式 → 交 VLM（由 ingest 层在低字符密度时触发）
 *
 * 解析器全部是动态 import：依赖没装就抛 parser-missing，不阻塞主流程。
 * 统一输出 { pages: [{ page_no, markdown }], parser, needsVlm? }
 */

import fs from "node:fs";
import path from "node:path";

const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".text", ".log", ".csv", ".json", ".yaml", ".yml", ".ini", ".toml", ".sql", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".sh", ".zsh", ".html", ".htm"]);
const CODE_EXT = new Set([".js", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".sh", ".zsh", ".sql"]);

export const SUPPORTED = [
  { ext: [".md", ".markdown", ".txt", ".csv", ".json", ".html", ".htm"], parser: "text", level: "builtin" },
  { ext: [".pdf"], parser: "pdf", level: "unpdf" },
  { ext: [".docx"], parser: "docx", level: "mammoth" },
  { ext: [".xlsx", ".xls"], parser: "xlsx", level: "xlsx" },
  { ext: [".pptx", ".pptm", ".odt", ".ods", ".odp"], parser: "office", level: "officeparser" },
  { ext: [".epub"], parser: "epub", level: "epub2" },
];

function attempt(name) {
  const err = new Error(`解析器未安装：${name}`);
  err.code = "parser-missing";
  return err;
}

/** 极简 HTML → 文本（够用即可，不引 readability）。 */
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 代码/纯文本：包一层围栏，保持可读。 */
function asMarkdown(raw, ext) {
  const body = String(raw).replace(/\r\n/g, "\n").trim();
  if (CODE_EXT.has(ext)) return `\`\`\`${ext.slice(1)}\n${body}\n\`\`\``;
  return body;
}

async function parsePdf(file) {
  let unpdf;
  try {
    unpdf = await import("unpdf");
  } catch {
    throw attempt("unpdf");
  }
  const buf = fs.readFileSync(file);
  const { getDocumentProxy, extractText } = unpdf;
  const doc = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(doc, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((md, i) => ({
    page_no: i + 1,
    markdown: String(md || "").trim(),
  }));
  return { pages, parser: "unpdf" };
}

async function parseDocx(file) {
  let mammoth;
  try {
    mammoth = await import("mammoth");
  } catch {
    throw attempt("mammoth");
  }
  const { value } = await mammoth.convertToHtml({ path: file });
  return { pages: [{ page_no: 1, markdown: htmlToText(value) }], parser: "mammoth" };
}

async function parseXlsx(file) {
  let XLSX;
  try {
    XLSX = (await import("xlsx")).default ?? (await import("xlsx"));
  } catch {
    throw attempt("xlsx");
  }
  const book = XLSX.readFile(file);
  const pages = book.SheetNames.map((name, i) => {
    const csv = XLSX.utils.sheet_to_csv(book.Sheets[name], { blankrows: false });
    return { page_no: i + 1, markdown: `## ${name}\n\n${csv}` };
  });
  return { pages, parser: "xlsx" };
}

async function parseOffice(file) {
  let officeparser;
  try {
    officeparser = await import("officeparser");
  } catch {
    throw attempt("officeparser");
  }
  const parse = officeparser.parseOfficeAsync ?? officeparser.default?.parseOfficeAsync;
  const text = await parse(file);
  return { pages: [{ page_no: 1, markdown: String(text || "").trim() }], parser: "officeparser" };
}

async function parseEpub(file) {
  let epub2;
  try {
    epub2 = await import("epub2");
  } catch {
    throw attempt("epub2");
  }
  const EPub = epub2.EPub ?? epub2.default?.EPub;
  const book = await EPub.createAsync(file);
  const pages = [];
  for (const chapter of book.flow || []) {
    const html = await book.getChapterRawAsync(chapter.id);
    pages.push({ page_no: pages.length + 1, markdown: htmlToText(html) });
  }
  return { pages, parser: "epub2" };
}

/**
 * @param {string} file
 * @returns {Promise<{pages: Array<{page_no:number, markdown:string}>, parser: string}>}
 */
export async function parseFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (!fs.existsSync(file)) {
    const err = new Error(`文件不存在：${file}`);
    err.code = "not-found";
    throw err;
  }
  if (TEXT_EXT.has(ext)) {
    const raw = fs.readFileSync(file, "utf8");
    const markdown = ext === ".html" || ext === ".htm" ? htmlToText(raw) : asMarkdown(raw, ext);
    return { pages: [{ page_no: 1, markdown }], parser: "text" };
  }
  if (ext === ".pdf") return parsePdf(file);
  if (ext === ".docx") return parseDocx(file);
  if (ext === ".xlsx" || ext === ".xls") return parseXlsx(file);
  if ([".pptx", ".pptm", ".odt", ".ods", ".odp"].includes(ext)) return parseOffice(file);
  if (ext === ".epub") return parseEpub(file);

  const err = new Error(`不支持的格式：${ext || "(无扩展名)"}`);
  err.code = "unsupported";
  throw err;
}

/**
 * 低字符密度 = 可能是扫描件/图片型 PDF，需要 VLM 兜底。
 * 判据见 ARCH-knowledge.md §3.1。
 */
export function needsVlm(pages) {
  if (!pages.length) return false;
  const chars = pages.reduce((n, p) => n + String(p.markdown || "").replace(/\s/g, "").length, 0);
  return chars / pages.length < 100;
}
