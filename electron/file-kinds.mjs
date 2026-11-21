// 文件格式口径 + 文本解码（主进程 / 单测共用）。
// 渲染层的清单在 src/components/FileVisual.tsx（TS 侧不能直接 import .mjs），
// 两边一致性由 scripts/preview-format-selftest.mjs 校验。

export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "ico", "bmp", "avif", "tif", "tiff"]);
// Chromium 能直接播放的容器（mkv / avi 不在内，交给系统播放器）
export const VIDEO_EXT = new Set(["mp4", "m4v", "webm", "ogv", "mov"]);
export const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac"]);
/** 浏览器原生能渲染、不需要读正文的扩展名 */
export const PREVIEW_NATIVE_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT, "pdf"]);

/**
 * 文本解码：以前一律 `readFileSync(full, "utf8")`，GBK / UTF-16 的文件全是乱码。
 * 顺序：BOM（UTF-16）→ 严格 UTF-8 → 中文 Windows 常见的 GB18030；都不行返回 null。
 * 返回 { text, encoding? }，encoding 只在非 UTF-8 时出现，用来在预览里提示「按 GB18030 解码」。
 */
export function decodeText(buf) {
  const strip = (s) => s.replace(/^\uFEFF/, "");
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: strip(Buffer.from(buf).toString("utf16le")), encoding: "utf-16le" };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff && buf.length % 2 === 0) {
    const swapped = Buffer.from(buf);
    swapped.swap16();
    return { text: strip(swapped.toString("utf16le")), encoding: "utf-16be" };
  }
  try {
    return { text: strip(new TextDecoder("utf-8", { fatal: true }).decode(buf)) };
  } catch { /* 不是 UTF-8 */ }
  try {
    const text = new TextDecoder("gb18030", { fatal: true }).decode(buf);
    if (text && !(text.match(/\uFFFD/g) || []).length) return { text, encoding: "gb18030" };
  } catch { /* 也不像 GBK */ }
  return null;
}

/** 二进制嗅探：NUL 字节 + 大量不可打印控制字符（避免随机字节被 GB18030 解出「看似中文」的垃圾）。 */
export function looksBinary(buf, text) {
  if (buf.subarray(0, 8192).includes(0)) return true;
  if (!text) return false;
  const ctrl = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  // 两三个控制字符不算：文本里偶尔夹一个也行；占比高才是二进制
  return ctrl >= 2 && ctrl / Math.max(1, text.length) > 0.02;
}

/** 纯函数形态的 files:read 结果（便于单测）；调用方负责 IO。 */
export function classifyFile({ ext, size, buf, maxBytes = 2 * 1024 * 1024 }) {
  const name = String(ext || "").toLowerCase().replace(/^\./, "");
  if (PREVIEW_NATIVE_EXT.has(name)) return { native: true, size, ext: name };
  if (size > maxBytes) return { error: "文件超过 2MB，文本预览与编辑已跳过（HTML / 图片仍按原生渲染）", size, ext: name };
  const decoded = decodeText(buf);
  if (!decoded || looksBinary(buf, decoded.text)) {
    return { binary: true, size, ext: name, encoding: decoded ? "control-chars" : "non-utf8" };
  }
  return { text: decoded.text, encoding: decoded.encoding, size, ext: name };
}
