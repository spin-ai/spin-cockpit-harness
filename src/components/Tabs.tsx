import type { ReactNode } from "react";

export type TabItem = {
  id: string;
  label: ReactNode;
  badge?: ReactNode;
  dot?: boolean;
  disabled?: boolean;
  title?: string;
};

/**
 * 页面级 Tabs / 视图切换。
 *
 * 规范（docs/DESIGN-SYSTEM.md §4.3）：
 * - 页面级切换：胶囊 26px，放在 PageHeader.tabs
 * - 视图切换（卡片 / 列表）：Segmented 22px，放在 PageHeader.actions
 * - 文档标签（笔记 / 知识库打开的文件）是第三种，不属于这里
 */
export function Tabs({ items, value, onChange, ariaLabel, size = "md", wide = false, hint, trailing }: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  size?: "md" | "sm";
  wide?: boolean;
  hint?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className={`tabs ${size === "sm" ? "tabs-sm" : ""} ${wide ? "tabs-wide" : ""}`} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={value === item.id}
          disabled={item.disabled}
          title={item.title}
          className={value === item.id ? "on" : ""}
          onClick={() => onChange(item.id)}
        >
          {item.dot ? <span className="tabs-dot" /> : null}
          <span className="tabs-label">{item.label}</span>
          {item.badge != null ? <em className="tabs-badge">{item.badge}</em> : null}
        </button>
      ))}
      {hint ? <span className="tabs-hint">{hint}</span> : null}
      {trailing ? <span className="tabs-trailing">{trailing}</span> : null}
    </div>
  );
}

export function Segmented({ items, value, onChange, ariaLabel }: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          title={item.title}
          disabled={item.disabled}
          className={value === item.id ? "on" : ""}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
