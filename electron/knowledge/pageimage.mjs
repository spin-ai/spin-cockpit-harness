/**
 * 页图：把 PDF 的某一页渲成 PNG，供「引用点开看原页」用。
 *
 * 为什么不走 unpdf 的 renderPageAsImage：在 Node 24 下它内部的 transfer 会抛
 * 「Cannot transfer object of unsupported type」。直接用 pdfjs-dist(legacy) +
 * @napi-rs/canvas（预编译 skia）稳定，且不需要额外原生编译。
 */

import fs from "node:fs";
import path from "node:path";

export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff" };

const MAX_BYTES = 3 * 1024 * 1024;

let runtimePromise = null;
function runtime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const canvas = await import("@napi-rs/canvas");
      // pdf.js 的 display 层会直接 new DOMMatrix / Path2D
      globalThis.DOMMatrix = canvas.DOMMatrix;
      if (typeof globalThis.Path2D === "undefined") globalThis.Path2D = canvas.Path2D;
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      return { canvas, pdfjs };
    })();
  }
  return runtimePromise;
}

/** 同一份文件只保留一个 PDF 文档句柄（按 mtime 失效）。 */
const openDocs = new Map();

async function openPdf(file) {
  const mtime = fs.statSync(file).mtimeMs;
  const key = `${file}@${mtime}`;
  const cached = openDocs.get(key);
  if (cached) return cached;
  const { pdfjs } = await runtime();
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  openDocs.clear();
  openDocs.set(key, doc);
  return doc;
}

/**
 * @param {string} file
 * @param {number} pageNo 1-based
 * @param {{ scale?: number }} [opts]
 * @returns {Promise<{buffer: Buffer, width: number, height: number, kind: "pdf"|"image", pages?: number}>}
 */
export async function pageImage(file, pageNo = 1, { scale = 1.6 } = {}) {
  const ext = path.extname(file).toLowerCase();
  if (!fs.existsSync(file)) {
    const err = new Error(`原文件已不存在：${file}`);
    err.code = "not-found";
    throw err;
  }
  if (IMAGE_EXT.has(ext)) {
    return { buffer: fs.readFileSync(file), width: 0, height: 0, kind: "image", mime: MIME[ext] || "image/png" };
  }
  if (ext !== ".pdf") {
    const err = new Error(`该格式没有页图：${ext || "(无扩展名)"}`);
    err.code = "no-page-image";
    throw err;
  }

  const { canvas } = await runtime();
  const doc = await openPdf(file);
  const page = await doc.getPage(Math.max(1, Math.min(Number(pageNo) || 1, doc.numPages)));
  const render = async (s) => {
    const viewport = page.getViewport({ scale: s });
    const c = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport, canvas: c }).promise;
    return { buffer: c.toBuffer("image/png"), width: c.width, height: c.height };
  };

  let out = await render(scale);
  // 扫描件整页 PNG 可能很大：超阈值降一档分辨率再试
  if (out.buffer.length > MAX_BYTES) out = await render(Math.max(1, scale * 0.65));
  return { ...out, kind: "pdf", mime: "image/png", pages: doc.numPages };
}
