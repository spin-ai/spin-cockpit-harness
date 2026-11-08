import { useEffect, useMemo, useState } from "react";
import type { State } from "../types";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { RUN_STATUS, timeAgo } from "../ui";

type Act = (type: string, payload?: unknown) => Promise<any>;

const TERM_STATUS: Record<string, string> = {
  running: "运行中", exited: "已退出", closed: "已关闭", failed: "失败", detached: "已断开",
};

export function ScenePage({ state, act, notify, onOpenProject, onOpenTerminal }: {
  state: State; act: Act; notify: (message: string) => void;
  onOpenProject: (id: string) => void | Promise<void>;
  onOpenTerminal: (cwd: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const scene of state.scenes || []) {
        if (!(scene.projectId in next)) next[scene.projectId] = scene.text;
      }
      return next;
    });
  }, [state.scenes]);

  const liveTerminals = state.terminals || [];
  const byProject = useMemo(() => {
    const map = new Map<string, { running: number; queued: number; review: number; failed: number }>();
    for (const project of state.projects) map.set(project.id, { running: 0, queued: 0, review: 0, failed: 0 });
    for (const todo of state.todos) {
      if (!todo.projectId) continue;
      const count = map.get(todo.projectId);
      if (!count) continue;
      if (todo.status === "in_review") count.review += 1;
    }
    // 每个 todo 只看最新一次 run，避免重试后失败数无限累加。
    const latestByTodo = new Map<string, (typeof state.runs)[number]>();
    for (const run of state.runs) {
      const prev = latestByTodo.get(run.todoId);
      const at = run.endedAt || run.startedAt || run.createdAt || 0;
      const prevAt = prev?.endedAt || prev?.startedAt || prev?.createdAt || 0;
      if (!prev || at >= prevAt) latestByTodo.set(run.todoId, run);
    }
    for (const run of latestByTodo.values()) {
      const todo = state.todos.find((t) => t.id === run.todoId);
      const count = todo?.projectId ? map.get(todo.projectId) : null;
      if (!count) continue;
      if (run.status === "running" || run.status === "waiting_input") count.running += 1;
      if (run.status === "queued") count.queued += 1;
      if (run.status === "failed") count.failed += 1;
    }
    return map;
  }, [state.projects, state.todos, state.runs]);

  const save = async (projectId: string) => {
    setBusy(`save:${projectId}`);
    try {
      const res = await act("saveScene", { projectId, text: drafts[projectId] || "" });
      if (res) notify("场景配置已保存，下一次派活生效");
    } finally { setBusy(null); }
  };

  const suggest = async (projectId: string) => {
    setBusy(`ai:${projectId}`);
    try {
      const text = await act("sceneSuggestion", { projectId });
      if (text) setDrafts((current) => ({ ...current, [projectId]: String(text) }));
    } finally { setBusy(null); }
  };

  return (
    <div className="page scene-page">
      <PageHeader
        kicker="SCENE"
        title="场景"
        subtitle={`${state.projects.length} 个项目 · 每个项目一份执行配置；Chat 派活时按这里推荐项目 / Agent / 执行方式`}
        actions={<span className="tiny muted">全局默认 worktree：{state.settings.worktreeMode || "auto"}</span>}
      />
      {state.projects.length === 0 && <EmptyState compact title="还没有项目" desc="先添加一个本地项目，场景配置会按项目保存。" />}
      <div className="scene-grid">
        {state.projects.map((project) => {
          const scene = (state.scenes || []).find((s) => s.projectId === project.id);
          const counts = byProject.get(project.id) || { running: 0, queued: 0, review: 0, failed: 0 };
          const terminals = liveTerminals.filter((t) => t.projectId === project.id);
          const activeTerms = terminals.filter((t) => t.status === "running");
          const failures = state.runs
            .filter((r) => r.status === "failed" && state.todos.find((t) => t.id === r.todoId)?.projectId === project.id)
            .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
            .slice(0, 2);
          return (
            <section key={project.id} className={`scene-card ${project.id === state.activeProjectId ? "on" : ""}`}>
              <header className="scene-card-head">
                <div className="scene-card-title">
                  <span className={`project-mark ${project.color}`}>{project.name.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <b>{project.name}</b>
                    <span className="mono tiny faint">@{project.alias || "—"} · {project.path}</span>
                  </div>
                </div>
                <div className="row gap4">
                  <button className="btn tiny-btn" onClick={() => void onOpenProject(project.id)}>切到项目</button>
                  <button className="btn tiny-btn" onClick={() => onOpenTerminal(project.path)}>开终端</button>
                </div>
              </header>

              <div className="scene-progress">
                <span className={counts.running ? "on" : ""}><b>{counts.running}</b> 运行中</span>
                <span><b>{counts.queued}</b> 排队</span>
                <span className={counts.review ? "warn" : ""}><b>{counts.review}</b> 待确认</span>
                <span className={counts.failed ? "bad" : ""}><b>{counts.failed}</b> 失败</span>
                <span><b>{activeTerms.length}/{terminals.length}</b> 终端</span>
              </div>

              <label className="scene-editor-label">
                <span className="tiny muted">文字配置</span>
                <textarea
                  className="scene-editor"
                  rows={7}
                  spellCheck={false}
                  value={drafts[project.id] ?? scene?.text ?? ""}
                  onChange={(e) => setDrafts((current) => ({ ...current, [project.id]: e.target.value }))}
                  placeholder={"worktree: auto\nruntime: auto\nagent: <别名>\nconcurrency: 1\nacceptance: ...\nnotes: ..."}
                />
              </label>
              <div className="scene-card-actions">
                <span className="tiny faint">worktree: auto / always / never · runtime: auto / acp / terminal</span>
                <span className="spacer" />
                <button className="btn tiny-btn" disabled={busy === `ai:${project.id}`} onClick={() => void suggest(project.id)}>
                  {busy === `ai:${project.id}` ? "生成中…" : "AI 建议"}
                </button>
                <button className="btn tiny-btn primary" disabled={busy === `save:${project.id}`} onClick={() => void save(project.id)}>
                  {busy === `save:${project.id}` ? "保存中…" : "保存"}
                </button>
              </div>

              <div className="scene-terminal-list">
                <div className="scene-subhead">终端 <em>{terminals.length}</em></div>
                {terminals.slice(0, 5).map((term) => (
                  <div key={term.id} className={`scene-terminal ${term.status}`}>
                    <span className={`dot ${term.status === "running" ? "green" : term.status === "failed" ? "red" : "slate"}`} />
                    <span className="ellipsis" title={term.cwd}>{term.title || term.kind}</span>
                    <span className="mono tiny faint">{TERM_STATUS[term.status] || term.status}{term.exitCode != null ? ` · exit ${term.exitCode}` : ""}</span>
                    <span className="mono tiny faint">{term.endedAt ? `${timeAgo(term.endedAt)} 前` : term.status === "running" ? "实时" : "—"}</span>
                  </div>
                ))}
                {terminals.length === 0 && <div className="tiny faint scene-empty-line">还没有终端记录。</div>}
                {terminals.length > 5 && <div className="tiny faint scene-empty-line">还有 {terminals.length - 5} 个终端…</div>}
              </div>

              {(failures.length > 0 || scene?.updatedAt) && (
                <div className="scene-foot">
                  {scene?.updatedAt ? <span>配置更新于 {timeAgo(scene.updatedAt)} 前</span> : <span>尚未保存配置</span>}
                  {failures.length > 0 && <span className="bad">最近失败：{failures.map((r) => RUN_STATUS[r.status] || r.error || "失败").join(" / ")}</span>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
