// 文件预览格式口径：文本解码 / 二进制判定 / 「浏览器原生可渲染」清单一致性。
// 跑法：npm test -- preview-format （不需要启动应用）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeText, looksBinary, classifyFile, PREVIEW_NATIVE_EXT, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT } from "../electron/file-kinds.mjs";
import { OFFICE_EXT } from "../electron/doc-preview.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (err) { console.error(`✗ ${name}\n  ${err?.message || err}`); process.exitCode = 1; }
}

const B = (s, enc = "utf8") => Buffer.from(s, enc);

check("UTF-8 正常解码，不报 encoding", () => {
  const r = decodeText(B("hello 中文\n"));
  assert.equal(r.text, "hello 中文\n");
  assert.equal(r.encoding, undefined);
});

check("UTF-8 BOM 去掉，正文不多一个 \\uFEFF", () => {
  const r = decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), B("hi")]));
  assert.equal(r.text, "hi");
});

check("GBK / GB18030 文本不再变成乱码", () => {
  // "中文" 的 GBK 编码
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
  const r = decodeText(gbk);
  assert.equal(r.text, "中文");
  assert.equal(r.encoding, "gb18030");
});

check("UTF-16LE / UTF-16BE 的 BOM 文本按对的端序解码", () => {
  assert.equal(decodeText(B("\uFEFFabc", "utf16le")).text, "abc");
  assert.equal(decodeText(B("\uFEFFabc", "utf16le")).encoding, "utf-16le");
  const be = B("\uFEFFabc", "utf16le").swap16();
  assert.equal(decodeText(be).text, "abc");
  assert.equal(decodeText(be).encoding, "utf-16be");
});

check("真二进制（含 NUL）不当文本", () => {
  const zipLike = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x01]);
  // NUL 是合法 UTF-8，所以解码层不拦；拦它的是二进制嗅探
  assert.equal(looksBinary(zipLike, "PK\u0003\u0004"), true);
  assert.equal(classifyFile({ ext: "docx", size: zipLike.length, buf: zipLike }).binary, true);
});

check("控制字符过多的「能解码」内容仍判二进制，偶发一两个不算", () => {
  const junk = String.fromCharCode(1).repeat(40) + "abc";
  assert.equal(looksBinary(B(junk), junk), true);
  assert.equal(looksBinary(B("a\u0001b"), "a\u0001b"), false);
});

check("classifyFile：图片 / 音视频 / PDF 走原生渲染，不读正文", () => {
  for (const ext of ["png", "ICO", ".avif", "mp4", "MP3", "pdf"]) {
    const r = classifyFile({ ext: ext.toLowerCase(), size: 9 * 1024 * 1024, buf: null });
    assert.equal(r.native, true, ext); // 大文件也不该因为 2MB 被拒
  }
});

check("classifyFile：文本 / 超 2MB / 二进制 三种结果", () => {
  assert.equal(classifyFile({ ext: "md", size: 3, buf: B("# hi") }).text, "# hi");
  assert.match(classifyFile({ ext: "txt", size: 3 * 1024 * 1024, buf: null }).error, /2MB/);
  const bin = classifyFile({ ext: "docx", size: 5, buf: Buffer.from([0x50, 0x4b, 0x00, 0x01]) });
  assert.equal(bin.binary, true);
  assert.equal(bin.encoding, "control-chars");
});

check("渲染层的扩展名清单与 electron/file-kinds.mjs 一致（防止两处漂移）", () => {
  const src = fs.readFileSync(path.join(root, "src/components/FileVisual.tsx"), "utf8");
  const parse = (name) => {
    const m = src.match(new RegExp(`export const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
    assert.ok(m, `FileVisual.tsx 里找不到 ${name}`);
    return new Set(m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
  };
  const pairs = [["IMAGE_EXT", IMAGE_EXT], ["VIDEO_EXT", VIDEO_EXT], ["AUDIO_EXT", AUDIO_EXT]];
  for (const [name, canonical] of pairs) {
    const local = parse(name);
    assert.deepEqual([...local].sort(), [...canonical].sort(), `${name} 不一致`);
  }
  const docLocal = parse("DOC_EXT");
  assert.deepEqual([...docLocal].sort(), [...OFFICE_EXT].sort(), "DOC_EXT 与 officeKind 不一致");
  // 预览层的原生清单 = 图片 + 视频 + 音频 + pdf（PreviewSurface 的 isNative 口径）
  const surface = fs.readFileSync(path.join(root, "src/components/PreviewSurface.tsx"), "utf8");
  assert.match(surface, /const isNative = isHtml \|\| isImage \|\| isMedia \|\| isPdf;/);
  assert.equal(PREVIEW_NATIVE_EXT.has("pdf"), true);
});

console.log(passed ? `\n${passed} 项通过` : "");
