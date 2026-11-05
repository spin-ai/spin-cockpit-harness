import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ElementContext, State, Todo } from "../types";
import { PreviewPanel } from "./PreviewPanel";
import { ChevronDownIcon, ChevronUpIcon, PanelCollapseIcon, SearchIcon, XIcon } from "./Icons";

type Tab = {
  id: string; cwd: string; title: string; taskId?: string; terminalId?: string; agentId?: string;
  /** 启动 Agent 的命令：带命令的标签页重启时会重复建 Agent 记录，故不提供重启。 */
  command?: string; projectId?: string;
  /** 用户手动重命名后不再跟随 shell 标题。 */
  renamed?: boolean;
  /** 后台标签页收到 bell（命令完成 / 需要输入）时的提示点。 */
  attention?: boolean;
};
type Mode = "terminal" | "preview";
type MenuPoint = { x: number; y: number };

const ZOOM_KEY = "ymh.term.zoom";
const MIN_FONT = 8;
const MAX_FONT = 32;
const SEARCH_DECORATIONS = {
  matchBackground: "#5c4a00",
  matchBorder: "#5c4a00",
  matchOverviewRuler: "#ffcc00",
  activeMatchBackground: "#c4580e",
  activeMatchBorder: "#ffcf6b",
  activeMatchColorOverviewRuler: "#ff9900",
};

function readZoom() {
  const n = Number(localStorage.getItem(ZOOM_KEY));
  return Number.isFinite(n) ? Math.max(-4, Math.min(16, Math.round(n))) : 0;
}

export function TerminalPanel({ state, todo, onOpenProject, onPickedContext, previewRoot, onCollapse, terminalFontSize = 12, terminalScrollback = 5000, previewHomeUrl }: {
  state: State; todo: Todo | null; onOpenProject: () => void;
  onPickedContext: (ctx: ElementContext) => void;
  previewRoot?: string;
  onCollapse?: () => void;
  terminalFontSize?: number;
  terminalScrollback?: number;
  previewHomeUrl?: string;
}) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("terminal");
  const [urlByTab, setUrlByTab] = useState<Record<string, string>>({});
  const [previewReq, setPreviewReq] = useState<{ url: string; n: number } | null>(null);
  const [searchTab, setSearchTab] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [zoom, setZoom] = useState(readZoom);
  const [focusToken, setFocusToken] = useState(0);
  const termToTab = useRef<Record<string, string>>({});
  const seq = useRef(1);
  const tabsRef = useRef<HTMLDivElement>(null);

  const fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(terminalFontSize + zoom)));

  useEffect(() => { try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* ignore */ } }, [zoom]);

  // 终端里打印出 dev server 地址 → 记住并给出「打开预览」入口
  useEffect(() => window.harness.onTerminalUrl(({ id, url }) => {
    const tabId = termToTab.current[id];
    if (tabId) setUrlByTab((map) => ({ ...map, [tabId]: url }));
  }), []);

  const addTab = useCallback((init: Omit<Tab, "id">) => {
    const tab: Tab = { ...init, id: `t${seq.current++}` };
    setTabs((list) => [...list, tab]);
    setActive(tab.id);
    setFocusToken((n) => n + 1);
    setMode("terminal");
    return tab;
  }, []);

  const activate = useCallback((id: string) => {
    setActive(id);
    setFocusToken((n) => n + 1);
  }, []);

  const patchTab = useCallback((id: string, patch: Partial<Tab>) => {
    setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // one terminal per opened project (a new tab when the project changes)
  const lastProject = useRef("");
  useEffect(() => {
    if (lastProject.current === state.projectPath) return;
    lastProject.current = state.projectPath;
    addTab({ cwd: state.projectPath, title: basename(state.projectPath) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.projectPath]);

  // task selection focuses/creates that task's terminal
  useEffect(() => {
    if (!todo) return;
    setTabs((list) => {
      const existing = list.find((t) => t.taskId === todo.id);
      if (existing) {
        setActive(existing.id);
        setFocusToken((n) => n + 1);
        return list;
      }
      const tab: Tab = { id: `t${seq.current++}`, cwd: todo.cwd || state.projectPath, title: `${todo.key} ${todo.title}`, taskId: todo.id };
      setActive(tab.id);
      setFocusToken((n) => n + 1);
      setMode("terminal");
      return [...list, tab];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo?.id]);

  // 后台标签页被激活时清掉 attention
  useEffect(() => {
    if (!active) return;
    setTabs((list) => list.map((t) => (t.id === active && t.attention ? { ...t, attention: false } : t)));
  }, [active]);

  const close = useCallback((id: string) => {
    setTabs((list) => {
      const idx = list.findIndex((t) => t.id === id);
      const next = list.filter((t) => t.id !== id);
      const closed = list[idx];
      if (closed?.terminalId) delete termToTab.current[closed.terminalId];
      if (active === id) {
        const fallback = next[Math.min(idx, next.length - 1)] ?? next.at(-1);
        setActive(fallback?.id ?? null);
        if (fallback) setFocusToken((n) => n + 1);
      }
      return next;
    });
    setSearchTab((cur) => (cur === id ? null : cur));
    setRenaming((cur) => (cur === id ? null : cur));
  }, [active]);

  // 新终端继承当前标签页的启动目录（任务标签页是任务 workdir）
  const newTerminal = useCallback(() => {
    const cur = tabs.find((t) => t.id === active);
    const cwd = cur?.cwd || state.projectPath;
    addTab({ cwd, title: basename(cwd) });
  }, [tabs, active, state.projectPath, addTab]);

  const closeActive = useCallback(() => { if (active) close(active); }, [active, close]);

  const cycleTab = useCallback((dir: 1 | -1) => {
    if (!tabs.length) return;
    const idx = Math.max(0, tabs.findIndex((t) => t.id === active));
    const next = tabs[(idx + dir + tabs.length) % tabs.length];
    if (next) activate(next.id);
  }, [tabs, active, activate]);

  useEffect(() => {
    const onNew = () => newTerminal();
    const onClose = () => closeActive();
    // ⌘⇧[ / ⌘⇧] 从任何位置切换终端标签（App 层只处理标签自身的事件）
    window.addEventListener("harness:new-terminal", onNew);
    window.addEventListener("harness:close-terminal", onClose);
    return () => { window.removeEventListener("harness:new-terminal", onNew); window.removeEventListener("harness:close-terminal", onClose); };
  }, [newTerminal, closeActive]);

  // 标签过多时：滚轮纵向滚动 → 横向滚动，激活标签自动滚进可视区
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      strip.scrollLeft += e.deltaY;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!active) return;
    const el = tabsRef.current?.querySelector<HTMLElement>(`[data-tab-id="${active}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.length]);

  const activeUrl = active ? urlByTab[active] : undefined;
  const activeTab = tabs.find((t) => t.id === active) ?? null;

  const changeZoom = useCallback((delta: number) => {
    setZoom((z) => Math.max(MIN_FONT - terminalFontSize, Math.min(MAX_FONT - terminalFontSize, z + delta)));
  }, [terminalFontSize]);

  return (
    <section className="terminal-pane">
      <div className="terminal-bar">
        <div className="row gap6" style={{ minWidth: 0 }}>
          <span className="term-brand">TERMINAL</span>
          <div className="term-mode">
            <button className={mode === "terminal" ? "on" : ""} onClick={() => setMode("terminal")}>终端</button>
            <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>预览</button>
          </div>
          <button className="link" onClick={onOpenProject}>打开项目</button>
          {activeUrl && (
            <button className="link" title={activeUrl} onClick={() => { setPreviewReq({ url: activeUrl, n: Date.now() }); setMode("preview"); }}>
              打开预览 {portOf(activeUrl)}
            </button>
          )}
        </div>
        <div className="row gap4">
          <div className="term-zoom" title="终端字号（⌘+ / ⌘- / ⌘0 重置）">
            <button onClick={() => changeZoom(-1)} disabled={fontSize <= MIN_FONT} aria-label="缩小字号">−</button>
            <span>{fontSize}</span>
            <button onClick={() => changeZoom(1)} disabled={fontSize >= MAX_FONT} aria-label="放大字号">+</button>
          </div>
          <button
            className="term-icon-btn"
            title="在终端中查找（⌘F）"
            aria-label="查找"
            disabled={!activeTab}
            onClick={() => { if (active) setMode("terminal"); setSearchTab((cur) => (cur === active ? null : active)); }}
          >
            <SearchIcon size={14} />
          </button>
          <select
            className="agent-launch"
            value=""
            title="在项目终端启动 Agent"
            onChange={async (e) => {
              const command = e.target.value;
              if (!command) return;
              const res = await window.harness.createTerminal(state.projectPath, { command, projectId: state.activeProjectId ?? undefined });
              const agent = res.agent as { alias?: string; id?: string } | undefined;
              addTab({ cwd: state.projectPath, title: `@${agent?.alias || command}`, terminalId: res.id, agentId: agent?.id, command, projectId: state.activeProjectId ?? undefined });
            }}
          >
            <option value="">＋ Agent</option>
            {(state.cliCapabilities || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn tiny-btn" title="新建终端（⌘T）" onClick={newTerminal}>＋ 终端</button>
          {onCollapse && (
            <button className="pane-collapse dark" title="收起终端" aria-label="收起终端" onClick={onCollapse}>
              <PanelCollapseIcon size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="term-tabs" ref={tabsRef} style={{ display: mode === "terminal" ? "flex" : "none" }}>
        {tabs.map((t, i) => (
          <div
            key={t.id}
            data-tab-id={t.id}
            className={`term-tab ${t.id === active ? "on" : ""} ${t.attention ? "attention" : ""}`}
            title={`${t.cwd}\n⌘⇧${i + 1} 直达 · 双击重命名 · 中键关闭`}
            onClick={() => activate(t.id)}
            onDoubleClick={() => { setRenaming(t.id); }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(t.id); } }}
          >
            <span className={`dot ${t.attention ? "amber" : t.taskId ? "green" : "slate"}`} />
            {renaming === t.id ? (
              <input
                className="term-rename"
                autoFocus
                defaultValue={t.title}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { patchTab(t.id, { title: e.target.value.trim() || t.title, renamed: true }); setRenaming(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.currentTarget.blur(); }
                  else if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); }
                }}
              />
            ) : (
              <span className="ellipsis">{t.title || "终端"}</span>
            )}
            <span className="term-close" title="关闭（⌘W）" onClick={(e) => { e.stopPropagation(); close(t.id); }}>×</span>
          </div>
        ))}
        <button className="term-tab add" title="新建终端（⌘T）" onClick={newTerminal}>＋</button>
      </div>
      <div className="term-body" style={{ display: mode === "terminal" ? "block" : "none" }}>
        {tabs.map((t) => (
          <TermTab
            key={t.id}
            tab={t}
            active={t.id === active}
            visible={mode === "terminal"}
            focusToken={focusToken}
            searchOpen={searchTab === t.id}
            fontSize={fontSize}
            scrollback={terminalScrollback}
            onOpenSearch={() => setSearchTab(t.id)}
            onCloseSearch={() => setSearchTab(null)}
            onNewTab={newTerminal}
            onCloseTab={() => close(t.id)}
            onTermId={(termId) => { termToTab.current[termId] = t.id; patchTab(t.id, { terminalId: termId }); }}
            onTitle={(title) => patchTab(t.id, { title })}
            onBell={() => patchTab(t.id, { attention: true })}
          />
        ))}
        {tabs.length === 0 && <div className="pane-empty">没有终端 · 点击「＋ 终端」或按 ⌘T 新建</div>}
      </div>
      <PreviewPanel hidden={mode !== "preview"} onPicked={onPickedContext} root={previewRoot} defaultUrl={previewHomeUrl || "http://localhost:5173/"} autoOpenUrl={previewReq?.url} autoOpenKey={previewReq?.n} />
      {/* 终端快捷键提示条：仅在终端面板内生效 */}
      {mode === "terminal" && tabs.length > 1 && (
        <div className="term-hint">⌘⇧[ / ⌘⇧] 或 ⌃Tab 切换标签 · ⌘⇧1…9 直达 · ⌘F 查找 · ⌘W 关闭</div>
      )}
    </section>
  );
}

function basename(p: string) {
  return p.split("/").filter(Boolean).slice(-1)[0] || p;
}

function portOf(url: string) {
  try {
    const u = new URL(url);
    return u.port ? `:${u.port}` : u.host;
  } catch {
    return url;
  }
}

/** 去掉 shell/Agent 常带的前缀装饰，限制标签宽度。 */
function cleanTitle(raw: string) {
  return String(raw || "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

type TermTabProps = {
  tab: Tab; active: boolean; visible: boolean; focusToken: number; searchOpen: boolean;
  fontSize: number; scrollback: number;
  onOpenSearch: () => void; onCloseSearch: () => void;
  onNewTab: () => void; onCloseTab: () => void;
  onTermId: (termId: string) => void;
  onTitle: (title: string) => void;
  onBell: () => void;
};

function TermTab({ tab, active, visible, focusToken, searchOpen, fontSize, scrollback, onOpenSearch, onCloseSearch, onNewTab, onCloseTab, onTermId, onTitle, onBell }: TermTabProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [exited, setExited] = useState(false);
  const [incarnation, setIncarnation] = useState(0);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [menu, setMenu] = useState<MenuPoint | null>(null);
  const onTitleRef = useRef(onTitle);
  const onBellRef = useRef(onBell);
  onTitleRef.current = onTitle;
  onBellRef.current = onBell;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      fontSize, scrollback, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true, convertEol: false,
      allowProposedApi: true,
      rightClickSelectsWord: true,
      scrollOnUserInput: true,
      theme: { background: "#101012", foreground: "#d4d4d8", cursor: "#d4d4d8", selectionBackground: "#3f3f46" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon();
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon((event, uri) => {
      event.preventDefault();
      void window.harness.openExternal(uri);
    }));
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    setSearchAddon(search);
    setExited(false);
    setExitCode(null);

    // 尺寸自适应：拖分隔条 / 收起侧栏 / 窗口缩放都会触发，避免行列数停留在旧值
    let frame = 0;
    const scheduleFit = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (host.clientWidth < 20 || host.clientHeight < 20) return;
        try { fit.fit(); } catch { /* ignore */ }
      });
    };
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(host);
    scheduleFit();

    let termId = "";
    let disposed = false;
    let ready = false;
    const pending: string[] = [];

    const write = (data: string) => { if (data) term.write(data); };

    const offData = window.harness.onTerminalData(({ id, data }) => {
      if (!termId || id !== termId) return;
      if (ready) write(data);
      else pending.push(data);
    });
    const offExit = window.harness.onTerminalExit(({ id, exitCode: code }) => {
      if (!termId || id !== termId) return;
      setExitCode(typeof code === "number" ? code : null);
      setExited(true);
    });

    const attach = (id: string) => {
      termId = id;
      onTermIdRef.current(id);
      void window.harness.attachTerminal(id).then((res) => {
        if (disposed) return;
        write(res?.data || "");
        ready = true;
        for (const chunk of pending.splice(0)) write(chunk);
        if (res?.exited) {
          setExitCode(typeof res.exitCode === "number" ? res.exitCode : null);
          setExited(true);
        }
        scheduleFit();
      });
    };

    if (tab.terminalId) {
      attach(tab.terminalId);
    } else {
      window.harness.createTerminal(tab.cwd).then(({ id }) => {
        if (disposed) { void window.harness.closeTerminal(id); return; }
        attach(id);
      }).catch((err) => {
        if (disposed) return;
        term.write(`\r\n\x1b[31m[failed to start shell] ${String((err as Error)?.message || err)}\x1b[0m\r\n`);
        setExited(true);
      });
    }

    const sub = term.onData((data) => { if (termId) void window.harness.terminalInput(termId, data); });
    const resizeSub = term.onResize(({ cols, rows }) => { if (termId) void window.harness.terminalResize(termId, cols, rows); });
    const titleSub = term.onTitleChange((title) => {
      const clean = cleanTitle(title);
      if (clean) onTitleRef.current(clean);
    });
    const bellSub = term.onBell(() => onBellRef.current());
    const scrollSub = term.onScroll(() => {
      const buffer = term.buffer.active;
      setScrolledUp(buffer.viewportY < buffer.baseY);
    });

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      sub.dispose();
      resizeSub.dispose();
      titleSub.dispose();
      bellSub.dispose();
      scrollSub.dispose();
      offData();
      offExit();
      if (termId) void window.harness.closeTerminal(termId);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      setSearchAddon(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, incarnation]);

  // 激活 / 取消隐藏时重新 fit，并在用户主动切标签时把焦点交回终端
  useEffect(() => {
    if (!active || !visible) return;
    const t = setTimeout(() => {
      try { fitRef.current?.fit(); } catch { /* ignore */ }
      if (focusToken > 0) termRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [active, visible, focusToken]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    const t = setTimeout(() => { try { fitRef.current?.fit(); } catch { /* ignore */ } }, 10);
    return () => clearTimeout(t);
  }, [fontSize]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.scrollback = scrollback;
  }, [scrollback]);

  const onTermIdRef = useRef(onTermId);
  onTermIdRef.current = onTermId;

  const focusTerm = useCallback(() => { termRef.current?.focus(); }, []);

  const copySelection = useCallback(async () => {
    const text = termRef.current?.getSelection() ?? "";
    if (text) await window.harness.clipboardWrite(text);
    focusTerm();
  }, [focusTerm]);

  const paste = useCallback(async () => {
    const text = await window.harness.clipboardRead();
    if (text) termRef.current?.paste(text);
    focusTerm();
  }, [focusTerm]);

  const selectAll = useCallback(() => { termRef.current?.selectAll(); focusTerm(); }, [focusTerm]);
  const clearScreen = useCallback(() => { termRef.current?.clear(); focusTerm(); }, [focusTerm]);
  const scrollToBottom = useCallback(() => { termRef.current?.scrollToBottom(); focusTerm(); }, [focusTerm]);

  const restart = useCallback(() => {
    setExited(false);
    setExitCode(null);
    setIncarnation((n) => n + 1);
  }, []);

  // 终端内快捷键：capture 阶段先于 xterm 的 keydown，避免被 shell 吞掉。
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const isMac = e.metaKey;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      // 查找
      if (mod && key === "f") { stop(); onOpenSearch(); return; }
      if (mod && key === "g" && searchOpen) { stop(); return; }
      // 新建 / 关闭标签（截获 App 的同名快捷键，避免重复执行）
      if (isMac && key === "t") { stop(); onNewTab(); return; }
      if (isMac && key === "w") { stop(); onCloseTab(); return; }
      // 标签切换
      if (e.ctrlKey && e.key === "Tab") { stop(); window.dispatchEvent(new CustomEvent("harness:cycle-terminal-tab", { detail: e.shiftKey ? -1 : 1 })); return; }
      if (isMac && e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
        stop();
        window.dispatchEvent(new CustomEvent("harness:cycle-terminal-tab", { detail: e.code === "BracketRight" ? 1 : -1 }));
        return;
      }
      if (isMac && e.shiftKey && /^[1-9]$/.test(e.key)) { stop(); window.dispatchEvent(new CustomEvent("harness:goto-terminal-tab", { detail: Number(e.key) - 1 })); return; }
      // 字号缩放
      if (isMac && (e.key === "=" || e.key === "+")) { stop(); window.dispatchEvent(new CustomEvent("harness:terminal-zoom", { detail: 1 })); return; }
      if (isMac && (e.key === "-" || e.key === "_")) { stop(); window.dispatchEvent(new CustomEvent("harness:terminal-zoom", { detail: -1 })); return; }
      if (isMac && e.key === "0") { stop(); window.dispatchEvent(new CustomEvent("harness:terminal-zoom", { detail: 0 })); return; }
      // 清屏 / 复制 / 粘贴 / 全选
      if (isMac && e.shiftKey && key === "k") { stop(); clearScreen(); return; }
      if (isMac && key === "a") { stop(); selectAll(); return; }
      if (isMac && key === "c") {
        if (termRef.current?.hasSelection()) { stop(); void copySelection(); }
        return; // 无选区时保留 ^C 给 shell
      }
      if (isMac && key === "v") { stop(); void paste(); return; }
      if (e.key === "Escape" && searchOpen) { stop(); onCloseSearch(); }
    };
    wrap.addEventListener("keydown", onKeyDown, true);
    return () => wrap.removeEventListener("keydown", onKeyDown, true);
  }, [searchOpen, onOpenSearch, onCloseSearch, onNewTab, onCloseTab, clearScreen, selectAll, copySelection, paste]);

  const menuItems: MenuItem[] = exited
    ? [
        ...(tab.command ? [] : [{ label: "重新启动", hint: "⌘R", run: restart } as MenuItem]),
        { label: "复制", hint: "⌘C", run: () => void copySelection() },
        { label: "关闭标签", hint: "⌘W", danger: true, run: onCloseTab },
      ]
    : [
        { label: "复制", hint: "⌘C", disabled: !termRef.current?.hasSelection(), run: () => void copySelection() },
        { label: "粘贴", hint: "⌘V", run: () => void paste() },
        { label: "全选", hint: "⌘A", run: selectAll },
        "sep",
        { label: "查找…", hint: "⌘F", run: onOpenSearch },
        { label: "清屏", hint: "⇧⌘K", run: clearScreen },
        "sep",
        { label: "新建终端", hint: "⌘T", run: onNewTab },
        { label: "关闭标签", hint: "⌘W", run: onCloseTab },
      ];

  return (
    <div
      className={`term-instance ${active ? "on" : ""}`}
      style={{ display: active ? "block" : "none" }}
      ref={wrapRef}
      onContextMenu={(e) => { e.preventDefault(); termRef.current?.focus(); setMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <div className="term-host" ref={hostRef} onClick={focusTerm} />
      {searchOpen && searchAddon && <TermSearch addon={searchAddon} onClose={onCloseSearch} />}
      {scrolledUp && !exited && (
        <button className="term-jump-bottom" title="回到最新输出" aria-label="回到最新输出" onClick={scrollToBottom}>
          <ChevronDownIcon size={14} />
        </button>
      )}
      {exited && (
        <div className="term-exited">
          <span>进程已退出{exitCode !== null && exitCode !== 0 ? ` · code ${exitCode}` : ""}</span>
          <div className="row gap8">
            {!tab.command && <button className="btn tiny-btn" onClick={restart}>重新启动</button>}
            <button className="link" onClick={onCloseTab}>关闭标签</button>
          </div>
        </div>
      )}
      {menu && (
        <TermMenu
          point={menu}
          items={menuItems}
          onClose={() => { setMenu(null); focusTerm(); }}
        />
      )}
    </div>
  );
}

type MenuItem = { label: string; hint?: string; disabled?: boolean; danger?: boolean; run: () => void } | "sep";

function TermMenu({ point, items, onClose }: { point: MenuPoint; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // 贴边时向内收，避免菜单跑出窗口
  const left = Math.min(point.x, window.innerWidth - 200);
  const top = Math.min(point.y, window.innerHeight - (items.length * 30 + 16));

  return (
    <div ref={ref} className="term-menu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === "sep"
          ? <div key={`sep-${i}`} className="term-menu-sep" />
          : (
            <button
              key={item.label}
              className={`term-menu-item ${item.danger ? "danger" : ""}`}
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

function TermSearch({ addon, onClose }: { addon: SearchAddon; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState({ resultIndex: -1, resultCount: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, []);

  const options = useCallback((incremental = false) => ({
    caseSensitive, regex, incremental, decorations: SEARCH_DECORATIONS,
  }), [caseSensitive, regex]);

  const clear = useCallback(() => {
    try { addon.clearDecorations(); addon.findNext(""); } catch { /* ignore */ }
  }, [addon]);

  useEffect(() => {
    const sub = addon.onDidChangeResults((r) => setResults(r));
    return () => { sub.dispose(); clear(); };
  }, [addon, clear]);

  useEffect(() => {
    if (!query) { clear(); return; }
    try { addon.findNext(query, options(true)); } catch { /* invalid regex 时停在原地 */ }
  }, [query, caseSensitive, regex, addon, options, clear]);

  const find = useCallback((back: boolean) => {
    if (!query) return;
    try {
      if (back) addon.findPrevious(query, options());
      else addon.findNext(query, options());
    } catch { /* ignore */ }
  }, [addon, query, options]);

  const status = !query
    ? "0/0"
    : results.resultCount === 0
      ? "无结果"
      : results.resultIndex < 0
        ? `${results.resultCount}+`
        : `${results.resultIndex + 1}/${results.resultCount}`;

  return (
    <div className="term-search" onKeyDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={query}
        placeholder="查找…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
          else if (e.key === "Enter") { e.preventDefault(); find(e.shiftKey); }
        }}
      />
      <button className={caseSensitive ? "on" : ""} title="区分大小写" onClick={() => setCaseSensitive((v) => !v)}>Aa</button>
      <button className={regex ? "on" : ""} title="正则表达式" onClick={() => setRegex((v) => !v)}>.*</button>
      <span className="term-search-count">{status}</span>
      <button title="上一个（⇧Enter）" onClick={() => find(true)}><ChevronUpIcon size={13} /></button>
      <button title="下一个（Enter）" onClick={() => find(false)}><ChevronDownIcon size={13} /></button>
      <button title="关闭（Esc）" onClick={onClose}><XIcon size={13} /></button>
    </div>
  );
}
