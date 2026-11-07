import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { State } from "../types";

type Act = (type: string, payload?: unknown) => Promise<any>;
type Commit = { hash: string; subject: string; author: string; when: string };

const STATUS_LABEL: Record<string, string> = { M: "改", A: "增", D: "删", R: "移", C: "复", U: "冲", "?": "新" };

/**
 * Source Control（参考 reference 的 Git 面板）
 * - 顶部：分支 / 上游 / ahead-behind / 拉取·推送
 * - 左侧：暂存区 + 变更 + 未跟踪，底部提交框（⌘Enter 提交）
 * - 右侧：选中文件的 unified diff；下方最近提交
 * 所有 git 操作都在当前项目根目录执行（主进程 `git:*`）。
 */
export function GitView({ state, notify }: { state: State; notify: (m: string) => void }) {
  const root = state.projectPath;
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [busy, setBusy] = useState("");
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [output, setOutput] = useState("");
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const st = await window.harness.gitStatus(root);
      setStatus(st);
      setError("");
      if (st.isRepo) {
        const [log, br] = await Promise.all([window.harness.gitLog(root), window.harness.gitBranches(root)]);
        setCommits(log.commits || []);
        setBranches(br.branches || []);
      } else {
        setCommits([]); setBranches([]);
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => { void refresh(); }, [refresh]);

  const files = status?.files ?? [];
  const staged = files.filter((f) => f.staged);
  const changed = files.filter((f) => !f.staged && !f.untracked);
  const untracked = files.filter((f) => f.untracked);

  // 选中文件 → 拉 diff（暂存区优先）
  useEffect(() => {
    if (!selected || !status?.isRepo) { setDiff(""); return; }
    const file = files.find((f) => f.path === selected);
    let alive = true;
    void window.harness.gitDiff(root, selected, file?.staged ?? false).then((r) => {
      if (alive) setDiff(r.diff || "");
    }).catch((e) => { if (alive) setDiff(`// ${String((e as Error)?.message || e)}`); });
    return () => { alive = false; };
  }, [selected, status, root, files]);

  const stats = useMemo(() => {
    let added = 0; let removed = 0;
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
    }
    return { added, removed };
  }, [diff]);

  const run = async (label: string, fn: () => Promise<{ ok?: boolean; error?: string | null; output?: string } | void>) => {
    setBusy(label);
    setOutput("");
    try {
      const res = await fn();
      if (res && res.ok === false) {
        setOutput(res.error || res.output || "失败");
        notify(`${label} 失败`);
      } else if (res?.output) {
        setOutput(res.output);
      }
      await refresh();
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      setOutput(msg);
      notify(msg);
    } finally {
      setBusy("");
    }
  };

  const stage = (paths: string[]) => run("暂存", () => window.harness.gitStage(root, paths));
  const unstage = (paths: string[]) => run("取消暂存", () => window.harness.gitUnstage(root, paths));
  const discard = (paths: string[]) => {
    if (!window.confirm(`丢弃 ${paths.length} 个文件的改动？不可恢复。`)) return;
    void run("丢弃", () => window.harness.gitDiscard(root, paths));
  };
  const commit = () => {
    if (!staged.length) { notify("先暂存文件"); return; }
    if (!message.trim()) { notify("写个提交信息"); messageRef.current?.focus(); return; }
    void run("提交", async () => {
      const res = await window.harness.gitCommit(root, message);
      if (res.ok) { setMessage(""); notify("已提交"); }
      return res;
    });
  };
  const push = () => run("推送", () => window.harness.gitPush(root));
  const pull = () => run("拉取", () => window.harness.gitPull(root));
  const checkout = (branch: string) => {
    if (!branch || branch === status?.branch) return;
    if ((status?.files?.length ?? 0) > 0 && !window.confirm("工作区有改动，切换分支可能失败或带过去。继续？")) return;
    void run("切换分支", () => window.harness.gitCheckout(root, branch));
  };
  const createBranch = () => {
    const name = window.prompt("新分支名（基于当前 HEAD）");
    if (!name?.trim()) return;
    void run("新建分支", () => window.harness.gitCheckout(root, name.trim(), true));
  };

  // ⌘Enter 提交
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); commit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!status) {
    return <div className="page"><div className="muted small" style={{ padding: 20 }}>{error || "读取 git 状态…"}</div></div>;
  }

  if (!status.isRepo) {
    return (
      <div className="page">
        <div className="page-head"><div><h2>Git</h2><span className="muted">{root}</span></div></div>
        <section className="panel">
          <div className="panel-head">这不是一个 Git 仓库</div>
          <div className="row gap8">
            <button className="btn primary" onClick={() => void run("初始化", () => window.harness.gitInit(root))}>初始化仓库（git init）</button>
            <span className="tiny muted">初始化后可以在这里暂存、提交、推送。</span>
          </div>
        </section>
      </div>
    );
  }

  const FileRow = ({ file }: { file: GitFile }) => {
    const code = file.untracked ? "?" : file.staged ? file.index : file.worktree || file.index;
    const tone = code === "D" ? "red" : code === "?" || code === "A" ? "green" : code === "U" ? "amber" : "brand";
    return (
      <div className={`git-file ${selected === file.path ? "on" : ""}`} onClick={() => setSelected(file.path)}>
        <span className={`git-badge ${tone}`}>{STATUS_LABEL[code] || code || "·"}</span>
        <span className="ellipsis mono tiny" title={file.path}>{file.path}</span>
        <span className="git-file-actions" onClick={(e) => e.stopPropagation()}>
          {file.staged
            ? <button className="link tiny" onClick={() => void unstage([file.path])}>取消暂存</button>
            : <>
                <button className="link tiny" onClick={() => void stage([file.path])}>暂存</button>
                <button className="link tiny danger" onClick={() => discard([file.path])}>丢弃</button>
              </>}
        </span>
      </div>
    );
  };

  return (
    <div className="page git-page">
      <div className="page-head">
        <div><h2>Git</h2><span className="muted">{status.branch || "(detached)"}{status.upstream ? ` → ${status.upstream}` : " · 无上游"}{status.ahead ? ` · ↑${status.ahead}` : ""}{status.behind ? ` · ↓${status.behind}` : ""}</span></div>
        <div className="row gap6">
          <select className="settings-control git-branch-select" value={status.branch || ""} onChange={(e) => checkout(e.target.value)} title="切换分支">
            {!branches.includes(status.branch || "") && <option value={status.branch || ""}>{status.branch || "(detached)"}</option>}
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button className="btn tiny-btn" onClick={createBranch}>＋ 分支</button>
          <button className="btn tiny-btn" disabled={Boolean(busy)} onClick={refresh}>{loading ? "刷新中…" : "刷新"}</button>
          <button className="btn tiny-btn" disabled={Boolean(busy)} onClick={() => void pull()}>拉取{status.behind ? ` ↓${status.behind}` : ""}</button>
          <button className="btn tiny-btn primary" disabled={Boolean(busy)} onClick={() => void push()}>推送{status.ahead ? ` ↑${status.ahead}` : ""}</button>
        </div>
      </div>

      {(output || error) && <pre className="git-output">{output || error}</pre>}

      <div className="git-grid">
        <div className="git-side">
          <section className="panel">
            <div className="panel-head">
              暂存的改动 <span className="tiny muted">{staged.length}</span>
              {staged.length === 0 && changed.length + untracked.length > 0 && (
                <button className="link tiny" onClick={() => void stage([...changed, ...untracked].map((f) => f.path))}>全部暂存</button>
              )}
            </div>
            {staged.map((f) => <FileRow key={`s-${f.path}`} file={f} />)}
            {staged.length === 0 && <div className="git-empty">还没有暂存的文件</div>}

            <div className="panel-head" style={{ marginTop: 10 }}>
              变更 <span className="tiny muted">{changed.length + untracked.length}</span>
            </div>
            {[...changed, ...untracked].map((f) => <FileRow key={`c-${f.path}`} file={f} />)}
            {changed.length + untracked.length === 0 && <div className="git-empty">工作区干净</div>}
          </section>

          <section className="panel">
            <div className="panel-head">提交</div>
            <textarea
              ref={messageRef}
              className="git-commit-msg"
              rows={3}
              value={message}
              placeholder="提交信息（⌘Enter 提交）"
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="row gap6" style={{ justifyContent: "flex-end", marginTop: 6 }}>
              <button className="btn tiny-btn" disabled={!staged.length || Boolean(busy)} onClick={() => {
                if (!window.confirm("用 --amend 改写上一条提交？")) return;
                void run("Amend", () => window.harness.gitCommit(root, message || "amend", true));
              }}>Amend</button>
              <button className="btn tiny-btn primary" disabled={!staged.length || Boolean(busy)} onClick={commit}>
                {busy === "提交" ? "提交中…" : `提交 ${staged.length} 个文件`}
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">最近提交 <span className="tiny muted">{commits.length}</span></div>
            {commits.map((c) => (
              <div className="git-commit-row" key={c.hash} title={`${c.author} · ${c.when}`}>
                <span className="mono tiny faint">{c.hash}</span>
                <span className="ellipsis">{c.subject}</span>
                <span className="tiny muted">{c.when}</span>
              </div>
            ))}
            {commits.length === 0 && <div className="git-empty">还没有提交</div>}
          </section>
        </div>

        <section className="panel git-diff-panel">
          <div className="panel-head">
            {selected ? <span className="mono tiny ellipsis" title={selected}>{selected}</span> : <span>Diff</span>}
            <span className="row gap8 tiny">
              {selected && <span className="git-diff-stat"><b className="green">+{stats.added}</b> <b className="red">-{stats.removed}</b></span>}
            </span>
          </div>
          {selected
            ? diff
              ? <pre className="git-diff">{diff.split("\n").map((line, i) => {
                  const cls = line.startsWith("+++") || line.startsWith("---") ? "meta"
                    : line.startsWith("@@") ? "hunk"
                      : line.startsWith("+") ? "add"
                        : line.startsWith("-") ? "del"
                          : "ctx";
                  return <span className={`git-diff-line ${cls}`} key={i}>{line || " "}</span>;
                })}</pre>
              : <div className="git-empty">没有可显示的 diff（可能是二进制或未改动）</div>
            : <div className="git-empty">选一个文件看 diff</div>}
        </section>
      </div>
    </div>
  );
}
