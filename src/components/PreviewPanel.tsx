import { useEffect, useRef, useState } from "react";
import type { ElementContext } from "../types";

// Electron <webview>：独立进程、无 preload，页面拿不到 window.harness
const Webview: any = "webview";

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
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ElementContext | null>(null);
  const viewRef = useRef<any>(null);
  const wcIdRef = useRef<number | null>(null);

  // 终端里新发现的 dev server 地址：自动填进地址栏并打开
  useEffect(() => {
    if (!autoOpenUrl) return;
    setInput(autoOpenUrl);
    setSrc(normalizeUrl(autoOpenUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenUrl, autoOpenKey]);

  useEffect(() => {
    const el = viewRef.current;
    if (!el || !src) return;
    const onReady = () => {
      try {
        const id = el.getWebContentsId();
        wcIdRef.current = id;
        setReady(true);
      } catch {
        setReady(false);
      }
    };
    const onFail = (e: any) => {
      setReady(false);
      setError(`加载失败：${e?.errorDescription || e?.errorCode || "未知错误"}`);
    };
    el.addEventListener("dom-ready", onReady);
    el.addEventListener("did-fail-load", onFail);
    return () => {
      el.removeEventListener("dom-ready", onReady);
      el.removeEventListener("did-fail-load", onFail);
      const id = wcIdRef.current;
      wcIdRef.current = null;
      setReady(false);
      if (id) void window.harness.previewDetach(id).catch(() => {});
    };
  }, [src]);

  const open = () => {
    const url = normalizeUrl(input);
    if (!url) return;
    setError(null);
    setLast(null);
    if (src === url) {
      try { viewRef.current?.reload(); } catch { /* ignore */ }
      return;
    }
    setSrc(url);
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

  return (
    <div className="preview-panel" style={hidden ? { display: "none" } : undefined}>
      <div className="preview-bar">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); open(); } }}
          placeholder="http://localhost:5173"
          spellCheck={false}
        />
        <button className="btn tiny-btn" onClick={open}>打开</button>
        <button className="btn tiny-btn" disabled={!ready} onClick={() => { try { viewRef.current?.reload(); } catch { /* ignore */ } }}>刷新</button>
        {picking
          ? <button className="btn tiny-btn danger" onClick={() => void cancel()}>取消拾取</button>
          : <button className="btn tiny-btn primary" disabled={!ready} onClick={() => void pick()}>拾取元素</button>}
      </div>

      {error && <div className="preview-error">{error}</div>}
      {picking && <div className="preview-hint">点击页面中的元素；Esc 取消</div>}
      {last && !picking && (
        <div className="preview-hint picked">
          已拾取 <span className="mono">{last.selector}</span>
          {last.source?.file && <span className="mono faint"> · {last.source.file}{last.source.line ? `:${last.source.line}` : ""}</span>}
          <span className="faint"> · 已放入 Chat 输入框</span>
        </div>
      )}

      <div className="preview-frame">
        {src ? (
          <Webview
            ref={viewRef}
            src={src}
            partition="preview"
            webpreferences="contextIsolation=yes,nodeIntegration=no"
            style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
          />
        ) : (
          <div className="pane-empty">
            输入本机 dev server 地址（例如 <span className="mono">http://localhost:5173</span>）后点「打开」。
            <br />Agent 起的前端在它自己的 worktree 里跑，用终端里打印的端口。
          </div>
        )}
      </div>
    </div>
  );
}
