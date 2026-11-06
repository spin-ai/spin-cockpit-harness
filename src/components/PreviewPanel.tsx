import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ElementContext } from "../types";
import { ChevronRightIcon, DevtoolsIcon, ExternalIcon, RefreshIcon, SearchIcon, XIcon } from "./Icons";

// Electron <webview>：独立进程、无 preload，页面拿不到 window.harness
const Webview: any = "webview";

const RECENT_KEY = "cmh.preview.recent";
const DEVICE_WIDTH = { auto: 0, tablet: 834, mobile: 390 } as const;
type Device = keyof typeof DEVICE_WIDTH;

function normalizeUrl(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`;
}

/**
 * 前端预览 + 元素拾取（CDP inspect）。
 * 拾取结果交给上层插入 Chat composer，随消息注入当前会话。
 * 设计：docs/ARCH-ui-context.md
 */
export function PreviewPanel({ onPicked, root, defaultUrl = "http://localhost:5173/", autoOpenUrl, autoOpenKey, hidden = false }: {
  onPicked: (ctx: ElementContext) => void;
  root?: string;
  defaultUrl?: string;
  autoOpenUrl?: string;
  autoOpenKey?: number;
  hidden?: boolean;
}) {
  const initial = autoOpenUrl || defaultUrl;
  const [input, setInput] = useState(initial);
  const [src, setSrc] = useState(autoOpenUrl ? normalizeUrl(autoOpenUrl) : "");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ElementContext | null>(null);
  const [zoom, setZoom] = useState(1);
  const [device, setDevice] = useState<Device>("auto");
  const [findOpen, setFindOpen] = useState(false);
  const [grapeBusy, setGrapeBusy] = useState(false);
  const [findText, setFindText] = useState("");
  const [findResult, setFindResult] = useState<{ active: number; total: number } | null>(null);
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, 20) : [];
    } catch {
      return [];
    }
  });
  const viewRef = useRef<any>(null);
  const wcIdRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  const viewportWidth = DEVICE_WIDTH[device];
  const recentId = useMemo(() => "preview-url-history", []);

  const remember = useCallback((url: string) => {
    if (!url || url === "about:blank") return;
    setRecent((prev) => {
      const next = [url, ...prev.filter((x) => x !== url)].slice(0, 20);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const syncNav = useCallback(() => {
    const el = viewRef.current;
    if (!el) return;
    try {
      setCanBack(Boolean(el.canGoBack?.()));
      setCanForward(Boolean(el.canGoForward?.()));
    } catch { /* ignore */ }
  }, []);

  // 终端里新发现的 dev server 地址：自动填进地址栏并打开
  useEffect(() => {
    if (!autoOpenUrl) return;
    const url = normalizeUrl(autoOpenUrl);
    setInput(autoOpenUrl);
    setSrc(url);
    remember(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenUrl, autoOpenKey]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el || !src) return;
    const onReady = () => {
      try {
        wcIdRef.current = el.getWebContentsId();
        setReady(true);
      } catch {
        setReady(false);
      }
      setLoading(false);
      syncNav();
    };
    const onStart = () => setLoading(true);
    const onStop = () => { setLoading(false); syncNav(); };
    const onFail = (e: any) => {
      if (e?.isMainFrame === false) return;
      setReady(false);
      setLoading(false);
      setError(`加载失败：${e?.errorDescription || e?.errorCode || "未知错误"}`);
    };
    const onNav = (e: any) => {
      const url = e?.url || el.getURL?.() || "";
      if (url) {
        if (document.activeElement !== inputRef.current) setInput(url);
        remember(url);
      }
      syncNav();
      setFindResult(null);
    };
    const onFound = (e: any) => {
      const r = e?.result;
      setFindResult({ active: Number(r?.activeMatchOrdinal) || 0, total: Number(r?.matches) || 0 });
    };
    el.addEventListener("dom-ready", onReady);
    el.addEventListener("did-start-loading", onStart);
    el.addEventListener("did-stop-loading", onStop);
    el.addEventListener("did-fail-load", onFail);
    el.addEventListener("did-navigate", onNav);
    el.addEventListener("did-navigate-in-page", onNav);
    el.addEventListener("found-in-page", onFound);
    return () => {
      el.removeEventListener("dom-ready", onReady);
      el.removeEventListener("did-start-loading", onStart);
      el.removeEventListener("did-stop-loading", onStop);
      el.removeEventListener("did-fail-load", onFail);
      el.removeEventListener("did-navigate", onNav);
      el.removeEventListener("did-navigate-in-page", onNav);
      el.removeEventListener("found-in-page", onFound);
      const id = wcIdRef.current;
      wcIdRef.current = null;
      setReady(false);
      if (id) void window.harness.previewDetach(id).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    try { viewRef.current?.setZoomFactor?.(zoom); } catch { /* ignore */ }
  }, [zoom]);

  useEffect(() => {
    if (!findOpen) return;
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [findOpen]);

  useEffect(() => {
    if (!findOpen) return;
    const text = findText.trim();
    const timer = window.setTimeout(() => {
      if (!text) {
        try { viewRef.current?.stopFindInPage?.("clearSelection"); } catch { /* ignore */ }
        setFindResult(null);
        return;
      }
      try { viewRef.current?.findInPage?.(text, { forward: true, findNext: false }); } catch { /* ignore */ }
    }, 140);
    return () => window.clearTimeout(timer);
  }, [findText, findOpen]);

  const open = (raw = input) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    setError(null);
    setLast(null);
    setFindResult(null);
    if (picking) void cancel();
    if (url === src) {
      try { viewRef.current?.reload(); } catch { /* ignore */ }
      return;
    }
    setSrc(url);
    setInput(url);
    remember(url);
  };

  const reload = (hard = false) => {
    try {
      if (hard) viewRef.current?.reloadIgnoringCache?.();
      else viewRef.current?.reload?.();
    } catch { /* ignore */ }
  };

  const stop = () => {
    try { viewRef.current?.stop?.(); } catch { /* ignore */ }
  };

  const go = (dir: "goBack" | "goForward") => {
    try { viewRef.current?.[dir]?.(); } catch { /* ignore */ }
  };

  const pick = async () => {
    const id = wcIdRef.current;
    if (!id) { setError("预览页还没加载完成"); return; }
    setPicking(true);
    setError(null);
    try {
      const ctx = await window.harness.previewPick(id, root);
      setLast(ctx);
      onPicked(ctx);
    } catch (e) {
      const msg = String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
      setError(msg);
    } finally {
      setPicking(false);
    }
  };

  const cancel = async () => {
    const id = wcIdRef.current;
    if (id) await window.harness.previewCancel(id).catch(() => {});
    setPicking(false);
  };

  const find = (forward: boolean) => {
    const text = findText.trim();
    if (!text) return;
    try { viewRef.current?.findInPage?.(text, { forward, findNext: true }); } catch { /* ignore */ }
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindText("");
    setFindResult(null);
    try { viewRef.current?.stopFindInPage?.("clearSelection"); } catch { /* ignore */ }
  };

  const openExternal = () => {
    const url = viewRef.current?.getURL?.() || src;
    if (url) void window.harness.openExternal(url);
  };

  const openGrape = async () => {
    setGrapeBusy(true);
    setError(null);
    try {
      const res = await window.harness.ensureGrape();
      if (res?.url) open(res.url);
      else setError("Grape 启动失败");
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setGrapeBusy(false);
    }
  };

  const toggleDevtools = () => {
    const el = viewRef.current;
    if (!el) return;
    try {
      if (el.isDevToolsOpened?.()) el.closeDevTools?.();
      else el.openDevTools?.();
    } catch { /* ignore */ }
  };

  return (
    <div className="preview-panel" style={hidden ? { display: "none" } : undefined}>
      <div className="preview-bar">
        <div className="preview-row">
          <button className="preview-icon" title="后退" disabled={!canBack} onClick={() => go("goBack")}>
            <ChevronRightIcon size={13} className="rot-180" />
          </button>
          <button className="preview-icon" title="前进" disabled={!canForward} onClick={() => go("goForward")}>
            <ChevronRightIcon size={13} />
          </button>
          <button
            className="preview-icon"
            title={loading ? "停止加载" : "刷新（按住 Shift 硬刷新）"}
            onClick={(e) => (loading ? stop() : reload(e.shiftKey))}
          >
            {loading ? <XIcon size={13} /> : <RefreshIcon size={13} />}
          </button>
          <input
            ref={inputRef}
            className="preview-url"
            value={input}
            list={recentId}
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); open(); } }}
            placeholder="http://localhost:5173"
          />
          <datalist id={recentId}>{recent.map((url) => <option key={url} value={url} />)}</datalist>
          <button className="preview-icon" title="在系统浏览器打开" onClick={openExternal}>
            <ExternalIcon size={13} />
          </button>
        </div>

        <div className="preview-row preview-tools">
          <select className="preview-device" value={device} onChange={(e) => setDevice(e.target.value as Device)} title="设备宽度">
            <option value="auto">自适应</option>
            <option value="tablet">平板 834</option>
            <option value="mobile">手机 390</option>
          </select>
          <div className="preview-zoom">
            <button title="缩小" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}>−</button>
            <button className="preview-zoom-value" title="重置缩放" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
            <button title="放大" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))}>＋</button>
          </div>
          <button className={`preview-icon ${findOpen ? "on" : ""}`} title="页内查找" disabled={!ready} onClick={() => setFindOpen((v) => !v)}>
            <SearchIcon size={13} />
          </button>
          <button className="preview-icon" title="开发者工具" disabled={!ready} onClick={toggleDevtools}>
            <DevtoolsIcon size={13} />
          </button>
          <button className="btn tiny-btn" disabled={grapeBusy} onClick={() => void openGrape()} title="打开 spin-grape-html 可视化编辑器">
            {grapeBusy ? "Grape…" : "Grape"}
          </button>
          <span style={{ flex: 1 }} />
          {picking
            ? <button className="btn tiny-btn danger" onClick={() => void cancel()}>取消拾取</button>
            : <button className="btn tiny-btn primary" disabled={!ready} onClick={() => void pick()}>拾取元素</button>}
        </div>
      </div>

      {findOpen && (
        <div className="preview-find">
          <SearchIcon size={12} />
          <input
            ref={findInputRef}
            value={findText}
            spellCheck={false}
            placeholder="在页面中查找"
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); find(!e.shiftKey); }
              if (e.key === "Escape") { e.preventDefault(); closeFind(); }
            }}
          />
          <span className="preview-find-count">{findResult ? `${findResult.active}/${findResult.total}` : "0/0"}</span>
          <button className="preview-icon" title="上一个（Shift+Enter）" onClick={() => find(false)}>↑</button>
          <button className="preview-icon" title="下一个（Enter）" onClick={() => find(true)}>↓</button>
          <button className="preview-icon" title="关闭" onClick={closeFind}><XIcon size={12} /></button>
        </div>
      )}

      {error && <div className="preview-error">{error}</div>}
      {picking && <div className="preview-hint">点击元素选择 · Esc 取消</div>}
      {last && !picking && (
        <div className="preview-hint picked">
          已拾取 <span className="mono">{last.selector}</span>
          {last.source?.file && <span className="mono faint"> · {last.source.file}{last.source.line ? `:${last.source.line}` : ""}</span>}
        </div>
      )}

      <div className="preview-frame">
        {src ? (
          <div className={`preview-viewport ${device}`} style={viewportWidth ? { width: viewportWidth } : undefined}>
            <Webview
              ref={viewRef}
              src={src}
              partition="preview"
              webpreferences="contextIsolation=yes,nodeIntegration=no"
              style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
            />
          </div>
        ) : (
          <div className="pane-empty">输入 dev server 地址后打开</div>
        )}
      </div>
    </div>
  );
}
