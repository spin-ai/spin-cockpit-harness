import { FileTextIcon, LinkIcon, PencilIcon, SearchIcon, SparkleIcon, TerminalIcon, WrenchIcon, ListIcon } from "./Icons";
import type { ToolFamily } from "../tool-family";

/**
 * 工具家族 → 图标。家族由主进程写入（ACP kind / 工具名），这里只做映射；
 * 不再按 `title + kind` 跑正则猜（猜错的代价是一整张卡片认错）。
 */
export function ToolFamilyIcon({ family, size = 14 }: { family: ToolFamily; size?: number }) {
  switch (family) {
    case "run": return <TerminalIcon size={size} />;
    case "edit": return <PencilIcon size={size} />;
    case "read": return <FileTextIcon size={size} />;
    case "search": return <SearchIcon size={size} />;
    case "net": return <LinkIcon size={size} />;
    case "plan": return <ListIcon size={size} />;
    case "think": return <SparkleIcon size={size} />;
    case "mcp": return <WrenchIcon size={size} />;
    default: return <WrenchIcon size={size} />;
  }
}
