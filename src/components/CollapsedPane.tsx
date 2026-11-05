import type { ReactNode } from "react";

/** 面板收起后的窄条：点击整条或按 Enter 展开。 */
export function CollapsedPane({ label, title, icon, onExpand }: {
  label: string;
  title: string;
  icon: ReactNode;
  onExpand: () => void;
}) {
  const expand = () => onExpand();
  return (
    <div
      className="collapsed-pane"
      role="button"
      tabIndex={0}
      title={`展开${title}`}
      aria-label={`展开${title}`}
      onClick={expand}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        expand();
      }}
    >
      <span className="collapsed-icon">{icon}</span>
      <span className="collapsed-label">{label}</span>
    </div>
  );
}
