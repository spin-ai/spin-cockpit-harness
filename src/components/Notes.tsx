import { useCallback, useEffect, useMemo, useState } from "react";
import type { State } from "../types";
import { renderMarkdown } from "../markdown";
import { ChevronDownIcon, ChevronRightIcon, RefreshIcon } from "./Icons";

type Act = (type: string, payload?: unknown) => Promise<any>;
const PLUGIN_ID = "ai.cockpit.notes";

type NoteSummary = {
  path: string; name: string; folder: string; title: string; mtime: number;
  tags: string[]; headings: number; links: number;
};
type TagSummary = { name: string; count: number };
type NoteView = {
  path: string; name: string; folder: string; title: string; content: string;
  frontmatter: Record<string, unknown>; headings: { level: number; text: string; line: number }[];
  tags: string[]; outgoing: { target: string; heading?: string; alias?: string; path?: string | null }[];
  backlinks: { path: string; title: string; heading?: string; alias?: string }[];
  mtime: number;
};
type SearchHit = { path: string; title: string; snippet: string };

/** [[Page|Alias]] → 内部锚点，交给 preview 的点击处理器打开笔记 */
function wikiMarkdown(text: string) {
  return String(text || "").replace(/\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_m, target: string, heading: string, alias: string) => {
    const label = alias || (heading ? `${target}#${heading}` : target);
    const ref = heading ? `${target.trim()}#${heading.trim()}` : target.trim();
    return `[${label}](#note/${encodeURIComponent(ref)})`;
  });
}

export function Notes({ state, act, onOpenTodo, openRequest }: { state: State; act: Act; onOpenTodo?: (id: string) => void; openRequest?: { path: string; n: number } | null }) {
  const plugin = (state.plugins || []).find((p) => p.id === PLUGIN_ID);
  const enabled = Boolean(plugin?.enabled);
  const [status, setStatus] = useState<{ vaultPath: string; count: number; indexedAt: number; error: string | null } | null>(null);
  const [files, setFiles] = useState<NoteSummary[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<NoteView | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({});
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const linkedTodos = note ? (state.todoLinks || []).filter((l) => l.pluginId === PLUGIN_ID && l.ref === note.path) : [];

  const invoke = useCallback(async (method: string, args: Record<string, unknown> = {}) => {
    return act("pluginInvoke", { pluginId: PLUGIN_ID, method, args });
  }, [act]);

  const fail = (err: unknown) => setError(String((err as Error)?.message || err));

  const refreshList = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await invoke("notes.list");
      if (!res) return;
      setStatus({ vaultPath: res.vaultPath || "", count: res.files?.length || 0, indexedAt: Date.now(), error: res.error || null });
      setFiles(Array.isArray(res.files) ? res.files : []);
      setTags(Array.isArray(res.tags) ? res.tags : []);
      setError(res.error || "");
    } catch (err) { fail(err); } finally { setLoading(false); }
  }, [enabled, invoke]);

  useEffect(() => { void refreshList(); }, [refreshList]);

  const openNote = useCallback(async (path: string) => {
    if (!path || path === selected && note) return;
    if (dirty && !window.confirm("当前笔记有未保存修改，确定切换？")) return;
    setSelected(path);
    setLoading(true);
    try {
      const res = await invoke("notes.read", { path });
      if (!res) return;
      setNote(res);
      setDraft(res.content || "");
      setDirty(false);
      setMode("preview");
      setError("");
      setNotice("");
    } catch (err) { fail(err); } finally { setLoading(false); }
  }, [invoke, selected, note, dirty]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (path) void openNote(path);
    };
    window.addEventListener("harness:notes-open", onOpen);
    return () => window.removeEventListener("harness:notes-open", onOpen);
  }, [openNote]);

  useEffect(() => {
    if (!openRequest?.path) return;
    void openNote(openRequest.path);
    // only react to a new command request, not every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.n]);

  const pickVault = async () => {
    setBusy(true);
    try {
      const res = await invoke("notes.pickVault");
      if (!res) return;
      setStatus({ vaultPath: res.vaultPath || "", count: res.files?.length || 0, indexedAt: Date.now(), error: res.error || null });
      setFiles(Array.isArray(res.files) ? res.files : []);
      setTags(Array.isArray(res.tags) ? res.tags : []);
      setSelected(null); setNote(null); setDraft(""); setDirty(false); setError(res.error || "");
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const save = useCallback(async () => {
    if (!note || !dirty) return;
    setBusy(true);
    try {
      const res = await invoke("notes.save", { path: note.path, content: draft, mtime: note.mtime });
      if (res) { setNote(res); setDraft(res.content || ""); setDirty(false); setNotice("已保存"); }
      await refreshList();
    } catch (err) { fail(err); } finally { setBusy(false); }
  }, [note, dirty, draft, invoke, refreshList]);

  const daily = async () => {
    setBusy(true);
    try {
      const res = await invoke("notes.daily");
      if (res) { setSelected(res.path); setNote(res); setDraft(res.content || ""); setDirty(false); setMode("preview"); await refreshList(); }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const createNote = async () => {
    const name = window.prompt("新笔记名称", "Untitled");
    if (!name) return;
    setBusy(true);
    try {
      const res = await invoke("notes.create", { name });
      if (res) { setSelected(res.path); setNote(res); setDraft(res.content || ""); setDirty(false); setMode("edit"); await refreshList(); }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const createTask = async () => {
    if (!note) return;
    setBusy(true);
    try {
      const res = await invoke("notes.createTask", { path: note.path, title: note.title, content: draft || note.content });
      if (res) setNotice(`已创建任务 ${res.key || res.title || ""}`);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const sendToChat = () => {
    if (!note) return;
    const text = `基于这段笔记继续：\n\n# ${note.title}\n\n${(draft || note.content).slice(0, 12000)}`;
    window.dispatchEvent(new CustomEvent("harness:view", { detail: "workspace" }));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("harness:chat-draft", { detail: { text } })), 100);
  };

  const search = async (value: string) => {
    setQuery(value);
    if (!value.trim()) { setSearchHits([]); return; }
    try { setSearchHits((await invoke("notes.search", { query: value })) || []); } catch { /* ignore */ }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => files.filter((f) => {
    if (tag && !f.tags.includes(tag)) return false;
    if (!normalizedQuery) return true;
    return `${f.title} ${f.path} ${f.tags.join(" ")}`.toLowerCase().includes(normalizedQuery);
  }), [files, tag, normalizedQuery]);
  const folders = useMemo(() => {
    const groups = new Map<string, NoteSummary[]>();
    for (const file of visible) {
      const key = file.folder || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(file);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  if (!enabled) {
    return (
      <div className="notes-page notes-disabled">
        <div className="notes-disabled-card">
          <b>Notes 插件未启用</b>
          <p>在「设置 → 插件」里启用 Notes，然后回到这里选择 Obsidian vault。</p>
        </div>
      </div>
    );
  }

  const hasVault = Boolean(status?.vaultPath);
  return (
    <div className="notes-page">
      <header className="notes-head">
        <div>
          <span className="notes-kicker">PLUGIN · NOTES</span>
          <h1>笔记</h1>
          <p>{hasVault ? status?.vaultPath : "选择一个 Obsidian vault 开始。"}{status?.count ? ` · ${status.count} notes` : ""}</p>
        </div>
        <div className="notes-actions">
          <button className="btn" onClick={() => void pickVault()} disabled={busy}>{hasVault ? "切换 vault" : "选择 vault"}</button>
          <button className="btn" onClick={() => void refreshList()} disabled={loading || !hasVault} title="刷新索引"><RefreshIcon size={13} /></button>
          <button className="btn" onClick={() => void daily()} disabled={!hasVault || busy}>今日</button>
          <button className="btn" onClick={() => void createNote()} disabled={!hasVault || busy}>＋ 新建</button>
        </div>
      </header>
      {(error || notice) && <div className={`notes-banner ${error ? "error" : ""}`}>{error || notice}</div>}
      {!hasVault ? (
        <div className="notes-empty">
          <div className="notes-empty-mark">#</div>
          <b>打开一个 Obsidian vault</b>
          <p>你的 Markdown 仍然是唯一事实来源；Cockpit 只建可重建的索引。</p>
          <button className="btn primary" onClick={() => void pickVault()} disabled={busy}>选择 vault 目录</button>
        </div>
      ) : (
        <div className="notes-layout">
          <aside className="notes-sidebar">
            <input className="notes-search" value={query} onChange={(e) => void search(e.target.value)} placeholder="搜索标题 / 路径 / 内容" />
            <div className="notes-tagbar">
              <button className={!tag ? "on" : ""} onClick={() => setTag("")}>全部</button>
              {tags.slice(0, 12).map((t) => <button key={t.name} className={tag === t.name ? "on" : ""} onClick={() => setTag(tag === t.name ? "" : t.name)}>#{t.name}</button>)}
            </div>
            {searchHits.length > 0 && (
              <div className="notes-search-results">
                {searchHits.slice(0, 12).map((hit) => (
                  <button key={hit.path} onClick={() => void openNote(hit.path)}>
                    <b>{hit.title}</b><span>{hit.path}</span><em>{hit.snippet}</em>
                  </button>
                ))}
              </div>
            )}
            <div className="notes-tree">
              {folders.map(([folder, items]) => {
                const open = folderOpen[folder] ?? true;
                return (
                  <div className="notes-folder" key={folder || "__root"}>
                    {folder && (
                      <button className="notes-folder-head" onClick={() => setFolderOpen((f) => ({ ...f, [folder]: !open }))}>
                        {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
                        <span>{folder}</span><em>{items.length}</em>
                      </button>
                    )}
                    {(open || !folder) && items.map((file) => (
                      <button key={file.path} className={`notes-file ${selected === file.path ? "on" : ""}`} onClick={() => void openNote(file.path)} title={file.path}>
                        <span className="notes-file-dot" />
                        <span className="ellipsis">{file.title}</span>
                        {file.tags.length > 0 && <em>#{file.tags[0]}</em>}
                      </button>
                    ))}
                  </div>
                );
              })}
              {visible.length === 0 && <div className="notes-empty-list">没有匹配的笔记</div>}
            </div>
          </aside>

          <main className="notes-main">
            {!note ? (
              <div className="notes-empty"><div className="notes-empty-mark">#</div><b>选择一篇笔记</b><p>左侧打开文件，或点「今日」创建 Daily Note。</p></div>
            ) : (
              <>
                <div className="notes-note-head">
                  <div className="notes-note-title">
                    <b>{note.title}</b>
                    <span className="mono">{note.path}</span>
                  </div>
                  <div className="notes-mode">
                    <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>预览</button>
                    <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>编辑</button>
                  </div>
                  <div className="notes-note-actions">
                    <button className="btn tiny-btn" onClick={() => void save()} disabled={!dirty || busy}>{dirty ? "保存" : "已保存"}</button>
                    <button className="btn tiny-btn" onClick={() => void createTask()} disabled={busy}>创建任务</button>
                    <button className="btn tiny-btn" onClick={sendToChat}>发送到 Chat</button>
                  </div>
                </div>
                {mode === "preview" ? (
                  <div className="notes-preview markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(wikiMarkdown(draft || note.content)) }} onClick={(e) => {
                    const anchor = (e.target as HTMLElement).closest("a");
                    const href = anchor?.getAttribute("href") || "";
                    if (!href) return;
                    if (/^https?:/i.test(href)) { e.preventDefault(); void window.harness.openExternal(href); return; }
                    e.preventDefault();
                    if (href.startsWith("#note/")) {
                      const ref = decodeURIComponent(href.slice(6));
                      const target = ref.split("#")[0];
                      const path = files.find((f) => f.title === target || f.name === target || f.path === target || f.path === `${target}.md`)?.path;
                      if (path) void openNote(path);
                      return;
                    }
                    void openNote(href.replace(/^#\/?/, "").replace(/\.md$/, ""));
                  }} />
                ) : (
                  <textarea
                    className="notes-editor"
                    value={draft}
                    spellCheck={false}
                    onChange={(e) => { setDraft(e.target.value); setDirty(true); setNotice(""); }}
                    onKeyDown={(e) => {
                      if (e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
                    }}
                  />
                )}
              </>
            )}
          </main>

          <aside className="notes-meta">
            {note ? (
              <>
                <div className="notes-meta-block">
                  <div className="notes-meta-title">Backlinks <em>{note.backlinks.length}</em></div>
                  {note.backlinks.length === 0 && <p className="notes-meta-empty">还没有反向链接</p>}
                  {note.backlinks.map((b) => <button key={`${b.path}-${b.heading}`} className="notes-link" onClick={() => void openNote(b.path)}><b>{b.title}</b>{b.heading && <span># {b.heading}</span>}</button>)}
                </div>
                <div className="notes-meta-block">
                  <div className="notes-meta-title">Outgoing <em>{note.outgoing.length}</em></div>
                  {note.outgoing.map((o, i) => (
                    <button key={i} className="notes-link" disabled={!o.path} onClick={() => o.path && void openNote(o.path)}>
                      <b>[[{o.target}]]</b>{o.heading && <span># {o.heading}</span>}{!o.path && <em>未解析</em>}
                    </button>
                  ))}
                </div>
                {note.tags.length > 0 && (
                  <div className="notes-meta-block">
                    <div className="notes-meta-title">Tags</div>
                    <div className="notes-taglist">{note.tags.map((t) => <button key={t} onClick={() => setTag(t)}>#{t}</button>)}</div>
                  </div>
                )}
                <div className="notes-meta-block">
                  <div className="notes-meta-title">Linked Todos <em>{linkedTodos.length}</em></div>
                  {linkedTodos.length === 0 && <p className="notes-meta-empty">还没有从这篇笔记创建的任务</p>}
                  {linkedTodos.map((l) => {
                    const todo = state.todos.find((t) => t.id === l.todoId);
                    return <button key={l.id} className="notes-link" disabled={!todo || !onOpenTodo} onClick={() => todo && onOpenTodo?.(todo.id)}><b>{todo?.title || l.title || l.todoId}</b><span>{todo?.key} {todo?.status}</span></button>;
                  })}
                </div>
                <div className="notes-meta-block">
                  <div className="notes-meta-title">Frontmatter</div>
                  {Object.keys(note.frontmatter || {}).length === 0 ? <p className="notes-meta-empty">无</p> : (
                    <div className="notes-frontmatter">{Object.entries(note.frontmatter).map(([k, v]) => <div key={k}><b>{k}</b><span>{Array.isArray(v) ? v.join(", ") : String(v)}</span></div>)}</div>
                  )}
                </div>
              </>
            ) : <p className="notes-meta-empty">打开笔记后显示 backlinks / outgoing / tags。</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
