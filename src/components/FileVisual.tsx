import { FileCodeIcon, FileIcon, FileImageIcon, FileTextIcon } from "./Icons";

const EXT_COLORS: Record<string, string> = {
  ts: "#3178c6", tsx: "#3178c6", js: "#ca8a04", jsx: "#0284c7",
  json: "#b45309", md: "#64748b", mdx: "#64748b", css: "#2563eb", scss: "#db2777",
  html: "#ea580c", vue: "#059669", svelte: "#ea580c", py: "#2563eb", go: "#0891b2",
  rs: "#b45309", sh: "#16a34a", yml: "#7c3aed", yaml: "#7c3aed",
  png: "#7c3aed", jpg: "#7c3aed", jpeg: "#7c3aed", webp: "#7c3aed", gif: "#7c3aed", svg: "#7c3aed",
  lock: "#71717a",
};

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "ico", "bmp"]);
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
  if (CODE_EXT.has(ext)) return <FileCodeIcon size={size} className="file-ico" style={{ color }} />;
  if (TEXT_EXT.has(ext)) return <FileTextIcon size={size} className="file-ico" style={{ color }} />;
  return <FileIcon size={size} className="file-ico" style={{ color }} />;
}
