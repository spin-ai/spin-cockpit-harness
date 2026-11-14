import { useMemo } from "react";
import type { State, Todo } from "../types";
import { EmptyState } from "./EmptyState";
import { RUN_STATUS, STATUS, fmtMs, relTime, tokens } from "../ui";

/** run 状态 → 状态 pill 的 class（todo 与 run 的枚举不同，不能直接混用） */
const RUN_TONE: Record<string, string> = {
  queued: "queued", running: "running", waiting_input: "waiting", waiting_plan: "waiting",
  waiting_children: "waiting", completed: "done", failed: "failed", cancelled: "cancelled",
  interrupted: "cancelled", accepted: "done", rework: "waiting", proposed: "todo",
};

/**
 * 任务详情：终端区域里的「任务」视图。
 *
 * 为什么不做成新标签页：终端标签是 pty 的生命周期（拆分 / 接管 / 重连），
 * 把「详情」塞进去会让关闭标签、拆分、拖拽预览都要多问一句「这个 tab 有 pty 吗」。
 * 这里做成终端槽位的两个视图（终端 / 任务），pty 一直挂着，切视图不丢会话。
 */
export function TaskDetail({ state, todo, act, onOpenThread }: {
  state: State;
  todo: Todo | null;
  act: (type: string, payload?: unknown) => Promise<any>;
  onOpenThread: (threadId: string) => void;
}) {
  const runs = useMemo(
    () => (todo ? state.runs.filter((r) => r.todoId === todo.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) : []),
    [state.runs, todo],
  );
  const artifacts = useMemo(
    () => (todo ? state.artifacts.filter((a) => a.todoId === todo.id).sort((a, b) => b.createdAt - a.createdAt) : []),
    [state.artifacts, todo],
  );
  const terminals = useMemo(
    () => (todo ? (state.terminals || []).filter((t) => t.todoId === todo.id) : []),
    [state.terminals, todo],
  );
  const delegations = useMemo(
    () => (todo?.kind === "mission" ? (state.delegations || []).filter((d) => d.missionId === todo.id) : []),
    [state.delegations, todo],
  );

  if (!todo) {
    return (
      <div className="task-detail empty-wrap">
        <EmptyState compact title="还没选中任务" desc="在左侧 TODO 里选一个任务，这里显示它的描述、验收、运行记录和产物。" />
      </div>
    );
  }

  const project = state.projects.find((p) => p.id === todo.projectId) ?? null;
  const agent = state.agents.find((a) => a.id === todo.agentId) ?? null;
  const active = runs.find((r) => ["queued", "running", "waiting_input"].includes(r.status)) ?? null;
  const last = runs[0] ?? null;
  const thread = state.threads.find((t) => t.todoId === todo.id) ?? null;
  const branch = last?.branch ?? null;
  const cwd = last?.cwd || todo.cwd || project?.path || "";

  const copyMarkdown = async () => {
    const lines = [
      `# ${todo.key} ${todo.title}`,
      "",
      `- 状态：${STATUS[todo.status]?.label || todo.status}${todo.priority ? ` · ${todo.priority}` : ""}`,
      `- 项目：${project?.name || "—"}${agent ? ` · Agent：${agent.name}` : ""}`,
      todo.due ? `- 截止：${todo.due}` : "",
      cwd ? `- 目录：${cwd}` : "",
      branch ? `- 分支：${branch}` : "",
      "",
      todo.desc ? `## 描述\n${todo.desc}` : "",
      (todo.acceptance || []).length ? `## 验收\n${todo.acceptance.map((a) => `- ${a}`).join("\n")}` : "",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="task-detail">
      <header className="td-head">
        <div className="td-head-main">
          <div className="td-kicker">
            <span className="mono">{todo.key}</span>
            <span className="td-kicker-sep">/</span>
            <span>{project?.name || "未归属项目"}</span>
            {agent && <><span className="td-kicker-sep">/</span><span>{agent.name}</span></>}
          </div>
          <h2 className="td-h2">{todo.title}</h2>
          <div className="td-badges">
            <span className={`pill status ${STATUS[todo.status]?.cls || "todo"}`}>{STATUS[todo.status]?.label || todo.status}</span>
            {todo.priority && <span className={`prio ${todo.priority}`}>{todo.priority}</span>}
            {(todo.tags || []).map((t) => <span className="tag" key={t}>{t}</span>)}
            <span className="tiny muted">更新于 {relTime(todo.updatedAt)}</span>
          </div>
        </div>
        <div className="td-head-actions">
          {active && (
            <>
              <span className="td-live"><span className="dot green" />{RUN_STATUS[active.status] || active.status}</span>
              <button className="btn tiny-btn" onClick={() => void act("stop", { runId: active.id })}>停止</button>
            </>
          )}
          {thread && <button className="btn tiny-btn" onClick={() => onOpenThread(thread.id)}>打开会话</button>}
          <button className="btn tiny-btn" onClick={() => void copyMarkdown()} title="复制成 Markdown，可直接贴进 Chat 或 issue">复制详情</button>
        </div>
      </header>

      <div className="td-cols">
        <section className="td-main">
          <div className="td-block">
            <div className="td-label">描述</div>
            {todo.desc ? <pre className="td-text">{todo.desc}</pre> : <p className="td-hint">没有描述。双击左侧任务行可以补背景和目标。</p>}
          </div>

          <div className="td-block">
            <div className="td-label">验收 <em>{todo.acceptance?.length || 0}</em></div>
            {todo.acceptance?.length ? (
              <ol className="td-accept">
                {todo.acceptance.map((item, i) => (
                  <li key={i}>
                    <span className="td-accept-no mono">{String(i + 1).padStart(2, "0")}</span>
                    <span className="td-accept-text">{item}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="td-hint">没写验收标准。没有验收的任务，Agent 只能按自己的理解收尾。</p>}
          </div>

          {todo.kind === "mission" && delegations.length > 0 && (
            <div className="td-block">
              <div className="td-label">子任务 <em>{delegations.filter((d) => ["completed", "accepted"].includes(d.status)).length}/{delegations.length}</em></div>
              <div className="td-table td-delegations">
                {delegations.map((d) => (
                  <div className="td-tr" key={d.id}>
                    <span><span className={`pill status ${RUN_TONE[d.status] || "todo"}`}>{RUN_STATUS[d.status] || d.status}</span></span>
                    <span className="td-cell-main ellipsis">{d.title}</span>
                    <span className="td-cell-dim ellipsis">{state.agents.find((a) => a.id === d.agentId)?.name || ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="td-block">
            <div className="td-label">运行记录 <em>{runs.length}</em></div>
            {runs.length === 0 ? <p className="td-hint">还没有跑过。在 Chat 里派活后会出现在这里。</p> : (
              <div className="td-table td-runs">
                <div className="td-tr td-th">
                  <span>状态</span><span>结束</span><span className="num">耗时</span><span className="num">Token</span><span>备注</span>
                </div>
                {runs.slice(0, 8).map((r) => {
                  const note = r.error || r.queueReason || "";
                  return (
                    <div className="td-tr" key={r.id}>
                      <span><span className={`pill status ${RUN_TONE[r.status] || "todo"}`}>{RUN_STATUS[r.status] || r.status}</span></span>
                      <span className="td-cell-dim">{relTime(r.endedAt || r.startedAt || r.createdAt || 0)}</span>
                      <span className="num mono td-cell-dim">{fmtMs(r.durationMs ?? (r.startedAt && r.endedAt ? r.endedAt - r.startedAt : null))}</span>
                      <span className="num mono td-cell-dim">{r.tokens != null ? tokens(r.tokens) : "未上报"}</span>
                      <span className="td-cell-note ellipsis" title={note}>{note}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="td-side">
          <div className="td-block">
            <div className="td-label">环境</div>
            <dl className="td-kv">
              <dt>目录</dt><dd className="mono ellipsis" title={cwd}>{cwd || "—"}</dd>
              <dt>分支</dt><dd className="mono ellipsis">{branch || "—"}</dd>
              <dt>Agent</dt><dd className="ellipsis">{agent ? `${agent.name} · ${agent.cli}` : "未指派"}</dd>
              <dt>终端</dt><dd>{terminals.length ? `${terminals.filter((t) => t.status === "running").length} 运行中 / ${terminals.length}` : "—"}</dd>
              <dt>截止</dt><dd>{todo.due || "—"}</dd>
              <dt>创建</dt><dd>{relTime(todo.createdAt)}</dd>
            </dl>
          </div>

          <div className="td-block">
            <div className="td-label">产物 <em>{artifacts.length}</em></div>
            {artifacts.length ? (
              <div className="td-table td-artifacts">
                {artifacts.slice(0, 6).map((a) => (
                  <div className="td-tr" key={a.id}>
                    <span><span className="tag">{a.kind}</span></span>
                    <span className="td-cell-main ellipsis" title={a.ref || a.title}>{a.title || a.ref}</span>
                    <span className="td-cell-dim">{relTime(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="td-hint">还没有产物。Agent 产出文件 / diff / 页面后会列在这里。</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
