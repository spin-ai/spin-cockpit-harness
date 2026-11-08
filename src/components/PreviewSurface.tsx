import { useEffect, useMemo, useRef, useState } from "react";
import type { ElementContext } from "../types";
import { ChevronRightIcon, CopyIcon, DevtoolsIcon, ExternalIcon, ListIcon, RefreshIcon, RevealIcon, SearchIcon, XIcon } from "./Icons";
import { FileVisual, extOf } from "./FileVisual";
import { renderMarkdown, slugifyHeading } from "../markdown";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
import { requestFilePreview } from "../terminal-events";
import { lazy, Suspense } from "react";
import type { VisualEditorApi } from "./HtmlVisualEditor";

// GrapesJS 体积大：只在第一次打开「可视化」时加载
const HtmlVisualEditor = lazy(() => import("./HtmlVisualEditor").then((m) => ({ default: m.HtmlVisualEditor })));

// Electron <webview>：独立进程、无 preload；本地 HTML 用 file://，dev server 用 http(s)
const Webview: any = "webview";

type FileInfo = { name: string; rel: string; root?: string };
type Loaded = { text?: string; error?: string; size?: number };
type Device = "auto" | "tablet" | "mobile";
const VIEWPORT: Record<Device, number | null> = { auto: null, tablet: 834, mobile: 390 };

function normalizeUrl(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`;
}

/** 把 Markdown 里的相对链接解析成相对项目根的路径（支持 ../） */
function resolveRel(baseRel: string, href: string) {
  const baseDir = baseRel.includes("/") ? baseRel.slice(0, baseRel.lastIndexOf("/")) : "";
  const parts = (href.startsWith("/") ? href.slice(1) : `${baseDir}/${href}`).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/**
 * 统一预览表面：
 * - mode=web：地址栏 + dev server/webview + 刷新 + 拾取
 * - mode=file：本地 HTML，路径栏 + 渲染/源码 + webview + 拾取 + Finder/复制
 * 同一个 HTML 标签只保留一个 webview；渲染/源码切换与切标签都不重建。
 */
export function PreviewSurface({ mode, file, url, defaultUrl = "http://localhost:5173/", autoOpenUrl, autoOpenKey, root, active = true, onOpenUrl, onPicked, onClose }: {
  mode: "web" | "file";
  file?: FileInfo;
  url?: string;
  defaultUrl?: string;
  autoOpenUrl?: string;
  autoOpenKey?: number;
  root?: string;
  /** 只有当前可见的预览才允许拾取元素 */
  active?: boolean;
  /** 文件模式下切到地址模式（同一个预览标签） */
  onOpenUrl?: (url: string) => void;
  onPicked?: (ctx: ElementContext) => void;
  onClose?: () => void;
}) {
  const isFile = mode === "file";
  const ext = file ? extOf(file.name) : "";
  const isHtml = isFile && ["html", "htm"].includes(ext);
  const isMarkdown = isFile && ["md", "markdown"].includes(ext);
  const isImage = isFile && ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext);
  const abs = useMemo(() => (file?.root ? `${file.root.replace(/[\\/]+$/, "")}/${file.rel}` : ""), [file?.root, file?.rel]);
  const fileUrl = useMemo(() => (abs ? `file://${encodeURI(abs)}` : ""), [abs]);
  const initialWeb = normalizeUrl(url || autoOpenUrl || defaultUrl);

  const [input, setInput] = useState(isFile ? file?.rel || "" : url || autoOpenUrl || defaultUrl);
  const [webSrc, setWebSrc] = useState(initialWeb);
  const [fileMode, setFileMode] = useState<"render" | "source" | "visual">("render");
  const [data, setData] = useState<Loaded | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ElementContext | null>(null);
  const [pickError, setPickError] = useState("");
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [device, setDevice] = useState<Device>("auto");
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [findResult, setFindResult] = useState<{ active: number; total: number } | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const viewRef = useRef<any>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const wcIdRef = useRef<number | null>(null);
  const fileKeyRef = useRef("");
  // 源码 / 编辑模式：草稿 + 脏标记 + 保存（⌘S）
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const visualApiRef = useRef<VisualEditorApi | null>(null);
  const [visualDirty, setVisualDirty] = useState(false);
  // Markdown 富文本：渲染结果直接 contentEditable（ORCA 风格），保存时用 turndown 转回 Markdown
  const [richDirty, setRichDirty] = useState(false);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const [liveMd, setLiveMd] = useState<string | null>(null);
  const mdRef = useRef<HTMLDivElement | null>(null);
  const editable = isFile && (isHtml || isMarkdown);
  const dirty = editable && data?.text != null && draft !== data.text;

  const src = isFile ? fileUrl : webSrc;
  // webview 只用于网页 / HTML / 图片；Markdown 与其他文本走 DOM 渲染
  const useWebview = Boolean(src) && (!isFile || isHtml || isImage);
  // HTML 文件即使源码模式也保留 webview，切回来不重新加载
  const showWebview = useWebview && (!isFile || !isHtml || fileMode === "render");

  const mdHtml = useMemo(() => {
    if (!isMarkdown || fileMode !== "render" || data?.text == null) return "";
    return renderMarkdown(data.text);
  }, [isMarkdown, fileMode, data?.text]);

  // 同一标签换成另一个文件时回到「渲染」视图
  useEffect(() => {
    setFileMode("render");
    setVisualDirty(false);
    setRichDirty(false);
    setLiveMd(null);
  }, [file?.rel, file?.root]);

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
      .then((res) => { if (alive) { setData(res); setDraft(res?.text ?? ""); setError(""); } })
      .catch((e) => { if (alive) setError(String((e as Error)?.message || e)); });
    return () => { alive = false; };
  }, [isFile, file?.rel, file?.root, nonce]);

  // webview 生命周期：同一 src 只挂载一次；刷新用 reload，不换 key
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !src) { setReady(false); wcIdRef.current = null; return; }
    const syncNav = () => {
      try {
        setCanBack(Boolean(el.canGoBack?.()));
        setCanForward(Boolean(el.canGoForward?.()));
      } catch { /* webview 还没 ready */ }
    };
    const readyNow = () => {
      try {
        wcIdRef.current = el.getWebContentsId();
        setReady(true);
        try { el.setZoomFactor?.(zoom); } catch { /* ignore */ }
        return true;
      } catch { return false; }
    };
    const onReady = () => { readyNow(); setLoading(false); syncNav(); };
    const onStart = () => setLoading(true);
    const onStop = () => { setLoading(false); syncNav(); };
    const onFail = (event: any) => {
      if (event?.isMainFrame === false) return;
      setReady(false);
      setLoading(false);
      setError(`页面加载失败${event?.errorDescription ? `：${event.errorDescription}` : ""}`);
    };
    const onNav = (event: any) => {
      const next = event?.url || (() => { try { return el.getURL?.(); } catch { return ""; } })();
      if (next && !isFile) setInput(next);
      syncNav();
      setFindResult(null);
    };
    const onFound = (event: any) => {
      const r = event?.result;
      setFindResult({ active: Number(r?.activeMatchOrdinal) || 0, total: Number(r?.matches) || 0 });
    };
    el.addEventListener("dom-ready", onReady);
    el.addEventListener("did-start-loading", onStart);
    el.addEventListener("did-stop-loading", onStop);
    el.addEventListener("did-fail-load", onFail);
    el.addEventListener("did-navigate", onNav);
    el.addEventListener("did-navigate-in-page", onNav);
    el.addEventListener("found-in-page", onFound);
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (readyNow() || tries > 50) window.clearInterval(timer);
    }, 200);
    const initialSync = window.setTimeout(syncNav, 80);
    readyNow();
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initialSync);
      el.removeEventListener("dom-ready", onReady);
      el.removeEventListener("did-start-loading", onStart);
      el.removeEventListener("did-stop-loading", onStop);
      el.removeEventListener("did-fail-load", onFail);
      el.removeEventListener("did-navigate", onNav);
      el.removeEventListener("did-navigate-in-page", onNav);
      el.removeEventListener("found-in-page", onFound);
      wcIdRef.current = null;
      setReady(false);
      setLoading(false);
      setCanBack(false);
      setCanForward(false);
      setPicking(false);
      setPicked(null);
      setPickError("");
      setFindResult(null);
    };
  }, [src, isFile]);

  // 切到别的标签时取消拾取：否则拾取器还挂在隐藏的 webview 上，点了没反应
  useEffect(() => {
    if (active || !picking) return;
    const id = wcIdRef.current;
    if (id) void window.harness.previewCancel(id).catch(() => {});
    setPicking(false);
  }, [active, picking]);

  // 从渲染切到源码时退出拾取
  useEffect(() => {
    if (isFile && fileMode === "source" && picking) {
      const id = wcIdRef.current;
      if (id) void window.harness.previewCancel(id).catch(() => {});
      setPicking(false);
    }
  }, [isFile, fileMode, picking]);

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

  const reload = (hard = false) => {
    setError("");
    try {
      if (hard) viewRef.current?.reloadIgnoringCache?.();
      else viewRef.current?.reload?.();
    } catch { /* ignore */ }
  };

  const stop = () => { try { viewRef.current?.stop?.(); } catch { /* ignore */ } };
  const go = (dir: "goBack" | "goForward") => { try { viewRef.current?.[dir]?.(); } catch { /* ignore */ } };

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
    const target = isFile ? fileUrl : (() => { try { return viewRef.current?.getURL?.() || src; } catch { return src; } })();
    if (target) void window.harness.openExternal(target);
  };

  const toggleDevtools = () => {
    const el = viewRef.current;
    if (!el) return;
    try {
      if (el.isDevToolsOpened?.()) el.closeDevTools?.();
      else el.openDevTools?.();
    } catch { /* ignore */ }
  };

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

  const canPick = Boolean(src) && (!isFile || (isHtml && fileMode === "render"));

  const onRenderedClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (!href) return;
    if (href.startsWith("#")) {
      e.preventDefault();
      const id = decodeURIComponent(href.slice(1));
      const container = e.currentTarget as HTMLElement;
      const target = Array.from(container.querySelectorAll<HTMLElement>("[id]")).find((el) => el.id === id);
      target?.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    e.preventDefault();
    if (/^(https?:|mailto:)/i.test(href)) { void window.harness.openExternal(href); return; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return;
    // Markdown 里的相对文档链接：在同一个 root 下打开为新的预览标签
    const raw = href.split("#")[0].split("?")[0];
    if (!raw || raw.endsWith("/")) return;
    const target = resolveRel(file?.rel || "", raw);
    if (target) requestFilePreview({ rel: target, name: target.split("/").pop(), root: file?.root || root });
  };

  /** 可视化编辑（GrapesJS）：保存时把编辑器产出的完整 HTML 写回磁盘 */
  const saveVisual = async () => {
    if (!file) return;
    const api = visualApiRef.current;
    if (!api) { setError("可视化编辑器还没准备好"); return; }
    setSaving(true);
    try {
      const html = api.save();
      await window.harness.filesWrite(file.rel, file.root, html);
      setSavedAt(Date.now());
      setVisualDirty(false);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  };

  /** 离开可视化：有未保存修改先确认，然后回到渲染并刷新 */
  const leaveVisualTo = (next: "render" | "source") => {
    if (visualDirty && !window.confirm("可视化编辑有未保存修改，切走会丢弃。继续？")) return;
    setVisualDirty(false);
    setFileMode(next);
    if (isHtml) refresh();
  };

  /** 富文本工具栏：对当前选区执行简单格式（execCommand 在 contentEditable 里仍可用） */
  /** 富文本保存：编辑器内部把 HTML 转 Markdown 后回调 */
  const saveRich = async (md?: string) => {
    if (!file) return;
    setSaving(true);
    try {
      const text = md ?? (await editorRef.current?.save() as unknown as string);
      if (typeof text === "string") {
        await window.harness.filesWrite(file.rel, file.root, text);
        setData((cur) => ({ ...(cur || {}), text }));
        setDraft(text);
        setLiveMd(text);
      }
      setRichDirty(false);
      setSavedAt(Date.now());
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!file || !dirty || saving) return;
    setSaving(true);
    try {
      await window.harness.filesWrite(file.rel, file.root, draft);
      setData((cur) => ({ ...(cur || {}), text: draft, error: undefined }));
      setSavedAt(Date.now());
      if (isHtml) refresh(); // HTML 改完直接重载预览
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  };

  // 编辑器里 ⌘S 保存（只在当前可见标签、且处在源码/编辑模式时生效）
  useEffect(() => {
    if (!active || !editable) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // ⌘⇧M：富文本 ⇄ 源码（与 ORCA 一致）
      if (mod && e.shiftKey && e.key.toLowerCase() === "m" && isMarkdown) {
        e.preventDefault();
        setFileMode((mode) => (mode === "source" ? "render" : "source"));
        return;
      }
      if (!mod || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (fileMode === "visual") void saveVisual();
      else if (isMarkdown && fileMode === "render") void editorRef.current?.save();
      else void save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 目录：从源码里抽标题（跳过代码块），id 与 renderMarkdown 的锚点一致
  const headings = useMemo(() => {
    if (!isMarkdown) return [];
    const source = (fileMode === "source" ? draft : (liveMd ?? data?.text)) || "";
    const out: { level: number; text: string; id: string }[] = [];
    let fence = false;
    for (const line of source.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
      if (fence) continue;
      const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (!m) continue;
      const text = m[2].replace(/[*_`~]/g, "").trim();
      const id = slugifyHeading(text);
      if (id) out.push({ level: m[1].length, text, id });
    }
    return out;
  }, [isMarkdown, fileMode, draft, data?.text, liveMd]);

  const jumpToHeading = (id: string) => {
    if (fileMode !== "render") setFileMode("render");
    window.setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      el?.classList.add("md-flash");
      window.setTimeout(() => el?.classList.remove("md-flash"), 1200);
    }, 60);
  };

  const fileText = data?.error
    ? <div className="preview-error">{data.error}</div>
    : data?.text != null
      ? <pre className="file-preview-text">{data.text}</pre>
      : <div className="pane-empty">加载中…</div>;

  return (
    <div className="preview-surface">
      <div className="preview-surface-bar">
        <div className="preview-surface-address-row">
          {!isFile && (
            <>
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
            </>
          )}
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
          {isFile && onOpenUrl && (
            <button
              className="btn tiny-btn"
              title="在同一个预览标签里改用地址（dev server / 远程页面）"
              onClick={() => onOpenUrl(defaultUrl)}
            >URL</button>
          )}
        </div>
        <div className="preview-surface-actions">
          {editable && data?.text != null && (
            <div className="file-preview-seg" role="group" aria-label="预览模式">
              <button className={fileMode === "render" ? "on" : ""} onClick={() => { if (fileMode === "visual") leaveVisualTo("render"); else setFileMode("render"); }}>{isHtml ? "预览" : "富文本"}</button>
              {isHtml && (
                <button className={fileMode === "visual" ? "on" : ""} onClick={() => setFileMode("visual")} title="GrapesJS 画布：改文字 / 拖组件 / 调样式">可视化</button>
              )}
              <button className={fileMode === "source" ? "on" : ""} onClick={() => { if (fileMode === "visual") leaveVisualTo("source"); else setFileMode("source"); }}>源码</button>
            </div>
          )}
          {isMarkdown && headings.length > 0 && (
            <button
              className={`icon-btn ${tocOpen ? "on" : ""}`}
              title="目录（点击标题跳转）"
              aria-label="目录"
              aria-pressed={tocOpen}
              onClick={() => setTocOpen((v) => !v)}
            ><ListIcon size={13} /></button>
          )}
          {fileMode === "visual" && (
            <button className="btn tiny-btn primary" disabled={saving} title="保存（⌘S）" onClick={() => void saveVisual()}>
              {saving ? "保存中…" : "保存修改"}
            </button>
          )}
          {isMarkdown && fileMode === "render" && richDirty && (
            <button className="btn tiny-btn primary" disabled={saving} title="保存（⌘S）" onClick={() => void editorRef.current?.save()}>{saving ? "保存中…" : "保存"}</button>
          )}
          {dirty && (
            <button className="btn tiny-btn primary" disabled={saving} title="保存（⌘S）" onClick={() => void save()}>
              {saving ? "保存中…" : "保存"}
            </button>
          )}
          {!dirty && savedAt && <span className="preview-saved">已保存</span>}
          {canPick && (picking
            ? <button className="btn tiny-btn danger" onClick={() => void cancelPick()}>取消拾取</button>
            : <button className="btn tiny-btn primary" disabled={!ready} title="在页面里点选元素，注入 Chat" onClick={() => void pickElement()}>拾取元素</button>
          )}
          {!isFile && (
            <>
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
              <button className={`icon-btn ${findOpen ? "on" : ""}`} title="页内查找" disabled={!ready} onClick={() => setFindOpen((v) => !v)}><SearchIcon size={13} /></button>
              <button className="icon-btn" title="开发者工具" disabled={!ready} onClick={toggleDevtools}><DevtoolsIcon size={13} /></button>
              <button className="icon-btn" title="在系统浏览器打开" onClick={openExternal}><ExternalIcon size={13} /></button>
            </>
          )}
          {isFile && <button className="icon-btn" title="刷新" aria-label="刷新" onClick={refresh}><RefreshIcon size={13} /></button>}
          {isFile && (
            <>
              <button className="icon-btn" title="在 Finder 中显示" aria-label="在 Finder 中显示" onClick={() => void reveal()}><RevealIcon size={13} /></button>
              <button className="icon-btn" title="复制相对路径" aria-label="复制相对路径" onClick={() => void copyPath()}><CopyIcon size={13} /></button>
            </>
          )}
          {onClose && <button className="icon-btn" title="关闭预览" aria-label="关闭预览" onClick={onClose}><XIcon size={13} /></button>}
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
      {fileMode === "visual" && (
        <div className="preview-hint visual">
          GrapesJS 画布：点文字直接改、从右侧面板拖组件、选中后调样式；⌘S 或「保存修改」写回文件{visualDirty ? "（有未保存修改）" : ""}
        </div>
      )}
      {picking && <div className="preview-hint">点击页面中的元素；Esc 或「取消拾取」退出</div>}
      {picked && !picking && (
        <div className="preview-hint picked">
          已拾取 <span className="mono">{picked.selector}</span>
          {picked.source?.file && <span className="mono faint"> · {picked.source.file}{picked.source.line ? `:${picked.source.line}` : ""}</span>}
          <span className="faint"> · 已放入 Chat 输入框</span>
        </div>
      )}
      {(error || pickError) && <div className="preview-error">{error || pickError}</div>}
      <div ref={bodyRef} className={`preview-surface-body${showWebview ? " frame" : ""}${tocOpen && isMarkdown ? " with-toc" : ""}`}>
        {tocOpen && isMarkdown && (
          <nav className="md-toc" aria-label="目录">
            <div className="md-toc-head">目录 <span className="tiny faint">{headings.length}</span></div>
            {headings.map((h, i) => (
              <button
                key={`${h.id}-${i}`}
                className={`md-toc-item lv${h.level}`}
                style={{ paddingLeft: 8 + (h.level - 1) * 10 }}
                title={h.text}
                onClick={() => jumpToHeading(h.id)}
              >
                <span className="ellipsis">{h.text}</span>
              </button>
            ))}
            {headings.length === 0 && <div className="tiny faint" style={{ padding: "4px 8px" }}>没有标题</div>}
          </nav>
        )}
        <div className="preview-surface-content">
        {isFile && isHtml && fileMode === "visual" && draft != null && (
          <Suspense fallback={<div className="pane-empty">加载可视化编辑器…</div>}>
            <HtmlVisualEditor
              html={draft}
              fileKey={`${file?.root || ""}/${file?.rel || ""}`}
              onApi={(api) => { visualApiRef.current = api; }}
              onDirty={(d) => setVisualDirty(d)}
            />
          </Suspense>
        )}
        {isFile && fileMode === "source" && editable && (
          <textarea
            className="file-source-editor"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="空文件，直接在这里写…"
          />
        )}
        {isFile && !isHtml && !isMarkdown && !isImage && fileText}
        {isFile && isMarkdown && fileMode === "render" && (
          <MarkdownEditor
            ref={editorRef}
            markdown={data?.text ?? ""}
            onChange={(md) => { setLiveMd(md); setRichDirty(true); }}
            onSave={(md) => void saveRich(md)}
          />
        )}
        {useWebview && (
          <div
            className="preview-surface-frame"
            style={{ display: showWebview ? "flex" : "none", width: VIEWPORT[device] ?? undefined, maxWidth: "100%", margin: VIEWPORT[device] ? "0 auto" : undefined }}
          >
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
    </div>
  );
}
