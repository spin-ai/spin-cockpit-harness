import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, CopyCheckIcon, CopyIcon } from "./Icons";

/** 时间戳 → hh:mm（轨迹账本与聊天时间同源格式） */
const hm = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 一条轨迹记录：输入 / 思考 / 模型请求 / 工具 / 终端（bot 回合与任务 run 共用） */
export interface TrajectoryRecord {
  id: string;
  turn: number;
  turnId: string;
  kind: "user" | "assistant" | "thought" | "tool" | "terminal" | "context";
  at: number;
  ms: number;
  title: string;
  args?: string;
  result?: string;
  text?: string;
  usage?: string;
}

/** 轨迹里的一个字段：可整段复制（排查时贴出去的就是这一段原文，不是截断后的） */
function TrField({ label, value, recordId }: { label: string; value: string; recordId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ds-tr-field" key={recordId}>
      <span>{label}</span>
      <button
        className="icon-btn"
        title={copied ? "已复制" : `复制${label}`}
        aria-label={copied ? "已复制" : `复制${label}`}
        onClick={() => {
          void window.harness.clipboardWrite(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >{copied ? <CopyCheckIcon size={14} /> : <CopyIcon size={14} />}</button>
      <pre>{value}</pre>
    </div>
  );
}

export function TrajectoryView({ records, onJump, focusTurnId, unit = "轮", onBack }: {
  records: TrajectoryRecord[]; onJump: (turnId: string) => void; focusTurnId?: string | null; unit?: string;
  /** 任务会话里没有页签：返回对话由轨迹自己的工具栏承担 */
  onBack?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 从某一轮动作点进来：滚到那一轮并让它的那条记录展开
  useEffect(() => {
    if (!focusTurnId) return;
    const el = scrollRef.current?.querySelector(`[data-turn-id="${focusTurnId}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "center" });
  }, [focusTurnId]);
  const [foldDuration, setFoldDuration] = useState(true);
  const [foldTurns, setFoldTurns] = useState(true);
  const [foldCalls, setFoldCalls] = useState(true);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = records.filter((r) => {
    if (!needle) return true;
    return `${r.title} ${r.args || ""} ${r.result || ""} ${r.text || ""}`.toLowerCase().includes(needle);
  });
  const domain = useMemo(() => {
    if (!records.length) return { from: 0, to: 1 };
    const from = Math.min(...records.map((r) => r.at));
    const to = Math.max(...records.map((r) => r.at + Math.max(1, r.ms)));
    return { from, to: Math.max(to, from + 1) };
  }, [records]);
  const lanes: { key: string; label: string; kinds: TrajectoryRecord["kind"][] }[] = [
    { key: "input", label: "输入", kinds: ["user"] },
    { key: "model", label: "模型", kinds: ["assistant", "thought"] },
    { key: "tools", label: "工具", kinds: ["tool", "terminal"] },
  ];
  const laneOf = (kind: TrajectoryRecord["kind"]) => (kind === "user" || kind === "context" ? "input" : kind === "tool" || kind === "terminal" ? "tools" : "model");
  const pct = (value: number) => ((value - domain.from) / (domain.to - domain.from)) * 100;
  const currentTurn = visible[0]?.turn ?? 0;
  return (
    <div className="ds-trajectory" ref={scrollRef}>
      <div className="ds-tr-toolbar">
        {onBack && (
          <button className="ds-tr-back" onClick={onBack} title="回到对话" aria-label="回到对话">
            <ChevronLeftIcon size={14} /> 对话
          </button>
        )}
        <button className={foldDuration ? "on" : ""} onClick={() => setFoldDuration((v) => !v)} aria-pressed={foldDuration}>时长</button>
        <button className={foldTurns ? "on" : ""} onClick={() => setFoldTurns((v) => !v)} aria-pressed={foldTurns}>轮次</button>
        <button className={foldCalls ? "on" : ""} onClick={() => setFoldCalls((v) => !v)} aria-pressed={foldCalls}>调用</button>
        <button disabled title="这一版还没有子调用数据">子调用</button>
        <span className="ds-tr-spacer" />
        <input className="ds-tr-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索轨迹" aria-label="搜索轨迹" />
      </div>

      {foldDuration && (
        <div className="ds-tr-overview" aria-label="时间轴">
          <div className="ds-tr-ruler">
            <span style={{ left: "0%" }}>{hm(domain.from)}</span>
            <span style={{ left: "50%" }}>{hm((domain.from + domain.to) / 2)}</span>
            <span style={{ right: "0%" }}>{hm(domain.to)}</span>
          </div>
          {lanes.map((lane) => (
            <div className="ds-tr-lane" key={lane.key}>
              <span className="ds-tr-lane-label">{lane.label}</span>
              <div className="ds-tr-track">
                {visible.filter((r) => laneOf(r.kind) === lane.key).map((r) => (
                  <button
                    key={r.id}
                    className={`ds-tr-block k-${r.kind}`}
                    style={{ left: `${pct(r.at)}%`, width: `${Math.max(0.6, (Math.max(1, r.ms) / (domain.to - domain.from)) * 100)}%` }}
                    title={`${hm(r.at)} · ${r.title}${r.ms > 1 ? ` · ${(r.ms / 1000).toFixed(1)}s` : ""}`}
                    aria-label={`跳到第 ${r.turn} 轮`}
                    onClick={() => onJump(r.turnId)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ds-tr-ledger">
        {visible.length === 0 && <div className="ds-tr-empty">{needle ? "没有命中" : "这个会话还没有轨迹"}</div>}
        {visible.map((r, index) => {
          const showTurn = foldTurns && (index === 0 || visible[index - 1].turn !== r.turn);
          const folded = !foldCalls && (r.kind === "tool" || r.kind === "terminal");
          if (folded) return null;
          return (
            <Fragment key={r.id}>
              {showTurn && <div className={`ds-tr-turn ${r.turn === currentTurn ? "on" : ""}`}>第 {r.turn} {unit}</div>}
              <details className={`ds-tr-row ${focusTurnId && r.turnId === focusTurnId ? "focus" : ""}`} data-turn-id={r.turnId} open={Boolean(focusTurnId && r.turnId === focusTurnId) || undefined}>
                <summary className="ds-tr-row-head">
                  <span className={`ds-tr-chip k-${r.kind}`}>{r.kind === "user" ? "用户" : r.kind === "assistant" ? "助手" : r.kind === "thought" ? "思考" : r.kind === "terminal" ? "终端" : r.kind === "context" ? "注入" : "工具"}</span>
                  <b className="ds-tr-title">{r.title}</b>
                  {r.args && <span className="ds-tr-args">{r.args}</span>}
                  {r.result && <><span className="ds-tr-arrow" aria-hidden>→</span><span className="ds-tr-result">{r.result}</span></>}
                  {!r.args && !r.result && r.text && <span className="ds-tr-result">{r.text}</span>}
                  <span className="ds-tr-meta">{hm(r.at)}{r.ms > 1 ? ` · ${(r.ms / 1000).toFixed(1)}s` : ""}{r.usage ? ` · ${r.usage}` : ""}</span>
                </summary>
                <div className="ds-tr-detail">
                  {r.text && <pre>{r.text}</pre>}
                  {[
                    { key: "args", label: "原始参数", value: r.args },
                    { key: "result", label: "输出", value: r.result },
                    { key: "usage", label: "用量", value: r.usage },
                  ].filter((f) => f.value).map((f) => <TrField key={f.key} label={f.label} value={String(f.value)} recordId={r.id} />)}
                  <div className="ds-tr-actions">
                    <button className="ds-action-text" onClick={() => onJump(r.turnId)}>跳到这一轮</button>
                    {(r.kind === "tool" || r.kind === "terminal") && r.result && (
                      <button
                        className="ds-action-text"
                        title="把这一步的输出整段复制出来（贴到 issue / 对话里）"
                        onClick={() => void window.harness.clipboardWrite(`${r.title}\n\n${r.result}`)}
                      >复制整步</button>
                    )}
                  </div>
                </div>
              </details>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

