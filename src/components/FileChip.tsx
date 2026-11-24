import { FileTextIcon } from "./Icons";
import { requestFilePreview } from "../terminal-events";

/** 文件 chip：默认在对话里展开预览（给了 onOpen 就交给它，卡片里还有「在标签里打开」） */
export function FileChip({ path, onOpen }: { path: string; onOpen?: (path: string) => void }) {
  const name = path.split("/").filter(Boolean).pop() || path;
  const short = name.length > 28 ? `${name.slice(0, 26)}…` : name;
  return (
    <span className="ds-file-chip" title={path}>
      <FileTextIcon size={14} />
      <button
        className="ds-file-chip-name"
        onClick={(e) => { e.stopPropagation(); if (onOpen) onOpen(path); else requestFilePreview({ rel: path, name }); }}
      >{short}</button>
    </span>
  );
}
