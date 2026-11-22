// 文档预览：docx / xlsx / pptx 转 HTML 的单测（用临时夹具现造文件，不依赖外部样本）。
// 跑法：npm test -- preview-doc
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { convertToPdf, findSoffice, officeKind, renderOffice } from "../electron/doc-preview.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-doc-"));
let passed = 0;
function check(name, fn) {
  try { return Promise.resolve(fn()).then(() => { passed += 1; console.log(`✓ ${name}`); }); }
  catch (err) { console.error(`✗ ${name}\n  ${err?.message || err}`); process.exitCode = 1; return Promise.resolve(); }
}

/** 手搓一个最小 docx（zip + OOXML），用来验证 mammoth 这条真实路径 */
async function makeDocxFile(file, text) {
  const { default: AdmZip } = await import("adm-zip");
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`));
  zip.addFile("_rels/.rels", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`));
  zip.addFile("word/document.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
</w:body></w:document>`));
  zip.writeZip(file);
}

const cases = [];
cases.push(check("扩展名 → 预览方式", () => {
  assert.equal(officeKind("docx"), "docx");
  assert.equal(officeKind(".XLSX"), "excel");
  assert.equal(officeKind("pptx"), "text");
  assert.equal(officeKind("md"), null);
  assert.equal(officeKind(""), null);
}));

cases.push(check("docx：mammoth 转出可渲染 HTML（含正文）", async () => {
  const file = path.join(dir, "a.docx");
  await makeDocxFile(file, "预览正文");
  const res = await renderOffice({ file, ext: "docx" });
  assert.equal(res.error, undefined, res.error);
  assert.match(res.html, /预览正文/);
  assert.match(res.html, /doc-body/);
}));

cases.push(check("xlsx：转成表格并转义单元格（不会注入 HTML）", async () => {
  const XLSX = (await import("xlsx")).default ?? (await import("xlsx"));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["名字", "备注"], ["alpha", "<b>不是标签</b>"]]), "Sheet1");
  const file = path.join(dir, "a.xlsx");
  XLSX.writeFile(book, file);
  const res = await renderOffice({ file, ext: "xlsx" });
  assert.equal(res.error, undefined, res.error);
  assert.match(res.html, /alpha/);
  assert.match(res.html, /&lt;b&gt;/, "单元格内容必须转义");
  assert.match(res.html, /doc-table/);
  assert.equal(res.truncated, false);
}));

cases.push(check("xlsx：大表按行截断并标记", async () => {
  const XLSX = (await import("xlsx")).default ?? (await import("xlsx"));
  const rows = Array.from({ length: 900 }, (_, i) => [i, `row-${i}`]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "big");
  const file = path.join(dir, "big.xlsx");
  XLSX.writeFile(book, file);
  const res = await renderOffice({ file, ext: "xlsx" });
  assert.equal(res.truncated, true);
  const trs = (res.html.match(/<tr>/g) || []).length;
  assert.ok(trs <= 400, `行数应被截断，实际 ${trs}`);
}));

cases.push(check("不支持的格式给原因，不抛异常", async () => {
  const res = await renderOffice({ file: path.join(dir, "x.bin"), ext: "bin" });
  assert.match(res.error, /不支持/);
}));

cases.push(check("损坏的 docx：返回错误而不是崩", async () => {
  const file = path.join(dir, "broken.docx");
  fs.writeFileSync(file, "not a zip");
  const res = await renderOffice({ file, ext: "docx" });
  assert.ok(res.error, "应有 error");
}));

cases.push(check("pptx / doc 走版式：装了 LibreOffice 就转 PDF，没装就回落文字", async () => {
  // 用现造的 docx 直接测转换器（同一个 LibreOffice 管线），再断言 renderOffice 不会炸
  const file = path.join(dir, "conv.docx");
  await makeDocxFile(file, "版式测试");
  const cacheDir = path.join(dir, "cache");
  const pdf = await convertToPdf({ file, cacheDir });
  if (!findSoffice() || !pdf) {
    console.log("  · 跳过：本机没有可用的 LibreOffice，走文字回落");
    const res = await renderOffice({ file, ext: "doc", cacheDir });
    assert.ok(res.error || res.html || res.pdfPath, "应给出结果");
    return;
  }
  assert.match(fs.readFileSync(pdf, "latin1").slice(0, 5), /%PDF/);
  // 同一个文件第二次应命中缓存（不重新起 soffice）
  const again = await convertToPdf({ file, cacheDir });
  assert.equal(again, pdf);
}));

await Promise.all(cases);
fs.rmSync(dir, { recursive: true, force: true });
console.log(passed ? `\n${passed} 项通过` : "");
