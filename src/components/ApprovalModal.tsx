import { useEffect, useRef } from "react";
import type { Approval } from "../types";

type Act = (type: string, payload?: unknown) => Promise<any>;

export function ApprovalModal({ approval, pendingCount = 1, act }: { approval: Approval; pendingCount?: number; act: Act }) {
  const ref = useRef<HTMLDivElement>(null);

  // ACP 可能给多个选项（允许一次 / 总是允许 / 拒绝）；按 optionId 回传，不能只取第一个。
  const options = approval.options.length
    ? approval.options
    : [
        { id: "", name: "拒绝", kind: "reject_once" },
        { id: "", name: "允许一次", kind: "allow_once" },
      ];
  const firstAllow = options.find((o) => o.kind.startsWith("allow"));

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const buttons = () => [...root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    buttons()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = buttons();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [approval.id]);

  const choose = (option: { id: string; kind: string }) => {
    void act("approval", {
      id: approval.id,
      optionId: option.id || undefined,
      allow: option.kind.startsWith("allow"),
    });
  };

  return (
    <div className="modal-mask">
      <div ref={ref} className="modal approval" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <div className="row between gap8">
          <div className="row gap8">
            <span className="approval-dot">!</span>
            <h3 id="approval-title">需要审批</h3>
          </div>
          {pendingCount > 1 && <span className="tag">还有 {pendingCount - 1} 个待审批</span>}
        </div>
        <div className="approval-title">{approval.title}</div>
        {approval.description && <div className="approval-desc">{approval.description}</div>}
        <div className="approval-opts">
          {options.map((o, i) => (
            <button
              key={`${o.id}-${i}`}
              className={`btn ${o === firstAllow ? "primary" : ""}`}
              onClick={() => choose(o)}
            >
              {o.name}
            </button>
          ))}
        </div>
        <div className="tiny faint">选择后立即生效；相同请求不会重复弹出。</div>
      </div>
    </div>
  );
}
