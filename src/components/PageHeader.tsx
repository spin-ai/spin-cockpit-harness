import type { ReactNode } from "react";

export function PageHeader({ kicker, title, subtitle, actions, tabs }: {
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {kicker && <span className="page-header-kicker">{kicker}</span>}
        <h1>{title}</h1>
        {subtitle && <p className="page-header-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
      {tabs && <div className="page-header-tabs">{tabs}</div>}
    </header>
  );
}
