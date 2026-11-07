import { useCallback, useEffect, useState } from "react";
import type { State } from "../types";

type Act = (type: string, payload?: unknown) => Promise<any>;

const STATUS_LABEL: Record<string, string> = { M: "改", A: "增", D: "删", R: "移", C: "复", U: "冲", "?": "新" };

/**
 * 右侧栏的 Git 迷你面板（和资源管理器 / 会话历史并列）。
 * 只放日常动作：分支、ahead/behind、暂存、提交、推送/拉取；diff 看大图去 Git 页。
 */
export function GitPanel({ state, notify }: { state: State; notify: (m: string) => void }) {
  const root = state.projectPath;
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ staged: true, changes: true });

  const refresh = useCallback(async () => {
    try {
      const st = await window.harness.gitStatus(root);
      setStatus(st);
      setError("");
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  }, [root]);

  useEffect(() => { void refresh(); }, [refresh]);
  // 切回窗口 / 换项目时刷新（写文件后回来能看到变化）
  useEffect(() => {
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<{ ok?: boolean; error?: string | null; output?: string } | void>) => {
    setBusy(label);
    try {
      const res = await fn();
      if (res && res.ok === false) { setError(res.error || res.output || "失败"); notify(`${label} 失败`); }
      await refresh();
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      setError(msg);
      notify(msg);
    } finally {
      setBusy("");
    }
  };

  const files = status?.files ?? [];
  const staged = files.filter((f) => f.staged);
  const changed = files.filter((f) => !f.staged);

  if (!status) return <div className="git-mini-empty">{error || "读取 git 状态…"}</div>;

  if (!status.isRepo) {
    return (
      <div className="git-mini-empty">
        <div>当前项目不是 Git 仓库</div>
        <button className="btn tiny-btn" onClick={() => void run("初始化", () => window.harness.gitInit(root))}>初始化仓库</button>
      </div>
    );
  }

  const Row = ({ file }: { file: GitFile }) => {
    const code = file.untracked ? "?" : file.staged ? file.index : file.worktree || file.index;
    const tone = code === "D" ? "red" : code === "?" || code === "A" ? "green" : code === "U" ? "amber" : "brand";
    return (
      <div className="git-mini-file" title={file.path}>
        <span className={`git-badge ${tone}`}>{STATUS_LABEL[code] || code || "·"}</span>
        <span className="ellipsis mono tiny">{file.path}</span>
        <button
          className="link tiny"
          onClick={() => void (file.staged ? run("取消暂存", () => window.harness.gitUnstage(root, [file.path])) : run("暂存", () => window.harness.gitStage(root, [file.path])))}
        >{file.staged ? "－" : "＋"}</button>
      </div>
    );
  };

  return (
    <div className="git-mini">
      <div className="git-mini-head">
        <span className="mono tiny ellipsis" title={status.upstream || ""}>{status.branch || "(detached)"}</span>
        <span className="row gap6">
          {status.ahead ? <span className="tiny faint">↑{status.ahead}</span> : null}
          {status.behind ? <span className="tiny faint">↓{status.behind}</span> : null}
          <button className="link tiny" onClick={() => void refresh()} title="刷新">刷新</button>
          <button className="link tiny" onClick={() => window.dispatchEvent(new Event("harness:open-git"))} title="打开 Git 页看 diff">全屏</button>
        </span>
      </div>

      {error && <div className="tiny red git-mini-error">{error.slice(0, 200)}</div>}

      <div className="git-mini-scroll">
        <button className="git-mini-group" onClick={() => setOpen((o) => ({ ...o, staged: !o.staged }))}>
          暂存的改动 <em>{staged.length}</em>
        </button>
        {open.staged && staged.map((f) => <Row key={`s-${f.path}`} file={f} />)}
        {open.staged && staged.length === 0 && <div className="git-mini-none">暂无</div>}

        <button className="git-mini-group" onClick={() => setOpen((o) => ({ ...o, changes: !o.changes }))}>
          变更 <em>{changed.length}</em>
          {changed.length > 0 && (
            <span className="link tiny" style={{ marginLeft: "auto" }} onClick={(e) => { e.stopPropagation(); void run("暂存全部", () => window.harness.gitStage(root, changed.map((f) => f.path))); }}>全部暂存</span>
          )}
        </button>
        {open.changes && changed.map((f) => <Row key={`c-${f.path}`} file={f} />)}
        {open.changes && changed.length === 0 && <div className="git-mini-none">工作区干净</div>}
      </div>

      <textarea
        className="git-mini-msg"
        rows={2}
        value={message}
        placeholder="提交信息（⌘Enter）"
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (!staged.length) { notify("先暂存文件"); return; }
            if (!message.trim()) { notify("写个提交信息"); return; }
            void run("提交", async () => {
              const res = await window.harness.gitCommit(root, message);
              if (res.ok) { setMessage(""); notify("已提交"); }
              return res;
            });
          }
        }}
      />
      <div className="row gap6" style={{ justifyContent: "space-between", padding: "0 2px 6px" }}>
        <button className="link tiny" disabled={Boolean(busy)} onClick={() => void run("拉取", () => window.harness.gitPull(root))}>拉取</button>
        <button className="link tiny" disabled={Boolean(busy)} onClick={() => void run("推送", () => window.harness.gitPush(root))}>推送</button>
        <button
          className="btn tiny-btn primary"
          disabled={!staged.length || Boolean(busy)}
          onClick={() => {
            if (!message.trim()) { notify("写个提交信息"); return; }
            void run("提交", async () => {
              const res = await window.harness.gitCommit(root, message);
              if (res.ok) { setMessage(""); notify("已提交"); }
              return res;
            });
          }}
        >{busy === "提交" ? "提交中…" : `提交 ${staged.length || ""}`.trim()}</button>
      </div>
    </div>
  );
}
