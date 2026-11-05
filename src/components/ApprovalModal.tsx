import type { Approval } from "../types";

type Act = (type: string, payload?: unknown) => Promise<any>;

export function ApprovalModal({ approval, act }: { approval: Approval; act: Act }) {
  const allow = approval.options.find((o) => o.kind.startsWith("allow")) || approval.options[0];
  const deny = approval.options.find((o) => o.kind.startsWith("reject")) || approval.options[approval.options.length - 1];
  return (
    <div className="modal-mask">
      <div className="modal approval">
        <div className="row gap8"><span className="approval-dot">!</span><div><h3>需要审批</h3><div className="tiny muted">run 正在等待你的决定</div></div></div>
        <div className="approval-title">{approval.title}</div>
        {approval.description && <div className="approval-desc">{approval.description}</div>}
        {approval.options.length > 0 && (
          <div className="approval-opts">{approval.options.map((o) => <span className="tag" key={o.id}>{o.name}</span>)}</div>
        )}
        <div className="row gap8" style={{ justifyContent: "flex-end", marginTop: 4 }}>
          <button className="btn" onClick={() => act("approval", { id: approval.id, allow: false })}>{deny?.name || "拒绝"}</button>
          <button className="btn primary" onClick={() => act("approval", { id: approval.id, allow: true })}>{allow?.name || "允许一次"}</button>
        </div>
      </div>
    </div>
  );
}
