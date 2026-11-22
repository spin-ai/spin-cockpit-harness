import { useEffect, useMemo, useRef, useState } from "react";
import type { ElementContext } from "../types";
import { CameraIcon, ChevronRightIcon, CodeIcon, CopyIcon, DevtoolsIcon, ExternalIcon, ListIcon, MinusIcon, PlusIcon, RecordIcon, RefreshIcon, RevealIcon, SearchIcon, XIcon } from "./Icons";
import { FileVisual, extOf, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, DOC_EXT } from "./FileVisual";
import DOMPurify from "dompurify";
import { slugifyHeading } from "../markdown";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
// CodeMirror + legacy-modes 不小：只在第一次打开文本 / 代码文件时加载
const CodeEditor = lazy(() => import("./CodeEditor").then((m) => ({ default: m.CodeEditor })));
import { PdfViewer } from "./PdfViewer";
import { lazy, Suspense } from "react";
import type { VisualEditorApi } from "./HtmlVisualEditor";

// GrapesJS 体积大：只在第一次打开「可视化」时加载
const HtmlVisualEditor = lazy(() => import("./HtmlVisualEditor").then((m) => ({ default: m.HtmlVisualEditor })));

// Electron <webview>：独立进程、无 preload；本地 HTML 用 file://，dev server 用 http(s)
const Webview: any = "webview";

type FileInfo = { name: string; rel: string; root?: string };
/** 这些扩展名默认折行（代码文件不折，长行横向滚动） */
const WRAP_EXT = new Set(["txt", "log", "csv", "tsv", "tex", "rst", "org", "out"]);
type Loaded = { text?: string; error?: string; size?: number; ext?: string; binary?: boolean; encoding?: string };
/** 视口预设：宽 / 高都可以为空（= 跟随面板），自定义时两个都能填 */
const VIEWPORTS = [
  { id: "auto", label: "自适应", w: null, h: null },
  { id: "tablet", label: "平板 834", w: 834, h: null },
  { id: "mobile", label: "手机 390", w: 390, h: null },
] as const;
type ViewportId = (typeof VIEWPORTS)[number]["id"] | "custom";

function normalizeUrl(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`;
}

/**
 * 本地路径 → file:// URL。
 * 逐段 encodeURIComponent：`#` `?` `%` 的文件名不会被当成 fragment / query（encodeURI 会漏）。
 * Windows 盘符保留冒号（`file:///C:/x`），UNC 保留 authority（`file://server/share`）。
 */
/** 视口宽高：空 = 跟随面板；否则夹在 120–4000 */
export function clampSize(raw: string): number | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(4000, Math.max(120, Math.round(n)));
}

export function fileUrlOf(abs: string) {
  if (!abs) return "";
  const normalized = abs.replace(/\\/g, "/");
  const encoded = normalized.split("/").map((seg) => encodeURIComponent(seg)).join("/")
    .replace(/^([a-zA-Z])%3A(?=\/)/, "$1:");
  if (normalized.startsWith("//")) return `file:${encoded}`;
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${encoded}`;
  return `file://${encoded}`;
}

/**
 * 统一预览表面：
 * - mode=web：地址栏 + dev server/webview + 刷新 + 拾取
 * - mode=file：本地 HTML，路径栏 + 渲染/源码 + webview + 拾取 + Finder/复制
 * 同一个 HTML 标签只保留一个 webview；渲染/源码切换与切标签都不重建。
 */
export function PreviewSurface({ mode, file, url, defaultUrl = "http://localhost:5173/", autoOpenUrl, autoOpenKey, root, remoteHost, active = true, onOpenUrl, onPicked, onClose }: {
  mode: "web" | "file";
  file?: FileInfo;
  url?: string;
  defaultUrl?: string;
  autoOpenUrl?: string;
  autoOpenKey?: number;
  root?: string;
  /** 当前任务的 Agent 跑在远端主机：dev server 在本机不可达，只能 ssh -L 转过来；root 是远端绝对路径 */
  remoteHost?: { id: string; name: string; root?: string } | null;
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
  const isImage = isFile && IMAGE_EXT.has(ext);
  const isMedia = isFile && (VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext));
  const isPdf = isFile && ext === "pdf";
  const isDoc = isFile && DOC_EXT.has(ext);
  // 浏览器原生就能画的格式：不读正文（不 base64、不受 2MB 文本限制），直接交给 webview
  const isNative = isHtml || isImage || isMedia || isPdf;
  /* PDF 用自己的阅读器（主进程渲页图），其余原生格式仍交给 webview */
  const usePdfViewer = isFile && isPdf;
  const abs = useMemo(() => (file?.root ? `${file.root.replace(/[\\/]+$/, "")}/${file.rel}` : ""), [file?.root, file?.rel]);
  const fileUrl = useMemo(() => fileUrlOf(abs), [abs]);
  const initialWeb = normalizeUrl(url || autoOpenUrl || defaultUrl);

  const [input, setInput] = useState(isFile ? file?.rel || "" : url || autoOpenUrl || defaultUrl);
  const [webSrc, setWebSrc] = useState(initialWeb);
  const [fileMode, setFileMode] = useState<"render" | "source" | "visual">("render");
  const [data, setData] = useState<Loaded | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState("");
  // 远端预览：地址栏与注入上下文都用远端原始地址，webview 只加载本机隧道地址
  const [tunnel, setTunnel] = useState<{ forUrl: string; localUrl: string; remoteUrl: string } | null>(null);
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [tunnelError, setTunnelError] = useState("");
  const tunnelKeyRef = useRef<string | null>(null);
  const tunnelRef = useRef<{ forUrl: string; localUrl: string; remoteUrl: string } | null>(null);
  const remoteMode = Boolean(remoteHost) && !isFile;
  const [ready, setReady] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ElementContext | null>(null);
  const [pickError, setPickError] = useState("");
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState<{ w: number | null; h: number | null }>({ w: null, h: null });
  // 尺寸输入用草稿：每键 clamp 会把「8」立刻变成 120，没法输入 834
  const [sizeDraft, setSizeDraft] = useState<{ w: string; h: string }>({ w: "", h: "" });
  // 文档（docx / xlsx / pptx…）：主进程转 HTML，这里再 sanitize 一次
  const [doc, setDoc] = useState<{ html?: string; pdfPath?: string; kind?: string; truncated?: boolean; error?: string } | null>(null);
  // 站点权限被拒（摄像头 / 麦克风 / 剪贴板…）：给一条可操作提示
  const [permHint, setPermHint] = useState<{ origin: string; permission: string; label: string; grantable: boolean } | null>(null);
  // 页面 console：不用开 DevTools 也能看到红字
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [logs, setLogs] = useState<{ level: number; message: string; source: string; line: number; at: number }[]>([]);
  // 录屏：主进程抓帧 → canvas + MediaRecorder 编 webm
  const [rec, setRec] = useState<{ id: string; startedAt: number } | null>(null);
  const [recNow, setRecNow] = useState(Date.now());
  const recRef = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; recorder: MediaRecorder | null; chunks: Blob[]; stream: MediaStream | null } | null>(null);
  const recIdRef = useRef<string | null>(null);
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
  const logErrors = logs.filter((log) => log.level >= 3).length;
  const viewportId: ViewportId = (VIEWPORTS.find((p) => p.w === viewport.w && p.h === viewport.h)?.id as ViewportId | undefined) ?? "custom";
  useEffect(() => {
    setSizeDraft({ w: viewport.w == null ? "" : String(viewport.w), h: viewport.h == null ? "" : String(viewport.h) });
  }, [viewport.w, viewport.h]);
  const commitSize = (axis: "w" | "h") => {
    const next = clampSize(sizeDraft[axis]);
    setViewport((v) => (v[axis] === next ? v : { ...v, [axis]: next }));
  };
  const applyViewport = (id: ViewportId) => {
    const preset = VIEWPORTS.find((p) => p.id === id);
    if (!preset) { setViewport((v) => ({ w: v.w ?? 1024, h: v.h })); return; }
    setViewport({ w: preset.w, h: preset.h });
  };
  /* 文本 / 代码文件都能改：html 有渲染/可视化/源码三段，markdown 有富文本/源码，其余直接是代码编辑器 */
  const isTextFile = isFile && !isNative && !isDoc;
  const editable = isHtml || isMarkdown || (isTextFile && !data?.binary);
  const dirty = editable && data?.text != null && draft !== data.text;

  // 文档优先版式：LibreOffice 转过 PDF 就交给 webview（内置阅读器），否则用解析出的 HTML
  const docPdfSrc = isDoc && doc?.pdfPath ? fileUrlOf(doc.pdfPath) : "";
  const src = isFile ? (docPdfSrc || fileUrl) : remoteMode ? (tunnel?.forUrl === webSrc ? tunnel.localUrl : "") : webSrc;
  tunnelRef.current = tunnel;
  // 本机隧道地址 → 用户/Agent 看到的远端地址
  const mapBack = (raw: string) => {
    const t = tunnelRef.current;
    if (!t) return raw;
    try {
      const u = new URL(raw);
      const local = new URL(t.localUrl);
      const remote = new URL(t.remoteUrl);
      if (u.host !== local.host) return raw;
      return `${remote.origin}${u.pathname}${u.search}${u.hash}`;
    } catch { return raw; }
  };
  // webview 只用于网页 / HTML / 图片 / 音视频 / PDF；Markdown 与其他文本走 DOM 渲染
  const useWebview = Boolean(src) && !usePdfViewer && (!isFile || isNative || Boolean(docPdfSrc));
  // HTML 文件即使源码模式也保留 webview，切回来不重新加载
  const showWebview = useWebview && (!isFile || !isHtml || fileMode === "render");

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
    // 图片 / 音视频 / PDF 只给 webview：读成 utf8 是乱码，2MB 以上的图片还会被当成「太大」
    // 文档（docx / xlsx / pptx…）走 filesPreviewDoc 转 HTML，也不读原始字节
    if ((isNative && !isHtml) || isDoc) { setData(null); return; }
    const key = `${file.root || ""}\n${file.rel}`;
    let alive = true;
    if (fileKeyRef.current !== key) { fileKeyRef.current = key; setData(null); }
    window.harness.filesRead(file.rel, file.root)
      .then((res) => { if (alive) { setData(res); setDraft(res?.text ?? ""); setError(""); } })
      .catch((e) => { if (alive) setError(String((e as Error)?.message || e)); });
    return () => { alive = false; };
  }, [isFile, file?.rel, file?.root, nonce, isNative, isHtml, isDoc]);

  // 文档预览：docx → mammoth、xlsx → 表格、pptx 等 → 文本；结果在渲染时再 sanitize
  useEffect(() => {
    if (!isDoc || !file) { setDoc(null); return; }
    let alive = true;
    setDoc(null);
    window.harness.filesPreviewDoc(file.rel, file.root)
      .then((res) => { if (alive) setDoc(res?.error ? { error: res.error } : res); })
      .catch((e) => { if (alive) setDoc({ error: String((e as Error)?.message || e) }); });
    return () => { alive = false; };
  }, [isDoc, file?.rel, file?.root, nonce]);

  // 站点权限被拒：只认当前这个预览页发来的请求
  useEffect(() => {
    return window.harness.onPreviewPermission((info) => {
      if (!info) return;
      if (wcIdRef.current != null && info.webContentsId !== wcIdRef.current) return;
      setPermHint({ origin: info.origin, permission: info.permission, label: info.label, grantable: info.grantable });
    });
  }, []);

  // 远端：地址不变就不重建隧道；换地址先关旧隧道（引用计数在主进程）
  useEffect(() => {
    if (!remoteMode || !remoteHost) { setTunnel(null); setTunnelBusy(false); setTunnelError(""); return; }
    if (!/^https?:\/\//i.test(webSrc)) { setTunnel(null); setTunnelError(""); return; }
    let alive = true;
    setTunnelBusy(true);
    setTunnelError("");
    window.harness.previewTunnel(remoteHost.id, webSrc)
      .then((res) => {
        if (!alive) { if (res?.ok && res.key) void window.harness.previewTunnelClose(res.key).catch(() => {}); return; }
        if (!res?.ok) { setTunnelBusy(false); setTunnelError(res?.error || "SSH 隧道建立失败"); return; }
        tunnelKeyRef.current = res.key || null;
        setTunnel({ forUrl: webSrc, localUrl: res.url || webSrc, remoteUrl: res.remote || webSrc });
        setTunnelBusy(false);
      })
      .catch((e) => { if (alive) { setTunnelBusy(false); setTunnelError(String(e?.message || e)); } });
    return () => {
      alive = false;
      const key = tunnelKeyRef.current;
      tunnelKeyRef.current = null;
      if (key) void window.harness.previewTunnelClose(key).catch(() => {});
    };
  }, [remoteMode, remoteHost?.id, webSrc]);

  // 隧道连通后自己断了（断网 / sshd 重启）：只说错误，不自动重建，避免刷日志
  useEffect(() => {
    if (!remoteMode) return;
    return window.harness.onPreviewTunnelClosed((info) => {
      if (!info?.key || info.key !== tunnelKeyRef.current) return;
      tunnelKeyRef.current = null;
      setTunnel(null);
      setTunnelError(`SSH 隧道已断开（${info.hostName || remoteHost?.name || "远端"}）：${info.error || "连接中断"}`);
    });
  }, [remoteMode, remoteHost?.id]);

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
      let msg = `页面加载失败${event?.errorDescription ? `：${event.errorDescription}` : ""}`;
      if (tunnelRef.current && /ERR_CONNECTION|ERR_EMPTY_RESPONSE|ERR_SOCKET/i.test(event?.errorDescription || "")) {
        msg += "（隧道已建，但远端该端口没服务：dev server 起来了吗？）";
      }
      setError(msg);
    };
    const onNav = (event: any) => {
      const next = event?.url || (() => { try { return el.getURL?.(); } catch { return ""; } })();
      if (next && !isFile) setInput(mapBack(next));
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
      // 换页面 / 卸载时停掉录制，别让主进程继续空转抓帧
      const recId = recIdRef.current;
      if (recId) {
        recIdRef.current = null;
        void window.harness.previewRecordStop(recId).catch(() => {});
        try { recRef.current?.stream?.getTracks().forEach((track) => track.stop()); } catch { /* ignore */ }
        recRef.current = null;
        setRec(null);
      }
      wcIdRef.current = null;
      setLogs([]);
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

  // 页面日志：只在当前预览页内累积（换页面 / 换标签就清空）
  useEffect(() => {
    return window.harness.onPreviewConsole((info) => {
      if (wcIdRef.current != null && info.webContentsId !== wcIdRef.current) return;
      setLogs((list) => [...list.slice(-199), { level: info.level, message: info.message, source: info.source, line: info.line, at: Date.now() }]);
    });
  }, []);

  useEffect(() => {
    const stop = window.harness.onPreviewRecordFrame(async ({ id, width, height, jpeg }) => {
      const st = recRef.current;
      if (!st || recIdRef.current !== id) return;
      try {
        const bytes = Uint8Array.from(atob(jpeg), (ch) => ch.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        const scale = Math.min(1, 1280 / Math.max(1, width));
        const cw = Math.max(2, Math.round(width * scale));
        const ch = Math.max(2, Math.round(height * scale));
        if (st.canvas.width !== cw || st.canvas.height !== ch) { st.canvas.width = cw; st.canvas.height = ch; }
        st.ctx?.drawImage(bitmap, 0, 0, cw, ch);
        bitmap.close();
        if (!st.recorder) {
          const stream = st.canvas.captureStream(4);
          const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
            .find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) || "video/webm";
          const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000 });
          recorder.ondataavailable = (e) => { if (e.data?.size) st.chunks.push(e.data); };
          recorder.start(1000);
          st.stream = stream;
          st.recorder = recorder;
        }
      } catch { /* 单帧失败不影响整段 */ }
    });
    const ended = window.harness.onPreviewRecordEnded(({ id }) => {
      if (recIdRef.current === id) void finishRecording();
    });
    return () => { stop(); ended(); };
  }, []);

  useEffect(() => {
    if (!rec) return;
    const timer = window.setInterval(() => setRecNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [rec]);

  // 告诉主进程当前可见的预览页：Agent 的 browser_* 工具作用在它上面
  useEffect(() => {
    const id = wcIdRef.current;
    if (!id) return;
    if (!active) return;
    void window.harness.previewActive(id).catch(() => {});
  }, [active, ready, src]);

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
    const current = (() => { try { return viewRef.current?.getURL?.() || src; } catch { return src; } })();
    const target = isFile ? fileUrl : mapBack(current);
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

  const toast = (message: string) => window.dispatchEvent(new CustomEvent("harness:toast", { detail: message }));

  /** 截图：主进程落盘 + 复制到剪贴板 */
  const capture = async (fullPage = false) => {
    const id = wcIdRef.current;
    if (!id) return;
    const res = await window.harness.previewCapture(id, fullPage);
    if (!res?.ok) { setError(res?.error || "截图失败"); return; }
    toast(res.copied ? "已复制截图" : "截图已保存");
  };

  const startRecording = async () => {
    const id = wcIdRef.current;
    if (!id || recIdRef.current) return;
    const res = await window.harness.previewRecordStart(id, 4);
    if (!res?.ok || !res.id) { toast(res?.error || "无法开始录制"); return; }
    recIdRef.current = res.id;
    const canvas = document.createElement("canvas");
    recRef.current = { canvas, ctx: canvas.getContext("2d"), recorder: null, chunks: [], stream: null };
    setRecNow(Date.now());
    setRec({ id: res.id, startedAt: Date.now() });
  };

  const finishRecording = async () => {
    const id = recIdRef.current;
    if (!id) return;
    recIdRef.current = null;
    await window.harness.previewRecordStop(id).catch(() => {});
    const st = recRef.current;
    recRef.current = null;
    setRec(null);
    if (!st?.recorder || st.recorder.state === "inactive") { toast("录制结束：没有抓到画面"); return; }
    const recorder = st.recorder;
    await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); recorder.stop(); });
    st.stream?.getTracks().forEach((track) => track.stop());
    const blob = new Blob(st.chunks, { type: recorder.mimeType });
    if (!blob.size) { toast("录制内容为空"); return; }
    const saved = await window.harness.previewRecordSave(new Uint8Array(await blob.arrayBuffer()), recorder.mimeType);
    if (saved?.ok && saved.path) toast(`已保存录制：${saved.path}`);
    else toast(saved?.error || "保存录制失败");
  };

  /** 站点权限被拒 → 写入白名单并硬刷新，页面重新申请一次就拿到权限 */
  const allowPermission = async () => {
    const info = permHint;
    if (!info) return;
    setPermHint(null);
    try {
      await window.harness.previewGrantPermission(info.origin, info.permission);
      reload(true);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
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
      const ctx = await window.harness.previewPick(id, isFile ? file?.root : root, remoteHost?.root);
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
      bodyRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 60);
  };

  // 文档 HTML 来自本机解析器，仍然过一遍 DOMPurify（文档里可能带脚本 / 外链）
  const docHtml = useMemo(() => {
    if (!doc?.html) return "";
    return DOMPurify.sanitize(doc.html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "button", "textarea", "select", "link", "meta"],
      ADD_DATA_URI_TAGS: ["img"],
    });
  }, [doc?.html]);

  const fileText = data?.text != null
    ? <pre className="file-preview-text">{data.text}</pre>
    : <div className="inline-empty">加载中…</div>;
  // 二进制 / 非 UTF-8：以前直接 utf8 解码塞进 <pre>，看到的是乱码
  const binaryNote = data?.binary
    ? (
      <div className="inline-empty">
        <div>{ext ? ext.toUpperCase() : "该文件"} {data.encoding === "non-utf8" ? "不是可识别的文本编码" : "是二进制文件"}，预览不支持</div>
        <div className="tiny faint">用「在 Finder 中显示」交给系统应用打开，或让 Agent 处理它</div>
      </div>
    )
    : null;

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
          {remoteMode && tunnel && (
            <span className="preview-tunnel" title={`经 SSH 隧道到 ${remoteHost?.name}（只绑本机 127.0.0.1）· ${tunnel.remoteUrl}`}>
              隧道 · {remoteHost?.name}
            </span>
          )}
          {isFile && onOpenUrl && (
            <button
              className="btn tiny-btn"
              title="在同一个预览标签里改用地址（dev server / 远程页面）"
              onClick={() => onOpenUrl(defaultUrl)}
            >URL</button>
          )}
        </div>
        <div className="preview-surface-actions">
          {(isHtml || isMarkdown) && data?.text != null && (
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
              <select
                className="preview-device"
                value={viewportId}
                title="视口预设（自定义时可在右侧填宽高）"
                onChange={(e) => applyViewport(e.target.value as ViewportId)}
              >
                {VIEWPORTS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                <option value="custom">自定义</option>
              </select>
              <span className="preview-size" title="视口宽 × 高（空 = 跟随面板）">
                <input
                  value={sizeDraft.w}
                  placeholder="宽"
                  inputMode="numeric"
                  aria-label="视口宽度"
                  onChange={(e) => setSizeDraft((d) => ({ ...d, w: e.target.value.replace(/[^0-9]/g, "") }))}
                  onBlur={() => commitSize("w")}
                  onKeyDown={(e) => { if (e.key === "Enter") { commitSize("w"); (e.target as HTMLInputElement).blur(); } }}
                />
                <span className="preview-size-x">×</span>
                <input
                  value={sizeDraft.h}
                  placeholder="高"
                  inputMode="numeric"
                  aria-label="视口高度"
                  onChange={(e) => setSizeDraft((d) => ({ ...d, h: e.target.value.replace(/[^0-9]/g, "") }))}
                  onBlur={() => commitSize("h")}
                  onKeyDown={(e) => { if (e.key === "Enter") { commitSize("h"); (e.target as HTMLInputElement).blur(); } }}
                />
              </span>
              {(viewport.w != null || viewport.h != null) && (
                <button className="btn tiny-btn" title="适应窗口（清除宽高）" onClick={() => setViewport({ w: null, h: null })}>适应</button>
              )}
              <div className="preview-zoom">
                <button title="缩小" aria-label="缩小" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}><MinusIcon size={13} /></button>
                <button className="preview-zoom-value" title="重置缩放" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
                <button title="放大" aria-label="放大" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))}><PlusIcon size={13} /></button>
              </div>
              <button className={`icon-btn ${findOpen ? "on" : ""}`} title="页内查找" disabled={!ready} onClick={() => setFindOpen((v) => !v)}><SearchIcon size={13} /></button>
              <button className={`icon-btn ${consoleOpen ? "on" : ""}`} title="控制台（页面日志）" onClick={() => setConsoleOpen((v) => !v)}>
                <CodeIcon size={13} />
                {logErrors > 0 && <span className="preview-badge">{logErrors > 99 ? "99" : logErrors}</span>}
              </button>
              <button className="icon-btn" title="截图（复制到剪贴板）" disabled={!ready} onClick={() => void capture(false)}><CameraIcon size={13} /></button>
              <button
                className={`icon-btn ${rec ? "on" : ""}`}
                title={rec ? "停止录制" : "录制预览（约 4fps · 最长 60s · 无音频）"}
                disabled={!ready && !rec}
                onClick={() => (rec ? void finishRecording() : void startRecording())}
              ><RecordIcon size={11} /></button>
              {rec && (
                <span className="preview-rec">
                  <RecordIcon size={8} /> {String(Math.floor((recNow - rec.startedAt) / 60000)).padStart(2, "0")}:{String(Math.floor(((recNow - rec.startedAt) % 60000) / 1000)).padStart(2, "0")}
                </span>
              )}
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
      {remoteMode && tunnelBusy && <div className="preview-hint">正在通过 <b>{remoteHost?.name}</b> 建立 SSH 隧道…</div>}
      {remoteMode && tunnelError && <div className="preview-error">{tunnelError}</div>}
      {isFile && data?.error && <div className="preview-error">{data.error}</div>}
      {permHint && (
        <div className="preview-hint perm">
          <span className="ellipsis">
            页面请求「{permHint.label}」 · <span className="mono">{permHint.origin}</span>
          </span>
          {permHint.grantable ? (
            <button className="btn tiny-btn" onClick={() => void allowPermission()}>允许并刷新</button>
          ) : (
            <span className="faint">这类权限需要在系统浏览器里完成</span>
          )}
          <button className="icon-btn" title="忽略" aria-label="忽略" onClick={() => setPermHint(null)}><XIcon size={12} /></button>
        </div>
      )}
      {isFile && data?.encoding && !data.binary && (
        <div className="preview-hint">按 {data.encoding.toUpperCase()} 解码显示；保存会写成 UTF-8</div>
      )}
      {isFile && isNative && !isHtml && !usePdfViewer && (
        <div className="preview-hint" title="由 Chromium 原生渲染；空白或打不开时用「在 Finder 中显示」交给系统应用">
          {isMedia ? "音视频" : "图片"}由 Chromium 原生渲染 · 打不开时用 Finder 打开
        </div>
      )}
      {consoleOpen && (
        <div className="preview-console">
          <div className="preview-console-head">
            <b>控制台</b>
            <span className="faint">{logs.length} 条{logErrors ? ` · ${logErrors} error` : ""}</span>
            <span style={{ flex: 1 }} />
            <button className="btn tiny-btn" onClick={() => setLogs([])}>清空</button>
            <button className="icon-btn" title="关闭" aria-label="关闭控制台" onClick={() => setConsoleOpen(false)}><XIcon size={12} /></button>
          </div>
          <div className="preview-console-list">
            {logs.length === 0
              ? <div className="inline-empty">还没有日志；页面 console.* 会出现在这里。</div>
              : logs.map((log, i) => (
                <div key={`${log.at}-${i}`} className={`preview-console-row ${log.level >= 3 ? "error" : log.level === 2 ? "warn" : ""}`}>
                  <span className="preview-console-src" title={log.source}>{log.source ? `${log.source.split("/").pop()}:${log.line}` : "page"}</span>
                  <span>{log.message}</span>
                </div>
              ))}
          </div>
        </div>
      )}
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
          <Suspense fallback={<div className="inline-empty">加载可视化编辑器…</div>}>
            <HtmlVisualEditor
              html={draft}
              fileKey={`${file?.root || ""}/${file?.rel || ""}`}
              onApi={(api) => { visualApiRef.current = api; }}
              onDirty={(d) => setVisualDirty(d)}
            />
          </Suspense>
        )}
        {usePdfViewer && file && <PdfViewer rel={file.rel} root={file.root} name={file.name} onError={setError} />}
        {isFile && fileMode === "source" && editable && (
          <Suspense fallback={<div className="inline-empty">加载编辑器…</div>}>
          <CodeEditor
            key={`src:${file?.root || ""}/${file?.rel || ""}`}
            value={draft}
            name={file?.name || "file.txt"}
            wrap={isMarkdown}
            onDraft={setDraft}
            onSave={() => void save()}
          />
          </Suspense>
        )}
        {isFile && !isHtml && !isMarkdown && !isNative && !isDoc && (data?.text != null
          ? (
            <Suspense fallback={<div className="inline-empty">加载编辑器…</div>}>
            <CodeEditor
              key={`code:${file?.root || ""}/${file?.rel || ""}`}
              value={draft}
              name={file?.name || "file.txt"}
              wrap={WRAP_EXT.has(extOf(file?.name || ""))}
              onDraft={setDraft}
              onSave={() => void save()}
            />
            </Suspense>
          )
          : data?.error ? null : fileText)}
        {isDoc && !docPdfSrc && (doc?.error
          ? <div className="preview-error">{doc.error}</div>
          : docHtml
            ? <div className="doc-preview" dangerouslySetInnerHTML={{ __html: docHtml }} />
            : <div className="inline-empty">正在解析文档…</div>)}
        {isDoc && doc?.pdfPath && <div className="preview-hint" title="LibreOffice 转成 PDF 后用内置阅读器显示">版式预览（PDF）· 编辑请用「在 Finder 中显示」</div>}
      {isDoc && !doc?.pdfPath && doc?.html && <div className="preview-hint" title="没装 LibreOffice 时只做解析，版式不还原">文字版（安装 LibreOffice 可看版式）· 编辑请用「在 Finder 中显示」</div>}
      {isDoc && doc?.truncated && <div className="preview-hint">文档较大，只渲染了前一部分（完整内容请用「在 Finder 中显示」打开）</div>}
        {binaryNote}
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
            style={{
              display: showWebview ? "flex" : "none",
              width: viewport.w ?? undefined,
              height: viewport.h ?? undefined,
              maxWidth: "100%",
              maxHeight: "100%",
              margin: viewport.w ? "0 auto" : undefined,
            }}
          >
            {/* partition 必须与主进程 PREVIEW_PARTITION 一致：persist: 前缀才保留登录态 */}
            <Webview
              ref={viewRef}
              key={src}
              src={src}
              partition="persist:preview"
              webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
            />
          </div>
        )}
        {!src && <div className="inline-empty">{remoteMode ? (tunnelError ? "隧道未建立，见下方原因" : "正在建立 SSH 隧道…") : "输入地址后点「打开」。"}</div>}
        </div>
      </div>
    </div>
  );
}
