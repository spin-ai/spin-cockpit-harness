/**
 * SVG 里的图片资源：data URL / 本地文件 / http(s)。
 * 翻译器是同步的，所以先把 href 全部解析成 Buffer，再交给 translateSvg。
 */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

export function collectImageHrefs(svgText) {
  const hrefs = new Set();
  const re = /<image\b[^>]*?(?:href|xlink:href)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let match;
  while ((match = re.exec(String(svgText || "")))) {
    const href = match[2] ?? match[3] ?? "";
    if (href) hrefs.add(href);
  }
  return [...hrefs];
}

/** 从字节里读像素尺寸；认不出就返回 null（不阻断，图片仍会嵌入） */
export function imageSize(bytes, mime = "") {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const type = String(mime || "").toLowerCase();
  try {
    if (type.includes("png") || (buf[0] === 0x89 && buf[1] === 0x50)) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (type.includes("jpeg") || type.includes("jpg") || (buf[0] === 0xff && buf[1] === 0xd8)) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        const length = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + length;
      }
    }
    if (type.includes("gif") || buf.subarray(0, 3).toString() === "GIF") {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
  } catch { /* ignore */ }
  return null;
}

function fromDataUrl(href) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(href);
  if (!match) return null;
  const mime = (match[1] || "image/png").toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) return { unsupported: true, mime };
  const data = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
  if (!data.length) return { unsupported: true, mime };
  if (data.length > MAX_IMAGE_BYTES) throw new Error(`图片过大：${(data.length / 1024 / 1024).toFixed(1)}MB`);
  return { data, mime, ext, ...(imageSize(data, mime) || {}) };
}

/**
 * @param {string[]} hrefs
 * @param {{fetchBuffer?: (url: string) => Promise<{data: Buffer, mime: string}>, readFile?: (href: string) => Promise<Buffer>}} loaders
 * @returns {Promise<Map<string, object>>}
 */
export async function loadImages(hrefs, { fetchBuffer, readFile } = {}) {
  const out = new Map();
  const warnings = [];
  for (const href of hrefs) {
    try {
      if (href.startsWith("data:")) {
        const asset = fromDataUrl(href);
        if (!asset || asset.unsupported) { warnings.push(`不支持的 data URL 图片：${String(asset?.mime || "未知类型")}`); continue; }
        out.set(href, asset);
        continue;
      }
      if (/^https?:\/\//i.test(href)) {
        if (!fetchBuffer) { warnings.push(`没有网络能力，跳过远程图片：${href}`); continue; }
        const res = await fetchBuffer(href);
        const mime = String(res.mime || "").toLowerCase().split(";")[0];
        const ext = MIME_EXT[mime] || (/\.(png|jpe?g|gif|bmp)(?:[?#]|$)/i.exec(href)?.[1] || "").toLowerCase().replace("jpeg", "jpg");
        if (!ext || !mime.startsWith("image/")) { warnings.push(`远程资源不是受支持图片：${href}`); continue; }
        if (res.data.length > MAX_IMAGE_BYTES) { warnings.push(`图片过大，已跳过：${href}`); continue; }
        out.set(href, { data: res.data, mime, ext, ...(imageSize(res.data, mime) || {}) });
        continue;
      }
      if (!readFile) { warnings.push(`没有本地文件能力，跳过图片：${href}`); continue; }
      const data = await readFile(href);
      const ext = (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(href)?.[1] || "").toLowerCase().replace("jpeg", "jpg");
      if (!MIME_EXT[`image/${ext === "jpg" ? "jpeg" : ext}`]) { warnings.push(`不支持的本地图片格式：${href}`); continue; }
      const mime = Object.keys(MIME_EXT).find((key) => MIME_EXT[key] === ext) || "image/png";
      out.set(href, { data, mime, ext, ...(imageSize(data, mime) || {}) });
    } catch (err) {
      warnings.push(`图片加载失败：${href}（${String(err?.message || err)}）`);
    }
  }
  return { assets: out, warnings };
}
