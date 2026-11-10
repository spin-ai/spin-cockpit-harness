import { useEffect, useMemo, useState } from "react";
import type { State } from "../types";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { RUN_STATUS, timeAgo } from "../ui";

type Act = (type: string, payload?: unknown) => Promise<any>;

const TERM_STATUS: Record<string, string> = {
  running: "运行中", exited: "已退出", closed: "已关闭", failed: "失败", detached: "已断开",
};

/**
 * 场景：左侧项目列表 + 右侧单个项目的执行配置。
 * 不把所有项目的长配置铺成卡片，避免页面变成一排重复的 textarea。
 */
export function ScenePage({ state, act, notify, onOpenProject, onOpenTerminal }: {
  state: State; act: Act; notify: (message: string) => void;
  onOpenProject: (id: string) => void | Promise<void>;
  onOpenTerminal: (cwd: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(() => state.activeProjectId || state.projects[0]?.id || "");

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const scene of state.scenes || []) {
        if (!(scene.projectId in next)) next[scene.projectId] = scene.text;
      }
      return next;
    });
  }, [state.scenes]);

  useEffect(() => {
    if (state.projects.some((p) => p.id === selectedId)) return;
    setSelectedId(state.activeProjectId || state.projects[0]?.id || "");
  }, [state.projects, selectedId]);

  useEffect(() => {
    if (state.activeProjectId) setSelectedId(state.activeProjectId);
  }, [state.activeProjectId]);

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

  const selected = state.projects.find((p) => p.id === selectedId) || state.projects[0] || null;
  const scene = selected ? (state.scenes || []).find((s) => s.projectId === selected.id) : null;
  const draft = selected ? drafts[selected.id] ?? scene?.text ?? "" : "";
  const dirty = Boolean(selected && scene && draft !== scene.text);
  const counts = selected ? byProject.get(selected.id) || { running: 0, queued: 0, review: 0, failed: 0 } : { running: 0, queued: 0, review: 0, failed: 0 };
  const terminals = selected ? liveTerminals.filter((t) => t.projectId === selected.id) : [];
  const activeTerms = terminals.filter((t) => t.status === "running");
  const failures = selected
    ? state.runs
      .filter((r) => r.status === "failed" && state.todos.find((t) => t.id === r.todoId)?.projectId === selected.id)
      .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
      .slice(0, 4)
    : [];
  const filteredProjects = state.projects.filter((p) => {
    const q = query.trim().toLowerCase();
    return !q || `${p.name} ${p.alias || ""} ${p.path}`.toLowerCase().includes(q);
  });

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
      {state.projects.length === 0 ? (
        <EmptyState compact title="还没有项目" desc="先添加一个本地项目，场景配置会按项目保存。" />
      ) : (
        <div className="scene-layout">
          <aside className="scene-projects">
            <div className="scene-projects-head">
              <span>项目</span>
              <span className="mono tiny faint">{filteredProjects.length}/{state.projects.length}</span>
            </div>
            <input
              className="scene-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索项目 / 别名"
              aria-label="搜索场景项目"
            />
            <div className="scene-project-list">
              {filteredProjects.map((project) => {
                const c = byProject.get(project.id) || { running: 0, queued: 0, review: 0, failed: 0 };
                const terms = liveTerminals.filter((t) => t.projectId === project.id && t.status === "running").length;
                return (
                  <button
                    key={project.id}
                    className={`scene-project ${project.id === selected?.id ? "on" : ""} ${project.id === state.activeProjectId ? "active" : ""}`}
                    data-project-id={project.id}
                    onClick={() => setSelectedId(project.id)}
                    title={`${project.path}\n@${project.alias || "—"}`}
                  >
                    <span className={`project-mark ${project.color}`}>{project.name.slice(0, 1).toUpperCase()}</span>
                    <span className="scene-project-main">
                      <b className="ellipsis">{project.name}</b>
                      <span className="mono tiny faint ellipsis">@{project.alias || "—"}</span>
                    </span>
                    <span className="scene-project-stats">
                      {c.running > 0 && <em className="run">{c.running}</em>}
                      {c.review > 0 && <em className="review">{c.review}</em>}
                      {c.failed > 0 && <em className="fail">{c.failed}</em>}
                      {terms > 0 && <em className="term">{terms}</em>}
                    </span>
                  </button>
                );
              })}
              {filteredProjects.length === 0 && <div className="scene-empty-line">没有匹配的项目</div>}
            </div>
          </aside>

          {selected ? (
            <section className="scene-detail" data-project-id={selected.id}>
              <header className="scene-detail-head">
                <div className="scene-detail-title">
                  <span className={`project-mark ${selected.color}`}>{selected.name.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <div className="row gap6">
                      <b>{selected.name}</b>
                      {selected.id === state.activeProjectId && <span className="tag ok">当前</span>}
                      {dirty && <span className="tag warn">未保存</span>}
                    </div>
                    <span className="mono tiny faint ellipsis" title={`${selected.path}\n@${selected.alias || "—"}`}>@{selected.alias || "—"} · {selected.path}</span>
                  </div>
                </div>
                <div className="row gap4">
                  <button className="btn tiny-btn" onClick={() => void onOpenProject(selected.id)}>切到项目</button>
                  <button className="btn tiny-btn" onClick={() => onOpenTerminal(selected.path)}>开终端</button>
                </div>
              </header>

              <div className="scene-detail-stats">
                <div className={`scene-stat ${counts.running ? "run" : ""}`}><b>{counts.running}</b><span>运行中</span></div>
                <div className={`scene-stat ${counts.queued ? "queue" : ""}`}><b>{counts.queued}</b><span>排队</span></div>
                <div className={`scene-stat ${counts.review ? "review" : ""}`}><b>{counts.review}</b><span>待确认</span></div>
                <div className={`scene-stat ${counts.failed ? "fail" : ""}`}><b>{counts.failed}</b><span>失败</span></div>
                <div className="scene-stat"><b>{activeTerms.length}<i>/{terminals.length}</i></b><span>终端</span></div>
              </div>

              <div className="scene-detail-body">
                <section className="scene-config">
                  <div className="scene-section-head">
                    <div>
                      <b>执行配置</b>
                      <span>下一次派活生效 · worktree / runtime / agent / concurrency / acceptance / notes</span>
                    </div>
                    <div className="row gap4">
                      <button className="btn tiny-btn" disabled={busy === `ai:${selected.id}`} onClick={() => void suggest(selected.id)}>
                        {busy === `ai:${selected.id}` ? "生成中…" : "AI 建议"}
                      </button>
                      <button className="btn tiny-btn primary" disabled={busy === `save:${selected.id}`} onClick={() => void save(selected.id)}>
                        {busy === `save:${selected.id}` ? "保存中…" : "保存"}
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="scene-editor"
                    spellCheck={false}
                    value={draft}
                    onChange={(e) => setDrafts((current) => ({ ...current, [selected.id]: e.target.value }))}
                    placeholder={"worktree: auto\nruntime: auto\nagent: <别名>\nconcurrency: 1\nacceptance: ...\nnotes: ..."}
                  />
                  <div className="scene-config-foot">
                    <span className="mono tiny faint">worktree: auto / always / never</span>
                    <span className="mono tiny faint">runtime: auto / acp / terminal</span>
                    <span className="spacer" />
                    <span className="tiny faint">{scene?.updatedAt ? `更新于 ${timeAgo(scene.updatedAt)} 前` : "尚未保存配置"}</span>
                  </div>
                </section>

                <aside className="scene-side">
                  <section className="scene-side-block">
                    <div className="scene-section-head">
                      <div><b>终端</b><span>{terminals.length} 个记录</span></div>
                      <button className="link tiny" onClick={() => onOpenTerminal(selected.path)}>新建</button>
                    </div>
                    <div className="scene-terminal-list">
                      {terminals.slice(0, 6).map((term) => (
                        <div key={term.id} className={`scene-terminal ${term.status}`}>
                          <span className={`dot ${term.status === "running" ? "green" : term.status === "failed" ? "red" : "slate"}`} />
                          <span className="ellipsis" title={term.cwd}>{term.title || term.kind}</span>
                          <span className="mono tiny faint">{TERM_STATUS[term.status] || term.status}{term.exitCode != null ? ` · exit ${term.exitCode}` : ""}</span>
                          <span className="mono tiny faint">{term.endedAt ? `${timeAgo(term.endedAt)} 前` : term.status === "running" ? "实时" : "—"}</span>
                        </div>
                      ))}
                      {terminals.length === 0 && <div className="tiny faint scene-empty-line">还没有终端记录。</div>}
                      {terminals.length > 6 && <div className="tiny faint scene-empty-line">还有 {terminals.length - 6} 个终端…</div>}
                    </div>
                  </section>

                  <section className="scene-side-block">
                    <div className="scene-section-head">
                      <div><b>最近失败</b><span>{failures.length} 条</span></div>
                    </div>
                    <div className="scene-failures">
                      {failures.map((run) => (
                        <div key={run.id} className="scene-failure">
                          <span className="mono tiny faint">{run.id}</span>
                          <span className="ellipsis" title={run.error || ""}>{run.error || RUN_STATUS[run.status] || "失败"}</span>
                          <span className="mono tiny faint">{run.endedAt ? `${timeAgo(run.endedAt)} 前` : "—"}</span>
                        </div>
                      ))}
                      {failures.length === 0 && <div className="tiny faint scene-empty-line">没有失败记录。</div>}
                    </div>
                  </section>
                </aside>
              </div>
            </section>
          ) : (
            <div className="scene-detail scene-detail-empty"><span>选择左侧项目查看场景配置</span></div>
          )}
        </div>
      )}
    </div>
  );
}
