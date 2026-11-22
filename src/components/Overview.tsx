import type { ReactNode } from "react";

export type OverviewItem = {
  label: ReactNode;
  value: ReactNode;
  /** 语义色：运行 / 风险 / 失败 */
  tone?: "run" | "warn" | "fail";
  /** 右侧的「当前项目」这类主动作字段 */
  active?: boolean;
};

/** 实体计数条：项目 / 主机 / 机器人共用（docs/DESIGN-SYSTEM.md §4.7） */
export function Overview({ items, className = "" }: { items: OverviewItem[]; className?: string }) {
  return (
    <div className={`overview ${className}`}>
      {items.map((item, index) => (
        <div key={index} className={`overview-item ${item.tone || ""} ${item.active ? "active-name" : ""}`}>
          {item.active ? (
            <>
              <span>{item.label}</span>
              <b>{item.value}</b>
            </>
          ) : (
            <>
              <b>{item.value}</b>
              <span>{item.label}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
