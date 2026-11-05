import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Message, Run, State, Thread, Todo } from "../types";
import { agentOf, timeAgo } from "../ui";
import {
  BotIcon, ChevronDownIcon, ChevronRightIcon, CollapseIcon, EyeIcon, EyeOffIcon,
  FileCodeIcon, FileIcon, FileImageIcon, FileTextIcon, FilesIcon, FolderIcon,
  FolderOpenIcon, HistoryIcon, InfoIcon, PanelCollapseIcon, RefreshIcon, SearchIcon, UserIcon, WrenchIcon, XIcon,
} from "./Icons";

type Entry = { name: string; dir: boolean; path: string };
type Preview = { name: string; rel: string; text?: string; dataUrl?: string; error?: string };
type Tab = "explorer" | "sessions" | "preview";
type SessionStatus = { label: string; cls: string };

type SessionView = {
  thread: Thread;
  messages: Message[];
  last: Message | null;
  todo: Todo | null;
  agent: Agent | null;
  updatedAt: number;
  title: string;
  status: SessionStatus;
};

const EXT_COLORS: Record<string, string> = {
  ts: "#3178c6", tsx: "#3178c6", js: "#ca8a04", jsx: "#0284c7",
  json: "#b45309", md: "#64748b", mdx: "#64748b", css: "#2563eb", scss: "#db2777",
  html: "#ea580c", vue: "#059669", svelte: "#ea580c", py: "#2563eb", go: "#0891b2",
  rs: "#b45309", sh: "#16a34a", yml: "#7c3aed", yaml: "#7c3aed",
  png: "#7c3aed", jpg: "#7c3aed", jpeg: "#7c3aed", webp: "#7c3aed", gif: "#7c3aed", svg: "#7c3aed",
  lock: "#71717a",
};

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "ico", "bmp"]);
const CODE_EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "sh", "bash", "css", "scss", "html", "vue", "svelte", "json", "yml", "yaml", "toml"]);
const TEXT_EXT = new Set(["md", "mdx", "txt", "log", "csv"]);

function extOf(name: string) {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

function FileVisual({ name }: { name: string }) {
  const ext = extOf(name);
  const color = EXT_COLORS[ext] ?? "#a1a1aa";
  if (IMAGE_EXT.has(ext)) return <FileImageIcon size={14} className="file-ico" style={{ color }} />;
  if (CODE_EXT.has(ext)) return <FileCodeIcon size={14} className="file-ico" style={{ color }} />;
  if (TEXT_EXT.has(ext)) return <FileTextIcon size={14} className="file-ico" style={{ color }} />;
  return <FileIcon size={14} className="file-ico" style={{ color }} />;
}

function RoleGlyph({ role }: { role: string }) {
  if (role === "user") return <UserIcon size={11} />;
  if (role === "agent") return <BotIcon size={11} />;
  if (role === "tool") return <WrenchIcon size={11} />;
  return <InfoIcon size={11} />;
}

function messageRole(m: Message, agentName?: string) {
  if (m.role === "user") return "你";
  if (m.role === "agent") return agentName || "Agent";
  if (m.role === "tool") return "工具";
  return "系统";
}

function sessionStatus(todo: Todo | null, active: Run | undefined, last: Run | undefined): SessionStatus {
  if (active) {
    if (active.status === "queued") return { label: "排队", cls: "queued" };
    if (active.status === "waiting_input") return { label: "等待输入", cls: "waiting" };
    return { label: "运行中", cls: "running" };
  }
  if (last?.status === "failed") return { label: "失败", cls: "failed" };
  if (!todo) return { label: "未派活", cls: "idle" };
  if (todo.confirmed) return { label: "已确认", cls: "done" };
  if (todo.status === "in_review") return { label: "待确认", cls: "review" };
  if (todo.status === "cancelled") return { label: "已取消", cls: "idle" };
  return { label: "待执行", cls: "todo" };
}

function dayStart(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 右侧栏：ORCA 风格的资源管理器 + 智能体会话历史 + 文件预览。
 * - 资源管理器：可展开的树、名称筛选、刷新、折叠全部
 * - 会话历史：按时间分组，点击回到对应 Chat 会话
 * - 预览：点击文件后出现，可关闭
 */
export function FilePanel({ state, root, now, onSelectThread, onCollapse }: {
  state: State;
  root?: string;
  now: number;
  onSelectThread?: (threadId: string) => void;
  onCollapse?: () => void;
}) {
  const base = root || state.projectPath;
  const baseRef = useRef(base);
  baseRef.current = base;

  const [tab, setTab] = useState<Tab>("explorer");
  const [preview, setPreview] = useState<Preview | null>(null);

  // explorer
  const [children, setChildren] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // sessions
  const [sessionQuery, setSessionQuery] = useState("");
  const [openSessions, setOpenSessions] = useState<Set<string>>(() => new Set());

  const loadDir = useCallback(async (rel: string) => {
    setLoading((prev) => new Set(prev).add(rel));
    try {
      const res = await window.harness.filesList(rel, base);
      if (baseRef.current !== base) return;
      setChildren((prev) => ({ ...prev, [rel]: res.entries }));
      setError("");
    } catch (e) {
      if (baseRef.current === base) setError(String((e as Error)?.message || e));
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(rel);
        return next;
      });
    }
  }, [base]);

  useEffect(() => {
    setChildren({});
    setExpanded(new Set([""]));
    setPreview(null);
    setError("");
    setQuery("");
    void loadDir("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const toggleDir = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!children[path]) void loadDir(path);
  };

  const refresh = async () => {
    setRefreshing(true);
    setChildren({});
    const paths = ["", ...[...expanded].filter(Boolean)];
    await Promise.all(paths.map((p) => loadDir(p)));
    setRefreshing(false);
  };

  const collapseAll = () => setExpanded(new Set([""]));

  const openFile = async (entry: Entry) => {
    setPreview({ name: entry.name, rel: entry.path, text: "加载中…" });
    setTab("preview");
    try {
      const res = await window.harness.filesRead(entry.path, base);
      if (baseRef.current !== base) return;
      setPreview({ name: entry.name, rel: entry.path, ...res });
    } catch (e) {
      setPreview({ name: entry.name, rel: entry.path, error: String((e as Error)?.message || e) });
    }
  };

  const closePreview = () => {
    setPreview(null);
    setTab("explorer");
  };

  const q = query.trim().toLowerCase();
  const matchesBelow = useCallback((rel: string): boolean => {
    if (!q) return false;
    return (children[rel] ?? []).some((entry) =>
      entry.name.toLowerCase().includes(q) || (entry.dir && matchesBelow(entry.path)),
    );
  }, [children, q]);

  const visibleEntries = useCallback((rel: string) => {
    const list = (children[rel] ?? []).filter((e) => showHidden || !e.name.startsWith("."));
    if (!q) return list;
    return list.filter((e) => e.name.toLowerCase().includes(q) || (e.dir && matchesBelow(e.path)));
  }, [children, q, showHidden, matchesBelow]);

  const renderDir = (rel: string, depth: number): React.ReactNode => {
    if (loading.has(rel && rel !== "" ? rel : "")) {
      return <div className="tree-status" style={{ paddingLeft: 10 + depth * 14 }}>加载中…</div>;
    }
    const list = visibleEntries(rel);
    if (!list.length) {
      return rel === "" ? <div className="tree-status" style={{ paddingLeft: 10 }}>{q ? "没有匹配的文件" : "目录为空"}</div> : null;
    }
    return list.map((entry) => {
      const open = expanded.has(entry.path) || (q && matchesBelow(entry.path));
      const selected = preview?.rel === entry.path;
      return (
        <div key={entry.path}>
          <div
            className={`tree-row ${selected ? "on" : ""}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            role="button"
            tabIndex={0}
            title={entry.path}
            onClick={() => { if (entry.dir) toggleDir(entry.path); else void openFile(entry); }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              if (entry.dir) toggleDir(entry.path); else void openFile(entry);
            }}
          >
            {entry.dir ? (
              <>
                <span className={`tree-chev ${open ? "open" : ""}`}><ChevronRightIcon size={11} /></span>
                {open ? <FolderOpenIcon size={14} className="tree-folder" /> : <FolderIcon size={14} className="tree-folder" />}
              </>
            ) : (
              <FileVisual name={entry.name} />
            )}
            <span className="ellipsis">{entry.name}</span>
          </div>
          {entry.dir && open && renderDir(entry.path, depth + 1)}
        </div>
      );
    });
  };

  const sessions = useMemo<SessionView[]>(() => {
    const q = sessionQuery.trim().toLowerCase();
    return state.threads
      .map((thread) => {
        const messages = state.messages.filter((m) => m.threadId === thread.id);
        const last = [...messages].reverse().find((m) => m.content?.trim()) ?? null;
        const todo = thread.todoId ? state.todos.find((t) => t.id === thread.todoId) ?? null : null;
        const runs = todo ? state.runs.filter((r) => r.todoId === todo.id) : [];
        const active = runs.find((r) => ["queued", "running", "waiting_input"].includes(r.status));
        const lastRun = runs.length ? runs[runs.length - 1] : undefined;
        const agent = agentOf(state.agents, thread.agentId || todo?.agentId || null);
        const updatedAt = Math.max(
          thread.updatedAt || 0,
          thread.createdAt || 0,
          last?.createdAt || 0,
          lastRun?.endedAt || lastRun?.startedAt || 0,
        );
        const title = thread.title?.trim()
          || (last?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60)
          || "新会话";
        return { thread, messages, last, todo, agent, updatedAt, title, status: sessionStatus(todo, active, lastRun) };
      })
      .filter((s) => !q
        || s.title.toLowerCase().includes(q)
        || (s.last?.content ?? "").toLowerCase().includes(q)
        || (s.agent?.name ?? "").toLowerCase().includes(q)
        || (s.thread.project ?? "").toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [state.threads, state.messages, state.todos, state.runs, state.agents, sessionQuery]);

  const sessionGroups = useMemo(() => {
    const today = dayStart(now);
    const yesterday = today - 24 * 60 * 60 * 1000;
    const groups: { id: string; label: string; items: SessionView[] }[] = [
      { id: "today", label: "今天", items: [] },
      { id: "yesterday", label: "昨天", items: [] },
      { id: "earlier", label: "更早", items: [] },
    ];
    for (const s of sessions) {
      const day = dayStart(s.updatedAt || now);
      const group = day >= today ? groups[0] : day >= yesterday ? groups[1] : groups[2];
      group.items.push(s);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [sessions, now]);

  const toggleSession = (id: string) => {
    setOpenSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rootName = base.split("/").filter(Boolean).slice(-1)[0] || base;

  return (
    <aside className="files-pane right-panel">
      <div className="right-tabs">
        <button
          className={`icon-tab ${tab === "explorer" ? "on" : ""}`}
          title="资源管理器"
          aria-label="资源管理器"
          onClick={() => setTab("explorer")}
        >
          <FilesIcon size={16} />
        </button>
        <button
          className={`icon-tab ${tab === "sessions" ? "on" : ""}`}
          title={`会话历史（${state.threads.length}）`}
          aria-label={`会话历史（${state.threads.length}）`}
          onClick={() => setTab("sessions")}
        >
          <HistoryIcon size={16} />
          {state.threads.length > 0 && <span className="tab-count">{state.threads.length}</span>}
        </button>
        {preview && (
          <button
            className={`icon-tab ${tab === "preview" ? "on" : ""}`}
            title="预览"
            aria-label="预览"
            onClick={() => setTab("preview")}
          >
            <EyeIcon size={16} />
          </button>
        )}
        {onCollapse && (
          <button
            className="icon-tab tab-collapse"
            title="收起右侧栏"
            aria-label="收起右侧栏"
            onClick={onCollapse}
          >
            <PanelCollapseIcon size={15} />
          </button>
        )}
      </div>

      <div className="right-panel-body">
        {tab === "explorer" && (
          <>
            <div className="explorer-bar">
              <div className="explorer-title" title={base}>
                <FolderOpenIcon size={13} className="root-ico" />
                <span className="ellipsis">{rootName}</span>
                {base !== state.projectPath && <span className="worktree-tag">worktree</span>}
              </div>
              <div className="explorer-actions">
                <button className="icon-btn" title={showHidden ? "隐藏点文件" : "显示点文件"} aria-label={showHidden ? "隐藏点文件" : "显示点文件"} onClick={() => setShowHidden((v) => !v)}>
                  {showHidden ? <EyeIcon size={13} /> : <EyeOffIcon size={13} />}
                </button>
                <button className="icon-btn" title="全部折叠" aria-label="全部折叠" onClick={collapseAll}><CollapseIcon size={13} /></button>
                <button className="icon-btn" title="刷新" aria-label="刷新" onClick={() => void refresh()}>
                  <RefreshIcon size={13} className={refreshing ? "spinning" : ""} />
                </button>
              </div>
            </div>
            <div className="explorer-search">
              <SearchIcon size={12} className="search-ico" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="按名称筛选文件…" />
              {query && <button className="icon-btn" title="清除" aria-label="清除" onClick={() => setQuery("")}><XIcon size={11} /></button>}
            </div>
            {error && <div className="preview-error tree-error">{error}</div>}
            <div className="explorer-tree">{renderDir("", 0)}</div>
          </>
        )}

        {tab === "sessions" && (
          <>
            <div className="explorer-bar">
              <div className="explorer-title">
                <BotIcon size={13} className="root-ico" />
                <span>智能体会话</span>
                <span className="muted tiny">{sessions.length}</span>
              </div>
            </div>
            <div className="explorer-search">
              <SearchIcon size={12} className="search-ico" />
              <input value={sessionQuery} onChange={(e) => setSessionQuery(e.target.value)} placeholder="搜索标题 / 消息 / Agent…" />
              {sessionQuery && <button className="icon-btn" title="清除" aria-label="清除" onClick={() => setSessionQuery("")}><XIcon size={11} /></button>}
            </div>
            <div className="session-list">
              {sessionGroups.map((group) => (
                <section key={group.id} className="session-group">
                  <div className="session-group-head">{group.label}<span>{group.items.length}</span></div>
                  {group.items.map((s) => {
                    const open = openSessions.has(s.thread.id);
                    const previewText = s.last?.content.replace(/\s+/g, " ").trim() ?? "";
                    return (
                      <div
                        key={s.thread.id}
                        className={`session-row ${open ? "open" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectThread?.(s.thread.id)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          onSelectThread?.(s.thread.id);
                        }}
                      >
                        <div className="session-top">
                          <span className="session-title ellipsis">{s.title}</span>
                          <span className={`sh-status ${s.status.cls}`}>{s.status.label}</span>
                        </div>
                        <div className="session-meta">
                          {s.agent && <><BotIcon size={11} className={`agent-ico ${s.agent.color}`} /><span className="ellipsis">{s.agent.name}</span></>}
                          {s.thread.project && <span className="ellipsis session-project">· {s.thread.project}</span>}
                          <span>· {s.messages.length} 条</span>
                          <span className="session-time">{timeAgo(s.updatedAt, now)}前</span>
                        </div>
                        {previewText && (
                          <div className="session-preview">
                            <b>{s.last ? messageRole(s.last, s.agent?.name) : ""}</b>
                            <span className="ellipsis">{previewText.slice(0, 140)}</span>
                          </div>
                        )}
                        <div className="session-foot">
                          <button
                            className="link row gap4"
                            onClick={(e) => { e.stopPropagation(); toggleSession(s.thread.id); }}
                          >
                            <ChevronDownIcon size={11} className={open ? "rot-180" : ""} />
                            {open ? "收起" : "详情"}
                          </button>
                          {!s.thread.todoId && <span className="tiny faint">还没有派活</span>}
                        </div>
                        {open && (
                          <div className="session-detail">
                            {s.messages.slice(-5).map((m) => (
                              <div className="session-detail-row" key={m.id}>
                                <div className="session-detail-meta">
                                  <b className="row gap4"><span className="role-ico"><RoleGlyph role={m.role} /></span>{messageRole(m, s.agent?.name)}</b>
                                  <span>{timeAgo(m.createdAt, now)}前</span>
                                </div>
                                <div className="session-detail-text">{m.content}</div>
                              </div>
                            ))}
                            {s.messages.length === 0 && <div className="tiny faint">没有消息</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              ))}
              {sessions.length === 0 && <div className="pane-empty">{sessionQuery ? "没有匹配的会话" : "还没有会话"}</div>}
            </div>
          </>
        )}

        {tab === "preview" && preview && (
          <div className="file-preview preview-tab">
            <div className="row between preview-head">
              <div className="stack" style={{ gap: 0, minWidth: 0 }}>
                <div className="row gap4" style={{ minWidth: 0 }}>
                  <FileVisual name={preview.name} />
                  <b className="tiny ellipsis">{preview.name}</b>
                </div>
                <span className="tiny muted mono ellipsis">{preview.rel}</span>
              </div>
              <button className="icon-btn" title="关闭预览" aria-label="关闭预览" onClick={closePreview}><XIcon size={13} /></button>
            </div>
            {preview.error && <div className="preview-error">{preview.error}</div>}
            {preview.dataUrl && <img src={preview.dataUrl} alt={preview.name} className="preview-img" />}
            {preview.text != null && <pre className="preview-text">{preview.text}</pre>}
          </div>
        )}
      </div>
    </aside>
  );
}
