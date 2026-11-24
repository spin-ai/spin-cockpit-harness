import type { Approval } from "../types";

type Act = (type: string, payload?: unknown) => Promise<any>;

/**
 * 待审批队列：右下角一叠卡，**不挡界面**。
 *
 * 之前是一个整屏 `modal-mask` 的模态，一次只画 `approvals[0]`：跑一条任务要连点十几次，
 * 每次点之前整个工作区都不能动（改文件、看日志都做不了）。这里换成和 `.errcard` 同一套
 * 「右下角通知栈」的位置与语言，但每条带选项、可以一条条批；键盘不抢焦点。
 */
export function ApprovalDock({ approvals, act, onOpen }: {
  approvals: Approval[];
  act: Act;
  /** 跳到这条审批所属的会话（有一句上下文再决定） */
  onOpen?: (todoId: string) => void;
}) {
  if (!approvals.length) return null;
  return (
    <section className="approval-dock" aria-label={`待审批（${approvals.length}）`} aria-live="polite">
      {approvals.length > 1 && <div className="approval-dock-head">还有 {approvals.length} 个等你批</div>}
      {approvals.map((a) => {
        // ACP 可能给多个选项（允许一次 / 总是允许 / 拒绝）；按 optionId 回传，不能只取第一个。
        const options = a.options.length
          ? a.options
          : [
              { id: "", name: "拒绝", kind: "reject_once" },
              { id: "", name: "允许一次", kind: "allow_once" },
            ];
        const firstAllow = options.find((o) => o.kind.startsWith("allow"));
        return (
          <article className="approval-card" key={a.id} aria-label={`审批：${a.title || "需要授权"}`}>
            <div className="approval-card-head">
              <span className="approval-dot" aria-hidden>!</span>
              <b className="ellipsis" title={a.title}>{a.title || "需要审批"}</b>
              {a.childTitle && <span className="tiny faint ellipsis">{a.childTitle}</span>}
            </div>
            {a.description && <pre className="approval-card-desc">{a.description}</pre>}
            <div className="approval-card-opts">
              {a.todoId && onOpen && (
                <button className="btn tiny" onClick={() => onOpen(a.todoId)} title="先去会话里看这一步在干什么">去会话</button>
              )}
              {options.map((o, i) => (
                <button
                  key={`${o.id}-${i}`}
                  className={`btn tiny ${o === firstAllow ? "primary" : ""}`}
                  onClick={() => void act("approval", {
                    id: a.id,
                    optionId: o.id || undefined,
                    allow: o.kind.startsWith("allow"),
                  })}
                >
                  {o.name}
                </button>
              ))}
            </div>
          </article>
        );
      })}
    </section>
  );
}
