import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions, tabs }: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <h1>{title}</h1>
        {/* 用 div 而不是 p：subtitle 常传 <div className="stat-strip">，p 里嵌 div 会被浏览器拆坏 DOM */}
        {subtitle && <div className="page-header-sub" title={typeof subtitle === "string" ? subtitle : undefined}>{subtitle}</div>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
      {tabs && <div className="page-header-tabs">{tabs}</div>}
    </header>
  );
}
