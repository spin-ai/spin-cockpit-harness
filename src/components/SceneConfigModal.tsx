import { useEffect, useState } from "react";
import type { Project } from "../types";

type Act = (type: string, payload?: unknown) => Promise<any>;

/**
 * 项目执行配置的单一编辑入口。
 * Projects / 执行配置总览都打开同一个弹窗，避免场景页和项目页各维护一套 textarea。
 */
export function SceneConfigModal({ project, text, act, notify, onClose }: {
  project: Project;
  text: string;
  act: Act;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState<"save" | "suggest" | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const save = async () => {
    setBusy("save");
    try {
      const res = await act("saveScene", { projectId: project.id, text: draft });
      if (res) { notify("执行配置已保存，下一次派活生效"); onClose(); }
    } finally { setBusy(null); }
  };

  const suggest = async () => {
    setBusy("suggest");
    try {
      const result = await act("sceneSuggestion", { projectId: project.id });
      if (result) setDraft(String(result));
    } finally { setBusy(null); }
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal scene-modal" role="dialog" aria-modal="true" aria-label={`执行配置 · ${project.name}`}>
        <div className="scene-modal-head">
          <div>
            <h3>执行配置 · {project.name}</h3>
            <p className="tiny muted">每个项目一份；Chat 派活时按这里推荐项目 / Agent / 执行方式。</p>
          </div>
          <span className="tag mono">@{project.alias}</span>
        </div>
        <textarea
          className="scene-editor"
          autoFocus
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"worktree: auto\nruntime: auto\nagent: <别名>\nconcurrency: 1\nacceptance: ...\nnotes: ..."}
        />
        <div className="scene-modal-foot">
          <button className="btn tiny-btn" onClick={() => void suggest()} disabled={Boolean(busy)}>{busy === "suggest" ? "生成中…" : "AI 建议"}</button>
          <span className="tiny faint">{draft.trim() ? `${draft.length} 字符` : "未配置"}</span>
          <div className="row gap6">
            <button className="btn tiny-btn" onClick={onClose} disabled={Boolean(busy)}>取消</button>
            <button className="btn tiny-btn primary" onClick={() => void save()} disabled={Boolean(busy)}>{busy === "save" ? "保存中…" : "保存"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
