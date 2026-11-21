import { FileCodeIcon, FileIcon, FileImageIcon, FileMediaIcon, FileTextIcon } from "./Icons";

const EXT_COLORS: Record<string, string> = {
  ts: "#3178c6", tsx: "#3178c6", js: "#ca8a04", jsx: "#0284c7",
  json: "#b45309", md: "#64748b", mdx: "#64748b", css: "#2563eb", scss: "#db2777",
  html: "#ea580c", vue: "#059669", svelte: "#ea580c", py: "#2563eb", go: "#0891b2",
  rs: "#b45309", sh: "#16a34a", yml: "#7c3aed", yaml: "#7c3aed",
  png: "#7c3aed", jpg: "#7c3aed", jpeg: "#7c3aed", webp: "#7c3aed", gif: "#7c3aed", svg: "#7c3aed",
  lock: "#71717a",
};

// 扩展名 → 预览方式。预览（PreviewSurface）与主进程 files:read 共用同一套口径，改这里记得同步 electron/main.mjs。
export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "ico", "bmp", "avif", "tif", "tiff"]);
// Chromium 能直接播放的容器（mkv / avi 不支持，交给系统播放器）
export const VIDEO_EXT = new Set(["mp4", "m4v", "webm", "ogv", "mov"]);
export const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac"]);
// 文档预览（主进程 electron/doc-preview.mjs 的 officeKind 必须覆盖同一批扩展名）
export const DOC_EXT = new Set(["docx", "xlsx", "xlsm", "xls", "ods", "doc", "pptx", "pptm", "odt", "odp", "odg", "rtf", "epub"]);
const CODE_EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "sh", "bash", "css", "scss", "html", "vue", "svelte", "json", "yml", "yaml", "toml"]);
const TEXT_EXT = new Set(["md", "mdx", "txt", "log", "csv"]);

export function extOf(name: string) {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

/** 文件类型图标（资源管理器 / 预览标签共用） */
export function FileVisual({ name, size = 14 }: { name: string; size?: number }) {
  const ext = extOf(name);
  const color = EXT_COLORS[ext] ?? "#a1a1aa";
  if (IMAGE_EXT.has(ext)) return <FileImageIcon size={size} className="file-ico" style={{ color }} />;
  if (VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext)) return <FileMediaIcon size={size} className="file-ico" style={{ color }} />;
  if (CODE_EXT.has(ext)) return <FileCodeIcon size={size} className="file-ico" style={{ color }} />;
  if (TEXT_EXT.has(ext) || DOC_EXT.has(ext)) return <FileTextIcon size={size} className="file-ico" style={{ color }} />;
  return <FileIcon size={size} className="file-ico" style={{ color }} />;
}
