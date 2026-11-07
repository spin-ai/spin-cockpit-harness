import type { ReactNode } from "react";

export function EmptyState({ mark = "◇", title, desc, action, compact = false }: {
  mark?: string;
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`}>
      <div className="empty-state-mark">{mark}</div>
      <b>{title}</b>
      {desc && <p>{desc}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
