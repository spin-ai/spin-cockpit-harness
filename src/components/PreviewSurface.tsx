import { useEffect, useMemo, useRef, useState } from "react";
import type { ElementContext } from "../types";
import { CopyIcon, RefreshIcon, RevealIcon, XIcon } from "./Icons";
import { FileVisual, extOf } from "./FileVisual";

// Electron <webview>：独立进程、无 preload；本地 HTML 用 file://，dev server 用 http(s)
const Webview: any = "webview";

type FileInfo = { name: string; rel: string; root?: string };
type Loaded = { text?: string; error?: string; size?: number };

function normalizeUrl(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`;
}

/**
 * 统一预览表面：
 * - mode=web：地址栏 + dev server/webview + 刷新 + 拾取
 * - mode=file：本地 HTML，路径栏 + 渲染/源码 + webview + 拾取 + Finder/复制
 * 同一个 HTML 标签只保留一个 webview；渲染/源码切换与切标签都不重建。
 */
export function PreviewSurface({ mode, file, url, defaultUrl = "http://localhost:5173/", autoOpenUrl, autoOpenKey, root, onPicked, onClose }: {
  mode: "web" | "file";
  file?: FileInfo;
  url?: string;
  defaultUrl?: string;
  autoOpenUrl?: string;
  autoOpenKey?: number;
  root?: string;
  onPicked?: (ctx: ElementContext) => void;
  onClose?: () => void;
}) {
  const isFile = mode === "file";
  const isHtml = isFile && Boolean(file && ["html", "htm"].includes(extOf(file.name)));
  const abs = useMemo(() => (file?.root ? `${file.root.replace(/[\\/]+$/, "")}/${file.rel}` : ""), [file?.root, file?.rel]);
  const fileUrl = useMemo(() => (abs ? `file://${encodeURI(abs)}` : ""), [abs]);
  const initialWeb = normalizeUrl(url || autoOpenUrl || defaultUrl);

  const [input, setInput] = useState(isFile ? file?.rel || "" : url || autoOpenUrl || defaultUrl);
  const [webSrc, setWebSrc] = useState(initialWeb);
  const [fileMode, setFileMode] = useState<"render" | "source">("render");
  const [data, setData] = useState<Loaded | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ElementContext | null>(null);
  const [pickError, setPickError] = useState("");
  const viewRef = useRef<any>(null);
  const wcIdRef = useRef<number | null>(null);
  const fileKeyRef = useRef("");

  const src = isFile ? fileUrl : webSrc;
  const renderWebview = Boolean(src) && (!isFile || fileMode === "render" || isHtml);
  // HTML 文件即使源码模式也保留 webview，切回来不重新加载
  const showWebview = !isFile || !isHtml || fileMode === "render";

  // web：地址栏/自动打开发生变化时导航
  useEffect(() => {
    if (isFile || !autoOpenUrl) return;
    const next = normalizeUrl(autoOpenUrl);
    setInput(autoOpenUrl);
    setWebSrc(next);
  }, [isFile, autoOpenUrl, autoOpenKey]);

  // file：读源码（渲染 HTML 也读，供源码切换和刷新）
  useEffect(() => {
    if (!isFile || !file) { setData(null); return; }
    const key = `${file.root || ""}\n${file.rel}`;
    let alive = true;
    if (fileKeyRef.current !== key) { fileKeyRef.current = key; setData(null); }
    window.harness.filesRead(file.rel, file.root)
      .then((res) => { if (alive) { setData(res); setError(""); } })
      .catch((e) => { if (alive) setError(String((e as Error)?.message || e)); });
    return () => { alive = false; };
  }, [isFile, file?.rel, file?.root, nonce]);

  // webview 生命周期：同一 src 只挂载一次；刷新用 reload，不换 key
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !src) { setReady(false); wcIdRef.current = null; return; }
    const readyNow = () => {
      try { wcIdRef.current = el.getWebContentsId(); setReady(true); return true; } catch { return false; }
    };
    const onReady = () => { readyNow(); };
    const onFail = () => { setReady(false); setError("页面加载失败"); };
    el.addEventListener("dom-ready", onReady);
    el.addEventListener("did-fail-load", onFail);
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (readyNow() || tries > 50) window.clearInterval(timer);
    }, 200);
    readyNow();
    return () => {
      window.clearInterval(timer);
      el.removeEventListener("dom-ready", onReady);
      el.removeEventListener("did-fail-load", onFail);
      wcIdRef.current = null;
      setReady(false);
      setPicking(false);
      setPicked(null);
      setPickError("");
    };
  }, [src]);

  // 从渲染切到源码时退出拾取
  useEffect(() => {
    if (isFile && fileMode === "source" && picking) {
      const id = wcIdRef.current;
      if (id) void window.harness.previewCancel(id).catch(() => {});
      setPicking(false);
    }
  }, [isFile, fileMode, picking]);

  const open = () => {
    if (isFile) return;
    const next = normalizeUrl(input);
    if (!next) return;
    setError("");
    setPicked(null);
    if (next === webSrc) {
      try { viewRef.current?.reload(); } catch { /* ignore */ }
      return;
    }
    setWebSrc(next);
  };

  const refresh = () => {
    setNonce((n) => n + 1);
    setError("");
    if (viewRef.current) { try { viewRef.current.reload(); } catch { /* ignore */ } }
  };

  const pickElement = async () => {
    const id = wcIdRef.current;
    if (!id) { setPickError("页面还没加载完成"); return; }
    setPicking(true);
    setPickError("");
    setPicked(null);
    try {
      const ctx = await window.harness.previewPick(id, isFile ? file?.root : root);
      setPicked(ctx);
      onPicked?.(ctx);
    } catch (e) {
      setPickError(String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ""));
    } finally {
      setPicking(false);
    }
  };

  const cancelPick = async () => {
    const id = wcIdRef.current;
    if (id) await window.harness.previewCancel(id).catch(() => {});
    setPicking(false);
  };

  const reveal = async () => {
    if (!file) return;
    try { await window.harness.filesReveal(file.rel, file.root); } catch { /* ignore */ }
  };
  const copyPath = async () => {
    if (!file) return;
    try { await window.harness.clipboardWrite(file.rel); } catch { /* ignore */ }
  };

  const canPick = Boolean(src) && (!isFile || fileMode === "render");

  return (
    <div className="preview-surface">
      <div className="preview-surface-bar">
        <div className="preview-surface-address-row">
          {isFile && file && <FileVisual name={file.name} size={14} />}
          <input
            className="preview-surface-address"
            value={isFile ? file?.rel || "" : input}
            readOnly={isFile}
            title={isFile ? fileUrl : undefined}
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (!isFile && e.key === "Enter") { e.preventDefault(); open(); } }}
            placeholder="http://localhost:5173"
          />
          {!isFile && <button className="btn tiny-btn" onClick={open}>打开</button>}
        </div>
        <div className="preview-surface-actions">
          {isFile && isHtml && (
            <div className="file-preview-seg" role="group" aria-label="预览模式">
              <button className={fileMode === "render" ? "on" : ""} onClick={() => setFileMode("render")}>渲染</button>
              <button className={fileMode === "source" ? "on" : ""} onClick={() => setFileMode("source")}>源码</button>
            </div>
          )}
          {canPick && (picking
            ? <button className="btn tiny-btn danger" onClick={() => void cancelPick()}>取消拾取</button>
            : <button className="btn tiny-btn primary" disabled={!ready} title="在页面里点选元素，注入 Chat" onClick={() => void pickElement()}>拾取元素</button>
          )}
          <button className="icon-btn" title="刷新" aria-label="刷新" onClick={refresh}><RefreshIcon size={13} /></button>
          {isFile && (
            <>
              <button className="icon-btn" title="在 Finder 中显示" aria-label="在 Finder 中显示" onClick={() => void reveal()}><RevealIcon size={13} /></button>
              <button className="icon-btn" title="复制相对路径" aria-label="复制相对路径" onClick={() => void copyPath()}><CopyIcon size={13} /></button>
            </>
          )}
          {onClose && <button className="icon-btn" title="关闭预览" aria-label="关闭预览" onClick={onClose}><XIcon size={13} /></button>}
        </div>
      </div>
      {picking && <div className="preview-hint">点击页面中的元素；Esc 或「取消拾取」退出</div>}
      {picked && !picking && (
        <div className="preview-hint picked">
          已拾取 <span className="mono">{picked.selector}</span>
          {picked.source?.file && <span className="mono faint"> · {picked.source.file}{picked.source.line ? `:${picked.source.line}` : ""}</span>}
          <span className="faint"> · 已放入 Chat 输入框</span>
        </div>
      )}
      {(error || pickError) && <div className="preview-error">{error || pickError}</div>}
      <div className={`preview-surface-body${showWebview ? " frame" : ""}`}>
        {isFile && isHtml && fileMode === "source" && (
          data?.error ? <div className="preview-error">{data.error}</div>
            : data?.text != null ? <pre className="file-preview-text">{data.text}</pre>
              : <div className="pane-empty">加载中…</div>
        )}
        {renderWebview && (
          <div className="preview-surface-frame" style={{ display: showWebview ? "flex" : "none" }}>
            <Webview
              ref={viewRef}
              key={src}
              src={src}
              partition="preview"
              webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
            />
          </div>
        )}
        {!src && <div className="pane-empty">输入地址后点「打开」。</div>}
      </div>
    </div>
  );
}
