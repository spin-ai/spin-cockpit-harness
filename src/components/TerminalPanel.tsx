import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ElementContext, State, Todo } from "../types";
import { PreviewPanel } from "./PreviewPanel";
import { PanelCollapseIcon } from "./Icons";

type Tab = { id: string; cwd: string; title: string; taskId?: string; terminalId?: string; agentId?: string };
type Mode = "terminal" | "preview";

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
  const termToTab = useRef<Record<string, string>>({});
  const seq = useRef(1);

  // 终端里打印出 dev server 地址 → 记住并给出「打开预览」入口
  useEffect(() => window.harness.onTerminalUrl(({ id, url }) => {
    const tabId = termToTab.current[id];
    if (tabId) setUrlByTab((map) => ({ ...map, [tabId]: url }));
  }), []);

  const addTab = (cwd: string, title: string, taskId?: string, terminalId?: string, agentId?: string) => {
    const tab: Tab = { id: `t${seq.current++}`, cwd, title, taskId, terminalId, agentId };
    setTabs((list) => [...list, tab]);
    setActive(tab.id);
    return tab;
  };

  // one terminal per opened project (a new tab when the project changes)
  const lastProject = useRef("");
  useEffect(() => {
    if (lastProject.current === state.projectPath) return;
    lastProject.current = state.projectPath;
    addTab(state.projectPath, basename(state.projectPath));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.projectPath]);

  // task selection focuses/creates that task's terminal
  useEffect(() => {
    if (!todo) return;
    setTabs((list) => {
      const existing = list.find((t) => t.taskId === todo.id);
      if (existing) { setActive(existing.id); return list; }
      const tab: Tab = { id: `t${seq.current++}`, cwd: todo.cwd || state.projectPath, title: `${todo.key} ${todo.title}`, taskId: todo.id };
      setActive(tab.id);
      return [...list, tab];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo?.id]);

  useEffect(() => {
    const onNew = () => addTab(state.projectPath, basename(state.projectPath));
    const onClose = () => { if (active) close(active); };
    window.addEventListener("harness:new-terminal", onNew);
    window.addEventListener("harness:close-terminal", onClose);
    return () => { window.removeEventListener("harness:new-terminal", onNew); window.removeEventListener("harness:close-terminal", onClose); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state.projectPath]);

  const close = (id: string) => {
    setTabs((list) => {
      const next = list.filter((t) => t.id !== id);
      if (active === id) setActive(next.at(-1)?.id ?? null);
      return next;
    });
  };

  const activeUrl = active ? urlByTab[active] : undefined;

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
          <select
            className="agent-launch"
            value=""
            title="在项目终端启动 Agent"
            onChange={async (e) => {
              const command = e.target.value;
              if (!command) return;
              const res = await window.harness.createTerminal(state.projectPath, { command, projectId: state.activeProjectId ?? undefined });
              const agent = res.agent as { alias?: string; id?: string } | undefined;
              setMode("terminal");
              addTab(state.projectPath, `@${agent?.alias || command}`, undefined, res.id, agent?.id);
            }}
          >
            <option value="">＋ Agent</option>
            {(state.cliCapabilities || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn tiny-btn" onClick={() => { setMode("terminal"); addTab(state.projectPath, basename(state.projectPath)); }}>＋ 终端</button>
          {onCollapse && (
            <button className="pane-collapse dark" title="收起终端" aria-label="收起终端" onClick={onCollapse}>
              <PanelCollapseIcon size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="term-tabs" style={{ display: mode === "terminal" ? "flex" : "none" }}>
        {tabs.map((t) => (
          <button key={t.id} className={`term-tab ${t.id === active ? "on" : ""}`} onClick={() => setActive(t.id)} title={t.cwd}>
            <span className={`dot ${t.taskId ? "green" : "slate"}`} />
            <span className="ellipsis">{t.title}</span>
            <span className="term-close" onClick={(e) => { e.stopPropagation(); close(t.id); }}>×</span>
          </button>
        ))}
        <button className="term-tab add" onClick={() => addTab(state.projectPath, basename(state.projectPath))}>＋</button>
      </div>
      <div className="term-body" style={{ display: mode === "terminal" ? "block" : "none" }}>
        {tabs.map((t) => (
          <TermTab key={t.id} tab={t} active={t.id === active} fontSize={terminalFontSize} scrollback={terminalScrollback} onTermId={(termId) => { termToTab.current[termId] = t.id; }} />
        ))}
        {tabs.length === 0 && <div className="pane-empty">没有终端</div>}
      </div>
      <PreviewPanel hidden={mode !== "preview"} onPicked={onPickedContext} root={previewRoot} defaultUrl={previewHomeUrl || "http://localhost:5173/"} autoOpenUrl={previewReq?.url} autoOpenKey={previewReq?.n} />
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

function TermTab({ tab, active, onTermId, fontSize = 12, scrollback = 5000 }: { tab: Tab; active: boolean; onTermId?: (termId: string) => void; fontSize?: number; scrollback?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontSize, scrollback, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true, convertEol: false,
      theme: { background: "#101012", foreground: "#d4d4d8", cursor: "#d4d4d8", selectionBackground: "#3f3f46" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    if (active) fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let termId = "";
    let off = () => {};
    let disposed = false;
    if (tab.terminalId) {
      termId = tab.terminalId;
      onTermId?.(termId);
      off = window.harness.onTerminalData(({ id: incoming, data }) => {
        if (incoming === termId) term.write(data);
      });
      if (active) { try { fit.fit(); } catch { /* ignore */ } }
    } else {
      window.harness.createTerminal(tab.cwd).then(({ id }) => {
        if (disposed) { void window.harness.closeTerminal(id); return; }
        termId = id;
        onTermId?.(id);
        off = window.harness.onTerminalData(({ id: incoming, data }) => {
          if (incoming === termId) term.write(data);
        });
        if (active) { try { fit.fit(); } catch { /* ignore */ } }
      });
    }
    const sub = term.onData((data) => { if (termId) void window.harness.terminalInput(termId, data); });
    term.onResize(({ cols, rows }) => { if (termId) void window.harness.terminalResize(termId, cols, rows); });

    return () => {
      disposed = true;
      sub.dispose(); off();
      if (termId) void window.harness.closeTerminal(termId);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => { try { fitRef.current?.fit(); } catch { /* ignore */ } }, 30);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    try { fitRef.current?.fit(); } catch { /* ignore */ }
  }, [fontSize]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.scrollback = scrollback;
  }, [scrollback]);

  return <div className="term-instance" style={{ display: active ? "block" : "none" }} ref={hostRef} />;
}
