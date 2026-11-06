import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ElementContext, State, Todo } from "../types";
import { FilePreviewPane } from "./FilePreviewPane";
import { FileVisual, extOf } from "./FileVisual";
import { PreviewSurface } from "./PreviewSurface";
import { takeTerminalRequests } from "../terminal-events";
import { Splitter } from "./Splitter";
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, PanelCollapseIcon, SearchIcon, SplitDownIcon, SplitRightIcon, XIcon } from "./Icons";

/** 一个终端窗格 = 一个 pty（重启会新建 pty） */
type PaneState = {
  id: string; cwd: string; title: string;
  terminalId?: string; agentId?: string;
  /** 启动 Agent 的命令：带命令的窗格重启时会重复建 Agent 记录，故不提供重启。 */
  command?: string; projectId?: string;
};

/** 二进制拆分树：row = 左右，col = 上下；ratio 是第一个子节点占比 */
type PaneNode =
  | { type: "pane"; pane: PaneState }
  | { type: "split"; id: string; dir: "row" | "col"; ratio: number; a: PaneNode; b: PaneNode };

type Tab = {
  id: string;
  /** terminal = 可拆分的 pty 会话；preview = 单个网页预览；file = 文件预览 */
  kind: "terminal" | "preview" | "file";
  title: string; cwd: string;
  root?: PaneNode;
  focusedPaneId?: string;
  url?: string;
  /** 文件预览标签：相对路径 + 根目录 */
  rel?: string; rootDir?: string;
  taskId?: string;
  /** 用户手动重命名后不再跟随 shell 标题。 */
  renamed?: boolean;
  /** 后台标签页收到 bell（命令完成 / 需要输入）时的提示点。 */
  attention?: boolean;
};

type MenuPoint = { x: number; y: number };
type SplitDir = "row" | "col";
type FocusDir = "left" | "right" | "up" | "down";

const ZOOM_KEY = "cmh.term.zoom";
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

function firstPane(node: PaneNode): PaneState {
  return node.type === "pane" ? node.pane : firstPane(node.a);
}

function findPaneById(node: PaneNode | undefined, id: string): PaneState | null {
  if (!node) return null;
  if (node.type === "pane") return node.pane.id === id ? node.pane : null;
  return findPaneById(node.a, id) ?? findPaneById(node.b, id);
}

function updatePaneNode(node: PaneNode, id: string, patch: Partial<PaneState>): PaneNode {
  if (node.type === "pane") return node.pane.id === id ? { type: "pane", pane: { ...node.pane, ...patch } } : node;
  const a = updatePaneNode(node.a, id, patch);
  const b = updatePaneNode(node.b, id, patch);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function insertSplitNode(node: PaneNode, targetPaneId: string, pane: PaneState, dir: SplitDir, splitId: string): PaneNode {
  if (node.type === "pane") {
    if (node.pane.id !== targetPaneId) return node;
    return { type: "split", id: splitId, dir, ratio: 0.5, a: node, b: { type: "pane", pane } };
  }
  const a = insertSplitNode(node.a, targetPaneId, pane, dir, splitId);
  const b = insertSplitNode(node.b, targetPaneId, pane, dir, splitId);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function removePaneNode(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "pane") return node.pane.id === paneId ? null : node;
  const a = removePaneNode(node.a, paneId);
  const b = removePaneNode(node.b, paneId);
  if (a && b) return { ...node, a, b };
  return a ?? b; // 只剩一边时折叠掉这层 split
}

function updateRatioNode(node: PaneNode, splitId: string, delta: number): PaneNode {
  if (node.type === "pane") return node;
  if (node.id === splitId) {
    const ratio = Math.max(0.15, Math.min(0.85, node.ratio + delta));
    return { ...node, ratio };
  }
  const a = updateRatioNode(node.a, splitId, delta);
  const b = updateRatioNode(node.b, splitId, delta);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function paneCount(node: PaneNode): number {
  return node.type === "pane" ? 1 : paneCount(node.a) + paneCount(node.b);
}

function collectPaneIds(node: PaneNode | undefined): string[] {
  if (!node) return [];
  return node.type === "pane" ? [node.pane.id] : [...collectPaneIds(node.a), ...collectPaneIds(node.b)];
}

function basename(p: string) {
  return p.split("/").filter(Boolean).slice(-1)[0] || p;
}

function previewTitle(url: string) {
  return `预览 ${portOf(url).replace(/^:/, "")}`;
}

function portOf(url: string) {
  try {
    const u = new URL(url);
    return u.port ? `:${u.port}` : u.host;
  } catch {
    return url;
  }
}

/** 去掉 shell/Agent 常带的前缀装饰，限制标题宽度。 */
function cleanTitle(raw: string) {
  return String(raw || "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
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
  const [urlByPane, setUrlByPane] = useState<Record<string, string>>({});
  const [lastUrl, setLastUrl] = useState("");
  const [previewReq, setPreviewReq] = useState<{ url: string; n: number } | null>(null);
  const [searchPaneId, setSearchPaneId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [zoom, setZoom] = useState(readZoom);
  const [focusToken, setFocusToken] = useState(0);
  const termToPane = useRef<Record<string, string>>({});
  const seq = useRef(1);
  const tabsRef = useRef<HTMLDivElement>(null);

  const fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(terminalFontSize + zoom)));
  const activeTab = tabs.find((t) => t.id === active) ?? null;
  const activeFocusedId = activeTab?.root ? (activeTab.focusedPaneId ?? firstPane(activeTab.root).id) : null;
  const activePane = activeTab?.root && activeFocusedId ? findPaneById(activeTab.root, activeFocusedId) : null;
  const activeUrl = activePane ? urlByPane[activePane.id] : undefined;

  useEffect(() => { try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* ignore */ } }, [zoom]);

  // 终端里打印出 dev server 地址 → 记住并给出「打开预览」入口
  useEffect(() => window.harness.onTerminalUrl(({ id, url }) => {
    const paneId = termToPane.current[id];
    if (paneId) setUrlByPane((map) => ({ ...map, [paneId]: url }));
    if (url) setLastUrl(url);
  }), []);

  // 切标签 / 切窗格时关闭查找，避免搜索栏留在别的终端上
  useEffect(() => { setSearchPaneId(null); }, [active, activeFocusedId]);

  const makePane = useCallback((init: { cwd: string; title?: string; terminalId?: string; agentId?: string; command?: string; projectId?: string }): PaneState => ({
    id: `p${seq.current++}`,
    cwd: init.cwd,
    title: init.title || basename(init.cwd),
    terminalId: init.terminalId,
    agentId: init.agentId,
    command: init.command,
    projectId: init.projectId,
  }), []);

  const addTab = useCallback((init: { cwd: string; title?: string; taskId?: string; terminalId?: string; agentId?: string; command?: string; projectId?: string }) => {
    const pane = makePane(init);
    const tab: Tab = {
      id: `t${seq.current++}`,
      kind: "terminal",
      cwd: pane.cwd,
      title: pane.title,
      taskId: init.taskId,
      root: { type: "pane", pane },
      focusedPaneId: pane.id,
    };
    setTabs((list) => [...list, tab]);
    setActive(tab.id);
    setFocusToken((n) => n + 1);
    return tab;
  }, [makePane]);

  const openFilePreviewTab = useCallback((req: { rel: string; name?: string; root?: string }) => {
    if (!req.rel) return;
    const root = req.root || "";
    const existing = tabs.find((t) => t.kind === "file" && t.rel === req.rel && (t.rootDir || "") === root);
    if (existing) {
      if (req.name && req.name !== existing.title) {
        setTabs((list) => list.map((t) => (t.id === existing.id ? { ...t, title: req.name as string } : t)));
      }
      setActive(existing.id);
      setFocusToken((n) => n + 1);
      return;
    }
    const tab: Tab = {
      id: `t${seq.current++}`, kind: "file",
      cwd: root || state.projectPath,
      title: req.name || req.rel.split("/").pop() || "预览",
      rel: req.rel, rootDir: root,
    };
    setTabs((list) => [...list, tab]);
    setActive(tab.id);
    setFocusToken((n) => n + 1);
  }, [tabs, state.projectPath]);

  const activate = useCallback((tabId: string, paneId?: string) => {
    setActive(tabId);
    if (paneId) setTabs((list) => list.map((t) => (t.id === tabId ? { ...t, focusedPaneId: paneId } : t)));
    setFocusToken((n) => n + 1);
  }, []);

  const patchTab = useCallback((tabId: string, patch: Partial<Tab>) => {
    setTabs((list) => list.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
  }, []);

  const patchPane = useCallback((tabId: string, paneId: string, patch: Partial<PaneState>) => {
    setTabs((list) => list.map((t) => (t.id === tabId && t.root ? { ...t, root: updatePaneNode(t.root, paneId, patch) } : t)));
  }, []);

  const focusPane = useCallback((tabId: string, paneId: string) => {
    setTabs((list) => list.map((t) => (t.id === tabId ? { ...t, focusedPaneId: paneId } : t)));
    setActive(tabId);
    setFocusToken((n) => n + 1);
  }, []);

  const newTerminal = useCallback(() => {
    const cwd = activePane?.cwd || state.projectPath;
    addTab({ cwd, title: basename(cwd) });
  }, [activePane?.cwd, state.projectPath, addTab]);

  // 预览是终端的一个标签页（与 Orca 一致）：已存在就导航 + 激活，否则新建
  const openPreview = useCallback((url: string) => {
    if (!url) return;
    setPreviewReq({ url, n: Date.now() });
    const existing = tabs.find((t) => t.kind === "preview");
    if (existing) {
      setTabs((list) => list.map((t) => (t.id === existing.id
        ? { ...t, url, title: t.renamed ? t.title : previewTitle(url) }
        : t)));
      setActive(existing.id);
    } else {
      const tab: Tab = { id: `t${seq.current++}`, kind: "preview", cwd: state.projectPath, title: previewTitle(url), url };
      setTabs((list) => [...list, tab]);
      setActive(tab.id);
    }
    setFocusToken((n) => n + 1);
  }, [tabs, state.projectPath]);

  // 工具栏「＋ 预览」/ 命令面板入口：优先复用已打开的预览标签，否则用
  // 当前窗格识别的地址 → 最近一次识别 → 设置里的默认预览地址
  const showPreview = useCallback(() => {
    const existing = tabs.find((t) => t.kind === "preview");
    if (existing) { activate(existing.id); return; }
    openPreview(activeUrl || lastUrl || previewHomeUrl || "http://localhost:5173/");
  }, [tabs, activate, openPreview, activeUrl, lastUrl, previewHomeUrl]);

  const splitFocused = useCallback((dir: SplitDir) => {
    const tab = tabs.find((t) => t.id === active);
    if (!tab || tab.kind !== "terminal" || !tab.root) return;
    const focusedId = tab.focusedPaneId ?? firstPane(tab.root).id;
    const src = findPaneById(tab.root, focusedId) ?? firstPane(tab.root);
    const pane = makePane({ cwd: src.cwd, title: basename(src.cwd) });
    const root = insertSplitNode(tab.root, src.id, pane, dir, `s${seq.current++}`);
    setTabs(tabs.map((t) => (t.id === tab.id ? { ...t, root, focusedPaneId: pane.id } : t)));
    setFocusToken((n) => n + 1);
    setSearchPaneId(null);
  }, [tabs, active, makePane]);

  const forgetPanes = useCallback((paneIds: string[]) => {
    if (!paneIds.length) return;
    setUrlByPane((map) => {
      const next = { ...map };
      for (const id of paneIds) delete next[id];
      return next;
    });
    for (const [termId, paneId] of Object.entries(termToPane.current)) {
      if (paneIds.includes(paneId)) delete termToPane.current[termId];
    }
  }, []);

  const close = useCallback((tabId: string) => {
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const tab = tabs[idx];
    forgetPanes(collectPaneIds(tab.root));
    const next = tabs.filter((t) => t.id !== tabId);
    setTabs(next);
    if (active === tabId) {
      const fallback = next[Math.min(idx, next.length - 1)] ?? next.at(-1) ?? null;
      setActive(fallback?.id ?? null);
      if (fallback) setFocusToken((n) => n + 1);
    }
    setSearchPaneId(null);
    setRenaming((cur) => (cur === tabId ? null : cur));
  }, [tabs, active, forgetPanes]);

  // 关闭当前窗格；最后一个窗格时关闭整个标签
  const closeFocusedPane = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.kind !== "terminal" || !tab.root || tab.root.type === "pane") { close(tabId); return; }
    const focusedId = tab.focusedPaneId ?? firstPane(tab.root).id;
    const root = removePaneNode(tab.root, focusedId);
    if (!root) { close(tabId); return; }
    forgetPanes([focusedId]);
    const focusId = findPaneById(root, focusedId) ? focusedId : firstPane(root).id;
    setTabs(tabs.map((t) => (t.id === tabId ? { ...t, root, focusedPaneId: focusId } : t)));
    setFocusToken((n) => n + 1);
    setSearchPaneId(null);
  }, [tabs, close, forgetPanes]);

  const closeActiveSurface = useCallback(() => {
    if (!activeTab) return;
    if (activeTab.kind === "terminal") closeFocusedPane(activeTab.id);
    else close(activeTab.id);
  }, [activeTab, close, closeFocusedPane]);

  const cycleTab = useCallback((dir: 1 | -1) => {
    if (!tabs.length) return;
    const idx = Math.max(0, tabs.findIndex((t) => t.id === active));
    const next = tabs[(idx + dir + tabs.length) % tabs.length];
    if (next) activate(next.id);
  }, [tabs, active, activate]);

  const changeRatio = useCallback((tabId: string, splitId: string, delta: number) => {
    setTabs((list) => list.map((t) => {
      if (t.id !== tabId || !t.root) return t;
      return { ...t, root: updateRatioNode(t.root, splitId, delta) };
    }));
  }, []);

  // ⌘⌥←/→/↑/↓：按屏幕几何位置把焦点移到相邻窗格
  const focusDir = useCallback((dir: FocusDir) => {
    const tab = tabs.find((t) => t.id === active);
    if (!tab?.root) return;
    const curId = tab.focusedPaneId ?? firstPane(tab.root).id;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".term-pane-leaf[data-pane-id]"));
    const curEl = nodes.find((el) => el.dataset.paneId === curId);
    if (!curEl) return;
    const c = curEl.getBoundingClientRect();
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;
    let best: { id: string; dist: number } | null = null;
    for (const el of nodes) {
      const id = el.dataset.paneId;
      if (!id || id === curId) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const ok = dir === "left" ? x < cx - 4 : dir === "right" ? x > cx + 4 : dir === "up" ? y < cy - 4 : y > cy + 4;
      if (!ok) continue;
      const dist = Math.abs(x - cx) + Math.abs(y - cy);
      if (!best || dist < best.dist) best = { id, dist };
    }
    if (best) focusPane(active!, best.id);
  }, [tabs, active, focusPane]);

  const changeZoom = useCallback((delta: number) => {
    setZoom((z) => Math.max(MIN_FONT - terminalFontSize, Math.min(MAX_FONT - terminalFontSize, z + delta)));
  }, [terminalFontSize]);

  // 终端里调标题：更新窗格；聚焦窗格再同步到标签标题（用户重命名过则不动）
  const onPaneTitle = useCallback((tabId: string, paneId: string, title: string) => {
    setTabs((list) => list.map((t) => {
      if (t.id !== tabId || !t.root) return t;
      const root = updatePaneNode(t.root, paneId, { title });
      const focused = t.focusedPaneId ?? firstPane(t.root).id;
      return { ...t, root, title: t.renamed ? t.title : paneId === focused ? title : t.title };
    }));
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
      const pane = makePane({ cwd: todo.cwd || state.projectPath, title: `${todo.key} ${todo.title}` });
      const tab: Tab = {
        id: `t${seq.current++}`, kind: "terminal", cwd: pane.cwd, title: pane.title,
        taskId: todo.id, root: { type: "pane", pane }, focusedPaneId: pane.id,
      };
      setActive(tab.id);
      setFocusToken((n) => n + 1);
      return [...list, tab];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo?.id]);

  // 后台标签页被激活时清掉 attention
  useEffect(() => {
    if (!active) return;
    setTabs((list) => list.map((t) => (t.id === active && t.attention ? { ...t, attention: false } : t)));
  }, [active]);

  useEffect(() => {
    const onNew = () => newTerminal();
    const onClose = () => closeActiveSurface();
    const onPreview = () => showPreview();
    const onSplit = (e: Event) => splitFocused((e as CustomEvent).detail === "col" ? "col" : "row");
    // 文件预览 / 在终端打开：消费共享队列（面板收起时由 App 先展开，挂载后再消费）
    const consumeRequests = () => {
      const pending = takeTerminalRequests();
      if (pending.cwd) addTab({ cwd: pending.cwd, title: basename(pending.cwd) });
      if (pending.file) openFilePreviewTab(pending.file);
    };
    consumeRequests();
    window.addEventListener("harness:new-terminal", onNew);
    window.addEventListener("harness:close-terminal", onClose);
    window.addEventListener("harness:open-preview", onPreview);
    window.addEventListener("harness:split-terminal", onSplit);
    window.addEventListener("harness:open-file-preview", consumeRequests);
    window.addEventListener("harness:open-terminal-at", consumeRequests);
    return () => {
      window.removeEventListener("harness:new-terminal", onNew);
      window.removeEventListener("harness:close-terminal", onClose);
      window.removeEventListener("harness:open-preview", onPreview);
      window.removeEventListener("harness:split-terminal", onSplit);
      window.removeEventListener("harness:open-file-preview", consumeRequests);
      window.removeEventListener("harness:open-terminal-at", consumeRequests);
    };
  }, [newTerminal, closeActiveSurface, showPreview, splitFocused, addTab, openFilePreviewTab]);

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

  return (
    <section className="terminal-pane">
      <div className="terminal-bar">
        <div className="row gap6" style={{ minWidth: 0 }}>
          <span className="term-brand">TERMINAL</span>
          <button className="link" onClick={onOpenProject}>打开项目</button>
          {activeTab?.kind === "terminal" && activeTab.root && paneCount(activeTab.root) > 1 && (
            <span className="term-pane-count">{paneCount(activeTab.root)} 窗格</span>
          )}
          {activeUrl && (
            <button className="link" title={activeUrl} onClick={() => openPreview(activeUrl)}>
              打开预览 {portOf(activeUrl)}
            </button>
          )}
        </div>
        <div className="row gap4">
          {zoom !== 0 && activeTab?.kind === "terminal" && (
            <button className="term-zoom-chip" onClick={() => setZoom(0)}>{fontSize}px</button>
          )}
          <button
            className="term-icon-btn"
            title="在终端中查找（⌘F）"
            aria-label="查找"
            disabled={!activePane}
            onClick={() => {
              if (!activePane) return;
              setSearchPaneId((cur) => (cur === activePane.id ? null : activePane.id));
            }}
          >
            <SearchIcon size={14} />
          </button>
          <select
            className="agent-launch"
            value=""
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
          <button className="btn tiny-btn" onClick={showPreview}>＋ 预览</button>
          <button className="btn tiny-btn" onClick={newTerminal}>＋ 终端</button>
          {onCollapse && (
            <button className="pane-collapse dark" title="收起终端" aria-label="收起终端" onClick={onCollapse}>
              <PanelCollapseIcon size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="term-tabs" ref={tabsRef}>
        {tabs.map((t) => (
          <div
            key={t.id}
            data-tab-id={t.id}
            className={`term-tab ${t.id === active ? "on" : ""} ${t.attention ? "attention" : ""}`}
            title={t.kind === "preview" ? (t.url || "预览") : t.cwd}
            onClick={() => activate(t.id)}
            onDoubleClick={() => { setRenaming(t.id); }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(t.id); } }}
          >
            {t.kind === "file"
              ? <FileVisual name={t.title} size={12} />
              : t.kind === "preview"
                ? <EyeIcon size={12} className="term-tab-icon" />
                : <span className={`dot ${t.attention ? "amber" : t.taskId ? "green" : "slate"}`} />}
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
              <span className="ellipsis">{t.title || (t.kind === "preview" ? "预览" : "终端")}</span>
            )}
            <span className="term-close" onClick={(e) => { e.stopPropagation(); close(t.id); }}>×</span>
          </div>
        ))}
        <button className="term-tab add" title="新建终端" onClick={newTerminal}>＋</button>
      </div>
      <div className="term-body">
        {tabs.map((t) => {
          if (t.kind === "file") {
            const html = ["html", "htm"].includes(extOf(t.title));
            return (
              <div key={t.id} className="term-tab-surface" style={{ display: t.id === active ? "flex" : "none" }}>
                {html ? (
                  <PreviewSurface
                    mode="file"
                    file={{ name: t.title, rel: t.rel || "", root: t.rootDir }}
                    onClose={() => close(t.id)}
                    onPicked={onPickedContext}
                  />
                ) : (
                  <FilePreviewPane
                    name={t.title}
                    rel={t.rel || ""}
                    root={t.rootDir}
                    onClose={() => close(t.id)}
                    onPicked={onPickedContext}
                  />
                )}
              </div>
            );
          }
          if (t.kind === "preview") {
            return (
              <div key={t.id} className="term-tab-surface" style={{ display: t.id === active ? "flex" : "none" }}>
                <PreviewSurface
                  mode="web"
                  url={t.url}
                  root={previewRoot}
                  defaultUrl={previewHomeUrl || "http://localhost:5173/"}
                  autoOpenUrl={previewReq?.url}
                  autoOpenKey={previewReq?.n}
                  onPicked={onPickedContext}
                  onClose={() => close(t.id)}
                />
              </div>
            );
          }
          const focusedId = t.root ? (t.focusedPaneId ?? firstPane(t.root).id) : "";
          const multi = t.root ? paneCount(t.root) > 1 : false;
          return (
            <div key={t.id} className="term-tab-surface" style={{ display: t.id === active ? "flex" : "none" }}>
              {t.root && (
                <SplitSurface
                  node={t.root}
                  focusedId={focusedId}
                  renderPane={(pane) => (
                    <TermTab
                      key={pane.id}
                      pane={pane}
                      multi={multi}
                      visible={t.id === active}
                      focused={focusedId === pane.id}
                      focusToken={focusToken}
                      searchOpen={searchPaneId === pane.id}
                      fontSize={fontSize}
                      scrollback={terminalScrollback}
                      onOpenSearch={() => setSearchPaneId(pane.id)}
                      onCloseSearch={() => setSearchPaneId(null)}
                      onNewTab={newTerminal}
                      onClosePane={() => closeFocusedPane(t.id)}
                      onSplit={splitFocused}
                      onFocusDir={focusDir}
                      onFocus={() => focusPane(t.id, pane.id)}
                      onCycleTab={cycleTab}
                      onGotoTab={(index) => { const target = tabs[index]; if (target) activate(target.id); }}
                      onZoom={(delta) => { if (delta === 0) setZoom(0); else changeZoom(delta); }}
                      onTermId={(termId) => { termToPane.current[termId] = pane.id; patchPane(t.id, pane.id, { terminalId: termId }); }}
                      onUrl={(url) => setUrlByPane((map) => ({ ...map, [pane.id]: url }))}
                      onTitle={(title) => onPaneTitle(t.id, pane.id, title)}
                      onBell={() => { if (t.id !== active) patchTab(t.id, { attention: true }); }}
                    />
                  )}
                  onRatio={(splitId, delta) => changeRatio(t.id, splitId, delta)}
                />
              )}
            </div>
          );
        })}
        {tabs.length === 0 && <div className="pane-empty">没有终端</div>}
      </div>
    </section>
  );
}

/** 拆分树 → 绝对定位的窗格/分隔条（所有窗格保持挂载，拆分不会重建已有 pty） */
type LayoutRect = { x: number; y: number; w: number; h: number };
type PanePlacement = { pane: PaneState; rect: LayoutRect };
type SplitPlacement = { split: Extract<PaneNode, { type: "split" }>; rect: LayoutRect };

function computeLayout(node: PaneNode, rect: LayoutRect, panes: PanePlacement[], splits: SplitPlacement[]) {
  if (node.type === "pane") { panes.push({ pane: node.pane, rect }); return; }
  splits.push({ split: node, rect });
  if (node.dir === "row") {
    const w = rect.w * node.ratio;
    computeLayout(node.a, { ...rect, w }, panes, splits);
    computeLayout(node.b, { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h }, panes, splits);
  } else {
    const h = rect.h * node.ratio;
    computeLayout(node.a, { ...rect, h }, panes, splits);
    computeLayout(node.b, { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h }, panes, splits);
  }
}

function SplitSurface({ node, focusedId, renderPane, onRatio }: {
  node: PaneNode;
  focusedId: string;
  renderPane: (pane: PaneState) => ReactNode;
  onRatio: (splitId: string, delta: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const panes: PanePlacement[] = [];
  const splits: SplitPlacement[] = [];
  computeLayout(node, { x: 0, y: 0, w: 1, h: 1 }, panes, splits);
  return (
    <div className={`term-split-canvas ${panes.length > 1 ? "multi" : ""}`} ref={ref}>
      {panes.map(({ pane, rect }) => (
        <div
          key={pane.id}
          data-pane-id={pane.id}
          className={`term-pane-leaf ${pane.id === focusedId ? "focused" : ""}`}
          style={{
            left: `calc(${rect.x * 100}% + 3px)`,
            top: `calc(${rect.y * 100}% + 3px)`,
            width: `calc(${rect.w * 100}% - 6px)`,
            height: `calc(${rect.h * 100}% - 6px)`,
          }}
        >
          {renderPane(pane)}
        </div>
      ))}
      {splits.map(({ split, rect }) => {
        const style = split.dir === "row"
          ? {
              left: `calc(${(rect.x + rect.w * split.ratio) * 100}% - 3px)`,
              top: `calc(${rect.y * 100}% + 3px)`,
              width: 6,
              height: `calc(${rect.h * 100}% - 6px)`,
            }
          : {
              left: `calc(${rect.x * 100}% + 3px)`,
              top: `calc(${(rect.y + rect.h * split.ratio) * 100}% - 3px)`,
              width: `calc(${rect.w * 100}% - 6px)`,
              height: 6,
            };
        return (
          <div key={split.id} className="term-gutter" style={style}>
            <Splitter
              orientation={split.dir === "row" ? "vertical" : "horizontal"}
              onDelta={(delta) => {
                const el = ref.current;
                if (!el) return;
                const extent = split.dir === "row" ? rect.w * el.clientWidth : rect.h * el.clientHeight;
                onRatio(split.id, delta / Math.max(1, extent - 6));
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

type TermTabProps = {
  pane: PaneState;
  multi: boolean;
  visible: boolean;
  focused: boolean;
  focusToken: number;
  searchOpen: boolean;
  fontSize: number;
  scrollback: number;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onNewTab: () => void;
  onClosePane: () => void;
  onSplit: (dir: SplitDir) => void;
  onFocusDir: (dir: FocusDir) => void;
  onFocus: () => void;
  onCycleTab: (dir: 1 | -1) => void;
  onGotoTab: (index: number) => void;
  onZoom: (delta: number) => void;
  onTermId: (termId: string) => void;
  onUrl: (url: string) => void;
  onTitle: (title: string) => void;
  onBell: () => void;
};

function TermTab({ pane, multi, visible, focused, focusToken, searchOpen, fontSize, scrollback, onOpenSearch, onCloseSearch, onNewTab, onClosePane, onSplit, onFocusDir, onFocus, onCycleTab, onGotoTab, onZoom, onTermId, onUrl, onTitle, onBell }: TermTabProps) {
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
  const onTermIdRef = useRef(onTermId);
  const onUrlRef = useRef(onUrl);
  onTitleRef.current = onTitle;
  onBellRef.current = onBell;
  onTermIdRef.current = onTermId;
  onUrlRef.current = onUrl;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      fontSize, scrollback, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true, convertEol: false,
      allowProposedApi: true,
      rightClickSelectsWord: true,
      scrollOnUserInput: true,
      theme: { background: "#1a1b20", foreground: "#d9dae0", cursor: "#d9dae0", selectionBackground: "#3a3d46" },
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

    // 先按当前容器算一次尺寸：pty 必须按 xterm 的实际 cols/rows 启动，
    // 否则 shell 按默认 120×32 排版，窄面板里的提示符会被折成两行。
    const fitNow = () => {
      if (host.clientWidth < 20 || host.clientHeight < 20) return;
      try { fit.fit(); } catch { /* ignore */ }
    };
    fitNow();

    // 尺寸自适应：拖分隔条 / 拆分 / 收起侧栏 / 窗口缩放都会触发
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
        if (res?.url) onUrlRef.current(res.url);
        ready = true;
        for (const chunk of pending.splice(0)) write(chunk);
        // attach 后再校一次：分辨率与 pty 对齐，让 shell 按当前宽度重绘提示符
        fitNow();
        void window.harness.terminalResize(id, term.cols, term.rows);
        if (res?.exited) {
          setExitCode(typeof res.exitCode === "number" ? res.exitCode : null);
          setExited(true);
        }
        scheduleFit();
      }).catch((err) => {
        if (disposed) return;
        term.write(`\r\n\x1b[31m[无法恢复终端输出] ${String((err as Error)?.message || err)}\x1b[0m\r\n`);
      });
    };

    // 只有首次挂载才复用外部（Agent 启动时）创建的 pty；重启后的 incarnation 要新建
    if (pane.terminalId && incarnation === 0) {
      attach(pane.terminalId);
    } else {
      window.harness.createTerminal(pane.cwd, { cols: term.cols, rows: term.rows }).then(({ id }) => {
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
  }, [pane.id, incarnation]);

  // 标签可见 / 窗格获得焦点时重新 fit，并把焦点交回终端
  useEffect(() => {
    if (!visible || !focused) return;
    const t = setTimeout(() => {
      try { fitRef.current?.fit(); } catch { /* ignore */ }
      if (focusToken > 0) termRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [visible, focused, focusToken]);

  // 拆分 / 拖拽分隔条后容器尺寸变化：ResizeObserver 已覆盖，这里补一次可见性切换
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => { try { fitRef.current?.fit(); } catch { /* ignore */ } }, 40);
    return () => clearTimeout(t);
  }, [visible]);

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
      // 搜索框内保持原生编辑快捷键（xterm 自己的 helper textarea 不算）
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const inSearch = !!el?.closest?.(".term-search");
      if (inSearch || tag === "INPUT" || tag === "SELECT") return;
      if (tag === "TEXTAREA" && !el?.classList.contains("xterm-helper-textarea")) return;
      const key = e.key.toLowerCase();
      const cmd = e.metaKey;                       // macOS ⌘
      const ctrlShift = e.ctrlKey && e.shiftKey;   // Windows / Linux 的替代组合
      const accel = cmd || ctrlShift;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      // 拆分窗格（Orca 风格）
      if (cmd && e.shiftKey && key === "d") { stop(); onSplit("col"); return; }
      if ((cmd && !e.shiftKey && key === "d") || (ctrlShift && key === "d")) { stop(); onSplit("row"); return; }
      if ((cmd || e.ctrlKey) && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        stop();
        onFocusDir(e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : "down");
        return;
      }
      // 查找（⌘F / ⌃⇧F；不抢 shell 的 ⌃F）
      if ((cmd && !e.shiftKey && key === "f") || (ctrlShift && key === "f")) { stop(); onOpenSearch(); return; }
      // 新建标签 / 关闭窗格
      if (accel && !e.shiftKey && key === "t") { stop(); onNewTab(); return; }
      if (accel && !e.shiftKey && key === "w") { stop(); onClosePane(); return; }
      // 标签切换：⌃Tab / ⌘⇧[ ] / ⌘⇧1…9
      if (e.ctrlKey && e.key === "Tab") { stop(); onCycleTab(e.shiftKey ? -1 : 1); return; }
      if (cmd && e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
        stop();
        onCycleTab(e.code === "BracketRight" ? 1 : -1);
        return;
      }
      if (cmd && e.shiftKey && /^Digit[1-9]$/.test(e.code)) { stop(); onGotoTab(Number(e.code.slice(-1)) - 1); return; }
      // 字号缩放
      if (cmd && (e.key === "=" || e.key === "+")) { stop(); onZoom(1); return; }
      if (cmd && (e.key === "-" || e.key === "_")) { stop(); onZoom(-1); return; }
      if (cmd && e.key === "0") { stop(); onZoom(0); return; }
      // 清屏 / 全选 / 复制 / 粘贴（⌃A、⌃C 在 shell 里有含义，不抢）
      if ((cmd && e.shiftKey && key === "k") || (ctrlShift && key === "k")) { stop(); clearScreen(); return; }
      if ((cmd && key === "a") || (ctrlShift && key === "a")) { stop(); selectAll(); return; }
      if ((cmd && key === "c") || (ctrlShift && key === "c")) {
        if (termRef.current?.hasSelection()) { stop(); void copySelection(); }
        return; // 无选区时保留 ^C 给 shell
      }
      // ⌘V 交给 Electron 默认菜单 / xterm 原生粘贴事件，避免与菜单加速键重复粘贴
      if (ctrlShift && key === "v") { stop(); void paste(); return; }
      if (cmd && key === "r" && exited && !pane.command) { stop(); restart(); return; }
      if (e.key === "Escape" && searchOpen) { stop(); onCloseSearch(); }
    };
    wrap.addEventListener("keydown", onKeyDown, true);
    return () => wrap.removeEventListener("keydown", onKeyDown, true);
  }, [searchOpen, onOpenSearch, onCloseSearch, onNewTab, onClosePane, onSplit, onFocusDir, onCycleTab, onGotoTab, onZoom, clearScreen, selectAll, copySelection, paste, exited, pane.command, restart]);

  const menuItems: MenuItem[] = exited
    ? [
        ...(pane.command ? [] : [{ label: "重新启动", hint: "⌘R", run: restart } as MenuItem]),
        { label: "复制", hint: "⌘C", run: () => void copySelection() },
        { label: "关闭窗格", hint: "⌘W", danger: true, run: onClosePane },
      ]
    : [
        { label: "复制", hint: "⌘C", disabled: !termRef.current?.hasSelection(), run: () => void copySelection() },
        { label: "粘贴", hint: "⌘V", run: () => void paste() },
        { label: "全选", hint: "⌘A", run: selectAll },
        "sep",
        { label: "查找…", hint: "⌘F", run: onOpenSearch },
        { label: "清屏", hint: "⇧⌘K", run: clearScreen },
        "sep",
        { label: "向右拆分", hint: "⌘D", run: () => onSplit("row") },
        { label: "向下拆分", hint: "⇧⌘D", run: () => onSplit("col") },
        "sep",
        { label: "新建终端", hint: "⌘T", run: onNewTab },
        { label: multi ? "关闭窗格" : "关闭标签", hint: "⌘W", run: onClosePane },
      ];

  return (
    <div
      className="term-instance"
      ref={wrapRef}
      onMouseDown={() => { if (!focused) onFocus(); }}
      onContextMenu={(e) => {
        e.preventDefault();
        onFocus();
        termRef.current?.focus();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="term-host" ref={hostRef} onClick={() => { onFocus(); focusTerm(); }} />
      {searchOpen && searchAddon && <TermSearch addon={searchAddon} onClose={onCloseSearch} />}
      {!searchOpen && (
        <div className={`term-pane-actions ${multi ? "" : "single"}`}>
          <button title="向右拆分（⌘D）" aria-label="向右拆分" onClick={() => onSplit("row")}><SplitRightIcon size={12} /></button>
          <button title="向下拆分（⇧⌘D）" aria-label="向下拆分" onClick={() => onSplit("col")}><SplitDownIcon size={12} /></button>
        </div>
      )}
      {scrolledUp && !exited && (
        <button className="term-jump-bottom" title="回到最新输出" aria-label="回到最新输出" onClick={scrollToBottom}>
          <ChevronDownIcon size={14} />
        </button>
      )}
      {exited && (
        <div className="term-exited">
          <span>进程已退出{exitCode !== null && exitCode !== 0 ? ` · code ${exitCode}` : ""}</span>
          <div className="row gap8">
            {!pane.command && <button className="btn tiny-btn" onClick={restart}>重新启动</button>}
            <button className="link" onClick={onClosePane}>关闭窗格</button>
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
      <button title="关闭（Esc）" onClick={() => onClose()}><XIcon size={13} /></button>
    </div>
  );
}
