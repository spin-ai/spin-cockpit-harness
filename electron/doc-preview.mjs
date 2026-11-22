// 文档预览：把 Office 文档转成可直接渲染的 HTML / PDF / 纯文本。
// 依赖都是仓库既有依赖（mammoth / xlsx / officeparser），按需动态加载，不拖慢启动。
// 版式还原路径：本机装了 LibreOffice 时优先转 PDF（pptx / doc / odt 这类），用内置阅读器显示。
// 设计：docs/arch/ARCH-file-explorer.md「2.5 格式矩阵」

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

export const MAX_DOC_BYTES = 30 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 400;
const MAX_COLS = 60;
const MAX_SHEETS = 12;

export const DOCX_EXT = new Set(["docx"]);
export const EXCEL_EXT = new Set(["xlsx", "xlsm", "xls", "ods"]);
export const TEXT_OFFICE_EXT = new Set(["doc", "pptx", "pptm", "odt", "odp", "odg", "rtf", "epub"]);
/** 全部走文档预览的扩展名（渲染层的 DOC_EXT 必须与它一致） */
export const OFFICE_EXT = new Set([...DOCX_EXT, ...EXCEL_EXT, ...TEXT_OFFICE_EXT]);

/** 哪些扩展名走文档预览（渲染成 HTML 或抽文本），返回 "docx" | "excel" | "text" | null */
export function officeKind(ext) {
  const e = String(ext || "").toLowerCase().replace(/^\./, "");
  if (DOCX_EXT.has(e)) return "docx";
  if (EXCEL_EXT.has(e)) return "excel";
  if (TEXT_OFFICE_EXT.has(e)) return "text";
  return null;
}

/** 找本机的 LibreOffice（不装就没有，自动回落到抽文本） */
export function findSoffice(env = process.env) {
  const candidates = [
    env.COCKPIT_SOFFICE,
    "soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/usr/lib/libreoffice/program/soffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate === "soffice") return candidate; // 交给 PATH 解析（spawn 失败会走文本回落）
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * 用 LibreOffice 把文档转成 PDF（版式还原）。
 * 输出按「路径 + mtime + size」缓存，重复预览同一文件不会反复起 soffice。
 */
export async function convertToPdf({ file, cacheDir, soffice = null } = {}) {
  if (!cacheDir) return null;
  const bin = soffice || findSoffice();
  if (!bin) return null;
  try {
    const stat = fs.statSync(file);
    const key = crypto.createHash("sha1").update(`${file}|${stat.mtimeMs}|${stat.size}`).digest("hex").slice(0, 16);
    const cached = path.join(cacheDir, `${key}.pdf`);
    if (fs.existsSync(cached) && fs.statSync(cached).size > 1024) return cached;
    fs.mkdirSync(cacheDir, { recursive: true });
    const outDir = fs.mkdtempSync(path.join(cacheDir, "convert-"));
    await new Promise((resolve, reject) => {
      execFile(bin, ["--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", outDir, file], { timeout: 60000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message || err).slice(0, 300)));
        else resolve(null);
      });
    });
    const produced = fs.readdirSync(outDir).find((name) => name.toLowerCase().endsWith(".pdf"));
    if (!produced) throw new Error("LibreOffice 没有产出 PDF");
    const pdf = path.join(outDir, produced);
    if (fs.statSync(pdf).size < 1024) throw new Error("转换结果为空");
    fs.renameSync(pdf, cached);
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return cached;
  } catch (err) {
    console.warn(`[doc-preview] pdf convert failed: ${String(err?.message || err)}`);
    return null;
  }
}

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const clip = (html) => (Buffer.byteLength(html) > MAX_HTML_BYTES
  ? { html: `${html.slice(0, MAX_HTML_BYTES)}<p class="doc-truncated">内容过大，已截断</p>`, truncated: true }
  : { html, truncated: false });

async function renderDocx(file) {
  const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
  const { value } = await mammoth.convertToHtml({ path: file });
  const { html, truncated } = clip(`<article class="doc-body">${value || "<p>（空文档）</p>"}</article>`);
  return { html, truncated, kind: "docx" };
}

/**
 * Excel → 多张表格。不用 sheet_to_html：它会带一堆内联样式，还把整表都渲染出来，
 * 一个几万行的表能把渲染进程卡死。这里自己截断行 / 列并转义。
 */
async function renderExcel(file) {
  const mod = await import("xlsx");
  const XLSX = mod.default ?? mod;
  /* 0.20 的 ESM 构建不带 fs：直接喂 buffer，别用 readFile */
  const book = XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: true, sheetRows: MAX_ROWS + 1 });
  const parts = [];
  let truncated = false;
  for (const name of book.SheetNames.slice(0, MAX_SHEETS)) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false, defval: "" });
    if (rows.length > MAX_ROWS) truncated = true;
    const body = rows.slice(0, MAX_ROWS).map((row) => {
      const cells = (Array.isArray(row) ? row : []).slice(0, MAX_COLS);
      if ((Array.isArray(row) ? row.length : 0) > MAX_COLS) truncated = true;
      return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`;
    }).join("");
    parts.push(`<section class="doc-sheet"><h4>${escapeHtml(name)}</h4><table class="doc-table">${body}</table></section>`);
  }
  if (book.SheetNames.length > MAX_SHEETS) truncated = true;
  const { html, truncated: tooBig } = clip(`<div class="doc-body">${parts.join("") || "<p>（空工作簿）</p>"}</div>`);
  return { html, truncated: truncated || tooBig, kind: "excel" };
}

/** 其余 Office 格式：抽文本比乱码强（pptx 按页给文字，doc 是老二进制格式） */
async function renderText(file, ext) {
  const mod = await import("officeparser");
  const parse = mod.parseOfficeAsync ?? mod.default?.parseOfficeAsync ?? mod.default;
  const text = String((await parse(file)) || "").trim();
  const { html, truncated } = clip(`<article class="doc-body"><pre class="doc-text">${escapeHtml(text || "（没有可提取的文字）")}</pre></article>`);
  return { html, truncated, kind: `text:${ext}` };
}

/** 统一入口：返回 { html | pdfPath, kind, truncated } 或 { error } */
export async function renderOffice({ file, ext, cacheDir, soffice } = {}) {
  const kind = officeKind(ext);
  if (!kind) return { error: "该格式不支持文档预览" };
  try {
    if (kind === "docx") return await renderDocx(file);
    if (kind === "excel") return await renderExcel(file);
    // pptx / doc / odt：能转 PDF 就上版式（LibreOffice），否则只能抽文字
    const pdfPath = await convertToPdf({ file, cacheDir, soffice });
    if (pdfPath) return { pdfPath, kind: `pdf:${String(ext).toLowerCase()}` };
    return await renderText(file, String(ext).toLowerCase());
  } catch (err) {
    const message = String(err?.message || err);
    if (/Cannot find module|MODULE_NOT_FOUND/i.test(message)) return { error: "缺少文档解析依赖，无法预览" };
    return { error: `文档预览失败：${message.slice(0, 200)}` };
  }
}
