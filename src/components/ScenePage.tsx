import { useMemo, useState } from "react";
import type { Project, State } from "../types";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { SceneConfigModal } from "./SceneConfigModal";

type Act = (type: string, payload?: unknown) => Promise<any>;

/**
 * 执行配置总览：只展示每个项目的执行配置和运行状态。
 * 配置编辑统一走 SceneConfigModal；项目本身的管理留在「项目」页，避免两个项目列表。
 */
export function ScenePage({ state, act, notify, onOpenProject, onOpenTerminal }: {
  state: State; act: Act; notify: (message: string) => void;
  onOpenProject: (id: string) => void | Promise<void>;
  onOpenTerminal: (cwd: string) => void;
}) {
  const [editing, setEditing] = useState<Project | null>(null);

  const rows = useMemo(() => state.projects.map((project) => {
    const todos = state.todos.filter((t) => t.projectId === project.id);
    const ids = new Set(todos.map((t) => t.id));
    const runs = state.runs.filter((r) => ids.has(r.todoId));
    const activeRuns = runs.filter((r) => ["queued", "running", "waiting_input"].includes(r.status)).length;
    const terminals = (state.terminals || []).filter((t) => t.projectId === project.id);
    const activeTerms = terminals.filter((t) => t.status === "running").length;
    const open = todos.filter((t) => !t.confirmed).length;
    const failed = todos.filter((t) => t.lastRunFailed).length;
    const scene = (state.scenes || []).find((s) => s.projectId === project.id);
    const text = scene?.text?.trim() || "";
    return { project, text, configured: Boolean(text), activeRuns, activeTerms, terminals: terminals.length, open, failed };
  }), [state.projects, state.todos, state.runs, state.terminals, state.scenes]);

  const configured = rows.filter((r) => r.configured).length;
  const activeRuns = rows.reduce((sum, r) => sum + r.activeRuns, 0);
  const activeTerms = rows.reduce((sum, r) => sum + r.activeTerms, 0);
  const editingRow = editing ? rows.find((r) => r.project.id === editing.id) : null;

  return (
    <div className="page scene-page">
      <PageHeader
        kicker="执行"
        title="执行配置"
        subtitle={`${state.projects.length} 个项目 · 每个项目一份执行配置；Chat 派活时按这里推荐项目 / Agent / 执行方式`}
        actions={<span className="tiny muted">全局默认 worktree：{state.settings.worktreeMode || "auto"}</span>}
      />

      <div className="project-overview scene-overview-bar">
        <div className="project-overview-item"><b>{state.projects.length}</b><span>项目</span></div>
        <div className="project-overview-item"><b>{configured}/{state.projects.length}</b><span>已配置</span></div>
        <div className={`project-overview-item ${activeRuns ? "run" : ""}`}><b>{activeRuns}</b><span>运行中</span></div>
        <div className="project-overview-item"><b>{activeTerms}</b><span>终端</span></div>
      </div>

      {state.projects.length === 0 ? (
        <EmptyState compact title="还没有项目" desc="先添加一个本地项目，执行配置会按项目保存。" />
      ) : (
        <div className="scene-overview-grid">
          {rows.map((row) => (
            <article className={`panel scene-card ${row.configured ? "" : "empty"}`} key={row.project.id} data-project-id={row.project.id}>
              <header className="scene-card-head">
                <div className={`project-mark ${row.project.color}`}>{row.project.name.trim().slice(0, 1).toUpperCase() || "P"}</div>
                <div className="scene-card-title">
                  <div className="row gap6 wrap">
                    <b>{row.project.name}</b>
                    <span className="tag mono">@{row.project.alias}</span>
                    <span className={`tag ${row.configured ? "ok" : ""}`}>{row.configured ? "已配置" : "未配置"}</span>
                  </div>
                  <span className="mono tiny faint ellipsis" title={row.project.path}>{row.project.path}</span>
                </div>
              </header>

              <div className="scene-card-stats">
                <span className={row.activeRuns ? "run" : ""}><b>{row.activeRuns}</b>运行</span>
                <span><b>{row.activeTerms}</b>终端</span>
                <span><b>{row.open}</b>未完成</span>
                <span className={row.failed ? "bad" : ""}><b>{row.failed}</b>失败</span>
              </div>

              <pre className={`scene-card-text ${row.configured ? "" : "empty"}`}>{row.text || "还没有执行配置。用「编辑配置」写下 worktree / runtime / agent 等偏好。"}</pre>

              <footer className="scene-card-foot">
                <button className="btn tiny-btn primary" onClick={() => setEditing(row.project)}>编辑配置</button>
                <button className="btn tiny-btn" onClick={() => void onOpenProject(row.project.id)}>打开项目</button>
                <button className="btn tiny-btn" onClick={() => onOpenTerminal(row.project.path)}>终端</button>
                <span className="tiny faint">{row.terminals} 终端 · {row.failed ? "有失败" : "正常"}</span>
              </footer>
            </article>
          ))}
        </div>
      )}

      {editing && editingRow && (
        <SceneConfigModal
          key={editing.id}
          project={editing}
          text={editingRow.text}
          act={act}
          notify={notify}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
