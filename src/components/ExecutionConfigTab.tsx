import { useEffect, useMemo, useState } from "react";
import type { State } from "../types";
import { templateLabel } from "../office/templates";

type Act = (type: string, payload?: unknown) => Promise<any>;

export function ExecutionConfigTab({ state, act, notify, onOpenScene }: {
  state: State;
  act: Act;
  notify: (message: string) => void;
  onOpenScene: (sceneId: string) => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(state.activeProjectId ?? state.projects[0]?.id ?? null);
  const project = state.projects.find((p) => p.id === projectId) ?? null;
  const scene = (state.scenes ?? []).find((s) => s.projectId === projectId) ?? null;
  const [draft, setDraft] = useState(scene?.text ?? "");
  const [busy, setBusy] = useState<"save" | "suggest" | null>(null);

  useEffect(() => {
    if (!state.projects.some((p) => p.id === projectId)) setProjectId(state.activeProjectId ?? state.projects[0]?.id ?? null);
  }, [projectId, state.activeProjectId, state.projects]);

  useEffect(() => {
    setDraft(scene?.text ?? "");
  }, [projectId, scene?.text]);

  const refs = useMemo(() => (state.coordinationScenes ?? []).filter((s) => (s.projectId || null) === (projectId || null)), [state.coordinationScenes, projectId]);

  const save = async () => {
    if (!project) return;
    setBusy("save");
    try {
      const result = await act("saveScene", { projectId: project.id, text: draft });
      if (result) notify("执行配置已保存，下一次派活生效");
    } finally { setBusy(null); }
  };
  const suggest = async () => {
    if (!project) return;
    setBusy("suggest");
    try {
      const result = await act("sceneSuggestion", { projectId: project.id });
      if (result) setDraft(String(result));
    } finally { setBusy(null); }
  };

  return (
    <div className="off-prof">
      <aside className="off-prof-projects">
        <div className="off-prof-label">项目 <span>{state.projects.length}</span></div>
        {state.projects.map((p) => (
          <button key={p.id} className={`off-prof-project ${p.id === projectId ? "on" : ""}`} onClick={() => setProjectId(p.id)}>
            <span className="off-prof-mark">{p.name.slice(0, 1).toUpperCase()}</span>
            <span><b>{p.name}</b><em title={p.path}>{p.path}</em></span>
          </button>
        ))}
      </aside>

      <section className="off-prof-editor">
        <div className="off-prof-head">
          <div><b>执行配置 · {project?.name || "未选择项目"}</b><p>每个项目一份。决定单个任务怎么跑，不参与办公室舞台的呈现。</p></div>
          <span className={`tag ${scene?.text?.trim() ? "ok" : ""}`}>{scene?.text?.trim() ? "已配置" : "未配置"}</span>
        </div>
        <textarea
          className="off-prof-text"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"worktree: auto\nruntime: acp\nagent: <别名>\nconcurrency: 2\nacceptance: npm run build && npm run typecheck\nnotes: ..."}
        />
        <div className="off-prof-foot">
          <span>{draft.trim() ? `${draft.length} 字符 · 下一次派活生效` : "未配置"}</span>
          <div className="row gap6">
            <button className="btn tiny" onClick={() => void suggest()} disabled={Boolean(busy)}>{busy === "suggest" ? "生成中…" : "AI 建议"}</button>
            <button className="btn tiny primary" onClick={() => void save()} disabled={Boolean(busy)}>{busy === "save" ? "保存中…" : "保存"}</button>
          </div>
        </div>
      </section>

      <aside className="off-prof-side">
        <div className="off-prof-block">
          <div className="off-prof-label">它和协作场景的关系</div>
          <p><b>执行配置</b>是低颗粒度的机器策略：worktree、runtime、并发、验收命令。</p>
          <p><b>协作场景</b>是高层的人力与舞台配置：谁和谁、坐哪、怎么协作、怎么呈现。</p>
          <div className="off-prof-callout"><b>场景引用它，不复制它</b><span>研发小队 · 办公室 → 默认执行配置 <code>{project?.alias || project?.name || "project"}#acp</code></span></div>
        </div>
        <div className="off-prof-block">
          <div className="off-prof-label">当前引用</div>
          {refs.length ? refs.map((s) => (
            <button key={s.id} className="off-prof-ref" onClick={() => onOpenScene(s.id)}>
              <i /><span>{s.name} · {templateLabel(s.template)}</span>
            </button>
          )) : <p className="off-prof-empty">还没有协作场景引用这份执行配置。</p>}
          <p style={{ marginTop: 7 }}>修改这里不会改变已有 run；下一次从场景派活时生效。</p>
        </div>
      </aside>
    </div>
  );
}
