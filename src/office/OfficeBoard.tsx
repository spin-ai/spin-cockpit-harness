import type { OfficeModel, OfficeTone } from "./model";

/** 状态优先级：一眼先看到在干活的和要他处理的 */
const TONE_ORDER: Record<OfficeTone, number> = { run: 0, wait: 1, fail: 2, review: 3, lead: 4, neutral: 5 };
const TONE_LABEL: Record<OfficeTone, string> = { run: "运行中", wait: "等待", fail: "失败", review: "待验收", lead: "待命", neutral: "空闲" };
const TONE_CLASS: Record<OfficeTone, string> = { run: "run", wait: "wait", fail: "fail", review: "review", lead: "idle", neutral: "idle" };

/**
 * 进展看板：不点开任何东西，也能看出每个角色此刻在做什么。
 * 数据全部来自 State（runs / messages / todos），不伪造进度。
 */
export function OfficeBoard({ model, selectedId, onSelect }: {
  model: OfficeModel;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const rows = [...model.actors].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.seat! - b.seat!);
  if (!rows.length) return null;
  return (
    <section className="off-board" aria-label="进展看板">
      <div className="off-board-head">
        <b>进展</b>
        <span>{model.stats.running} 在跑 · {model.stats.queued} 排队 · {model.stats.waiting} 待确认 · {model.stats.review} 待验收</span>
      </div>
      <div className="off-board-rows">
        {rows.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`off-board-card tone-${a.tone} ${selectedId === a.id ? "on" : ""}`}
            onClick={() => onSelect(a.id)}
            title={a.detail}
          >
            <span className="off-board-top">
              <b className="off-ellipsis">{a.displayName}</b>
              <span className={`off-status-pill ${TONE_CLASS[a.tone]}`}>{a.statusLabel || TONE_LABEL[a.tone]}</span>
            </span>
            <span className="off-board-act off-ellipsis">
              {a.tone === "run" || a.tone === "fail"
                ? (a.activity ? <><b>{a.activity.tool}</b>{a.activity.target}</> : a.tone === "fail" ? "失败，可重试" : "启动中…")
                : a.statusLabel === "排队" ? "排队中，等前一个任务结束"
                  : a.tone === "wait" ? "等你确认"
                    : a.tone === "review" ? "产物已生成，去验收"
                      : "没有进行中的任务"}
            </span>
            <span className="off-board-sub off-ellipsis">
              {a.task ? `${a.task.key} ${a.task.title}` : "—"}
              {a.progress.tools ? ` · ${a.progress.tools} 步` : ""}
              {a.elapsed ? ` · ${a.elapsed}` : ""}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
