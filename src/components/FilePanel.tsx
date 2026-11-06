import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Message, Run, State, Thread, Todo } from "../types";
import { agentOf, timeAgo } from "../ui";
import {
  BotIcon, ChevronDownIcon, ChevronRightIcon, CollapseIcon, CopyIcon, EyeIcon, EyeOffIcon,
  FileIcon, FilePlusIcon, FilesIcon, FolderIcon,
  FolderOpenIcon, FolderPlusIcon, HistoryIcon, InfoIcon, PanelCollapseIcon, RefreshIcon, RevealIcon,
  SearchIcon, UserIcon, WrenchIcon, XIcon,
} from "./Icons";
import { FileVisual } from "./FileVisual";
import { requestFilePreview, requestTerminalAt } from "../terminal-events";

type Entry = { name: string; dir: boolean; path: string };
type Tab = "explorer" | "sessions";
type SessionStatus = { label: string; cls: string };
type FsMenuPoint = { x: number; y: number; entry: Entry | null; dir: string };
type FsMenuItem = { label: string; hint?: string; danger?: boolean; disabled?: boolean; run: () => void } | "sep";

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
 * 右侧栏：reference 风格的资源管理器 + 智能体会话历史 + 文件预览。
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

  // explorer
  const [children, setChildren] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activePath, setActivePath] = useState("");
  const [activeDir, setActiveDir] = useState("");
  const [menu, setMenu] = useState<FsMenuPoint | null>(null);
  const [creating, setCreating] = useState<{ dir: string; kind: "file" | "folder" } | null>(null);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<{ rel: string; name: string; dir: boolean } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const creatingRef = useRef(false);
  const renameRef = useRef(false);
  const createCancelled = useRef(false);
  const renameCancelled = useRef(false);

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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setChildren({});
    const paths = ["", ...[...expanded].filter(Boolean)];
    await Promise.all(paths.map((p) => loadDir(p)));
    setRefreshing(false);
  }, [expanded, loadDir]);

  const collapseAll = () => setExpanded(new Set([""]));

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const onFocus = () => {
      if (tab !== "explorer" || creating || renaming || menu) return;
      if (document.visibilityState !== "visible") return;
      void refreshRef.current();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [tab, creating, renaming, menu]);

  const parentOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
  const joinPath = (dir: string, name: string) => [dir, name].filter(Boolean).join("/");
  const absOf = (rel: string) => `${base.replace(/[\\/]+$/, "")}/${rel || ""}`.replace(/\/+/g, "/");
  const errText = (e: unknown) => String((e as Error)?.message || e);

  const startCreate = (dir: string, kind: "file" | "folder") => {
    setMenu(null);
    setRenaming(null);
    createCancelled.current = false;
    if (dir) setExpanded((prev) => new Set(prev).add(dir));
    if (dir && !children[dir]) void loadDir(dir);
    setDraft("");
    setCreating({ dir, kind });
  };

  const cancelCreate = () => { createCancelled.current = true; setCreating(null); setDraft(""); };

  const commitCreate = async () => {
    if (!creating || creatingRef.current) return;
    const name = draft.trim();
    if (!name) { cancelCreate(); return; }
    creatingRef.current = true;
    try {
      const res = await window.harness.filesCreate(creating.dir, creating.kind, name, base);
      if (baseRef.current !== base) return;
      setError("");
      setCreating(null);
      setDraft("");
      setActivePath(res.path);
      setActiveDir(creating.kind === "folder" ? res.path : creating.dir);
      setExpanded((prev) => new Set(prev).add(creating.dir));
      await loadDir(creating.dir);
      if (creating.kind === "file") openPreviewInTerminal({ name: res.name, dir: false, path: res.path });
    } catch (e) {
      setError(errText(e));
    } finally {
      creatingRef.current = false;
    }
  };

  const startRename = (entry: Entry) => {
    setMenu(null);
    setCreating(null);
    renameCancelled.current = false;
    setRenaming({ rel: entry.path, name: entry.name, dir: entry.dir });
    setRenameDraft(entry.name);
  };

  const cancelRename = () => { renameCancelled.current = true; setRenaming(null); };

  const commitRename = async () => {
    if (!renaming || renameRef.current) return;
    const name = renameDraft.trim();
    if (!name || name === renaming.name) { setRenaming(null); return; }
    const target = renaming;
    renameRef.current = true;
    setRenaming(null);
    try {
      const res = await window.harness.filesRename(target.rel, name, base);
      if (baseRef.current !== base) return;
      setError("");
      setActivePath(res.path);
      setActiveDir(target.dir ? res.path : parentOf(res.path));
      if (target.dir) {
        collapseAll();
        setChildren({});
        await loadDir("");
      } else {
        await loadDir(parentOf(target.rel));
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      renameRef.current = false;
    }
  };

  const duplicateEntry = async (entry: Entry) => {
    try {
      const res = await window.harness.filesDuplicate(entry.path, base);
      if (baseRef.current !== base) return;
      setError("");
      setActivePath(res.path);
      setActiveDir(parentOf(res.path));
      await loadDir(parentOf(entry.path));
    } catch (e) {
      setError(errText(e));
    }
  };

  const trashEntry = async (entry: Entry) => {
    if (entry.path === "") return;
    if (!window.confirm(`删除「${entry.name}」？会移到废纸篓。`)) return;
    try {
      await window.harness.filesTrash(entry.path, base);
      if (baseRef.current !== base) return;
      setError("");
      if (activePath === entry.path) setActivePath("");
      if (activeDir === entry.path || activeDir.startsWith(entry.path + "/")) setActiveDir(parentOf(entry.path));
      setExpanded((prev) => new Set([...prev].filter((p) => p !== entry.path && !p.startsWith(entry.path + "/"))));
      await loadDir(parentOf(entry.path));
    } catch (e) {
      setError(errText(e));
    }
  };

  const revealEntry = async (rel: string) => {
    try {
      await window.harness.filesReveal(rel, base);
      setError("");
    } catch (e) {
      setError(errText(e));
    }
  };

  const copyPathText = async (rel: string, relative: boolean) => {
    await window.harness.clipboardWrite(relative ? rel : absOf(rel));
  };

  const openInTerminal = (rel: string) => {
    requestTerminalAt(absOf(rel));
  };

  // 文件预览走终端区的标签（不再挤在右侧 280px 的侧栏里）
  const openPreviewInTerminal = (entry: Entry) => {
    requestFilePreview({ rel: entry.path, name: entry.name, root: base });
    setActivePath(entry.path);
    setActiveDir(parentOf(entry.path));
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
    const loadingNow = loading.has(rel);
    const list = visibleEntries(rel);
    const createRow = creating?.dir === rel ? (
      <div className="tree-row creating" style={{ paddingLeft: 8 + depth * 14 }} key="__create">
        {creating!.kind === "folder" ? <FolderIcon size={14} className="tree-folder" /> : <FileIcon size={14} className="file-ico" />}
        <input
          className="tree-input"
          autoFocus
          value={draft}
          placeholder={creating!.kind === "folder" ? "新文件夹名称" : "新文件名称"}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void commitCreate(); }
            else if (e.key === "Escape") { e.preventDefault(); cancelCreate(); }
          }}
          onBlur={() => {
            if (createCancelled.current) { createCancelled.current = false; return; }
            if (draft.trim()) void commitCreate(); else cancelCreate();
          }}
        />
      </div>
    ) : null;
    if (loadingNow) {
      return <>{createRow}<div className="tree-status" style={{ paddingLeft: 10 + depth * 14 }}>加载中…</div></>;
    }
    if (!list.length) {
      return (
        <>
          {createRow}
          {rel === "" ? <div className="tree-status" style={{ paddingLeft: 10 }}>{q ? "没有匹配的文件" : creating ? null : "目录为空"}</div> : null}
        </>
      );
    }
    return (
      <>
        {createRow}
        {list.map((entry) => {
          const open = expanded.has(entry.path) || (q && matchesBelow(entry.path));
          const selected = activePath === entry.path;
          return (
            <div key={entry.path}>
              <div
                className={`tree-row ${selected ? "on" : ""}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                role="button"
                tabIndex={0}
                title={entry.path}
                onClick={() => {
                  setActivePath(entry.path);
                  setActiveDir(entry.dir ? entry.path : parentOf(entry.path));
                  if (entry.dir) toggleDir(entry.path); else openPreviewInTerminal(entry);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActivePath(entry.path);
                  setActiveDir(entry.dir ? entry.path : parentOf(entry.path));
                  setMenu({ x: e.clientX, y: e.clientY, entry, dir: entry.dir ? entry.path : parentOf(entry.path) });
                }}
                onKeyDown={(e) => {
                  if (e.key === "F2") { e.preventDefault(); startRename(entry); return; }
                  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); void trashEntry(entry); return; }
                  if (e.key === "ArrowRight" && entry.dir && !open) { e.preventDefault(); toggleDir(entry.path); return; }
                  if (e.key === "ArrowLeft" && entry.dir && open) { e.preventDefault(); toggleDir(entry.path); return; }
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  if (entry.dir) toggleDir(entry.path); else openPreviewInTerminal(entry);
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
                {renaming?.rel === entry.path ? (
                  <input
                    className="tree-input"
                    autoFocus
                    value={renameDraft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                    }}
                    onBlur={() => {
                      if (renameCancelled.current) { renameCancelled.current = false; return; }
                      void commitRename();
                    }}
                  />
                ) : (
                  <span className="ellipsis">{entry.name}</span>
                )}
              </div>
              {entry.dir && open && renderDir(entry.path, depth + 1)}
            </div>
          );
        })}
      </>
    );
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

  const menuItems = (m: FsMenuPoint): FsMenuItem[] => {
    const entry = m.entry;
    if (!entry) {
      return [
        { label: "新建文件", run: () => startCreate("", "file") },
        { label: "新建文件夹", run: () => startCreate("", "folder") },
        "sep",
        { label: refreshing ? "刷新中…" : "刷新", disabled: refreshing, run: () => void refresh() },
        { label: "全部折叠", run: collapseAll },
        { label: showHidden ? "隐藏点文件" : "显示点文件", run: () => setShowHidden((v) => !v) },
      ];
    }
    const items: FsMenuItem[] = [];
    if (entry.dir) {
      items.push(
        { label: "新建文件", run: () => startCreate(entry.path, "file") },
        { label: "新建文件夹", run: () => startCreate(entry.path, "folder") },
        "sep",
        { label: "在终端中打开", run: () => openInTerminal(entry.path) },
      );
    } else {
      items.push(
        { label: "预览", run: () => openPreviewInTerminal(entry) },
        "sep",
        { label: "在终端中打开所在目录", run: () => openInTerminal(m.dir) },
      );
    }
    items.push(
      { label: "在 Finder 中显示", run: () => void revealEntry(entry.path) },
      "sep",
      { label: "复制路径", run: () => void copyPathText(entry.path, false) },
      { label: "复制相对路径", run: () => void copyPathText(entry.path, true) },
      "sep",
      { label: "重命名", hint: "F2", run: () => startRename(entry) },
      { label: "复制副本", run: () => void duplicateEntry(entry) },
      { label: "删除", hint: "⌫", danger: true, run: () => void trashEntry(entry) },
    );
    if (entry.dir && expanded.has(entry.path)) {
      items.push("sep", { label: "折叠此目录", run: () => toggleDir(entry.path) });
    }
    return items;
  };

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
                <button className="icon-btn" title={`新建文件${activeDir ? `到 ${activeDir}` : "到项目根目录"}`} aria-label="新建文件" onClick={() => startCreate(activeDir, "file")}>
                  <FilePlusIcon size={13} />
                </button>
                <button className="icon-btn" title={`新建文件夹${activeDir ? `到 ${activeDir}` : "到项目根目录"}`} aria-label="新建文件夹" onClick={() => startCreate(activeDir, "folder")}>
                  <FolderPlusIcon size={13} />
                </button>
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
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="筛选文件…" />
              {query && <button className="icon-btn" title="清除" aria-label="清除" onClick={() => setQuery("")}><XIcon size={11} /></button>}
            </div>
            {error && <div className="preview-error tree-error">{error}</div>}
            <div
              className="explorer-tree"
              onContextMenu={(e) => {
                if ((e.target as HTMLElement).closest(".tree-row")) return;
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, entry: null, dir: "" });
              }}
              onClick={(e) => { if (!(e.target as HTMLElement).closest(".tree-row")) { setActivePath(""); setActiveDir(""); } }}
            >
              {renderDir("", 0)}
            </div>
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
              <input value={sessionQuery} onChange={(e) => setSessionQuery(e.target.value)} placeholder="搜索…" />
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

      </div>
      {menu && <FsMenu point={menu} items={menuItems(menu)} onClose={() => setMenu(null)} />}
    </aside>
  );
}

function FsMenu({ point, items, onClose }: { point: FsMenuPoint; items: FsMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const left = Math.min(point.x, window.innerWidth - 210);
  const top = Math.min(point.y, window.innerHeight - (items.length * 28 + 16));
  return (
    <div ref={ref} className="fs-menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === "sep"
          ? <div key={`sep-${i}`} className="fs-menu-sep" />
          : (
            <button
              key={item.label}
              className={`fs-menu-item ${item.danger ? "danger" : ""}`}
              disabled={item.disabled}
              onClick={() => { item.run(); onClose(); }}
            >
              <span>{item.label}</span>
              {item.hint && <kbd>{item.hint}</kbd>}
            </button>
          ),
      )}
    </div>
  );
}
