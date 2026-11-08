import { useEffect, useMemo, useRef, useState } from "react";
import type { ElementContext } from "../types";
import { CopyIcon, ListIcon, RefreshIcon, RevealIcon, XIcon } from "./Icons";
import { FileVisual, extOf } from "./FileVisual";
import { renderMarkdown, slugifyHeading } from "../markdown";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { requestFilePreview } from "../terminal-events";
import { lazy, Suspense } from "react";
import type { VisualEditorApi } from "./HtmlVisualEditor";

// GrapesJS 体积大：只在第一次打开「可视化」时加载
const HtmlVisualEditor = lazy(() => import("./HtmlVisualEditor").then((m) => ({ default: m.HtmlVisualEditor })));

// Electron <webview>：独立进程、无 preload；本地 HTML 用 file://，dev server 用 http(s)
const Webview: any = "webview";

type FileInfo = { name: string; rel: string; root?: string };
type Loaded = { text?: string; error?: string; size?: number };

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
  // Markdown 富文本编辑：渲染结果直接 contentEditable，保存时用 turndown 转回 Markdown
  const [richEdit, setRichEdit] = useState(false);
  const [richDirty, setRichDirty] = useState(false);
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
    setRichEdit(false);
    setRichDirty(false);
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

  /** 富文本 → Markdown：turndown + gfm（表格/任务列表/删除线） */
  const saveRich = async () => {
    if (!file || !mdRef.current || saving) return;
    setSaving(true);
    try {
      const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
      td.use(gfm);
      td.remove(["button"]);
      // turndown 默认把列表写成「-   item」（3 空格），这里归一成常见的「- item」
      const md = td.turndown(mdRef.current.innerHTML)
        .replace(/^(\s*)[-*+]\s{2,}/gm, "$1- ")
        .replace(/^(\s*)(\d+)\.\s{2,}/gm, "$1$2. ")
        .replace(/\n{3,}/g, "\n\n");
      await window.harness.filesWrite(file.rel, file.root, md);
      setData((cur) => ({ ...(cur || {}), text: md }));
      setDraft(md);
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
    if (fileMode !== "source" && fileMode !== "visual" && !richEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (fileMode === "visual") void saveVisual();
        else if (richEdit) void saveRich();
        else void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 目录：从源码里抽标题（跳过代码块），id 与 renderMarkdown 的锚点一致
  const headings = useMemo(() => {
    if (!isMarkdown) return [];
    const source = (fileMode === "source" ? draft : data?.text) || "";
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
  }, [isMarkdown, fileMode, draft, data?.text]);

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
          {isMarkdown && fileMode === "render" && (
            <button
              className={`btn tiny-btn ${richEdit ? "primary" : ""}`}
              title={richEdit ? "完成富文本编辑（⌘S 保存）" : "直接在渲染结果上改文字（保存时转回 Markdown）"}
              onClick={() => { setRichEdit((v) => !v); setRichDirty(false); }}
            >{richEdit ? "完成编辑" : "编辑富文本"}</button>
          )}
          {isMarkdown && fileMode === "render" && richEdit && richDirty && (
            <button className="btn tiny-btn primary" disabled={saving} onClick={() => void saveRich()}>{saving ? "保存中…" : "保存"}</button>
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
      {richEdit && fileMode === "render" && (
        <div className="preview-hint visual">
          富文本编辑中：直接改文字 / 标题 / 列表，⌘S 或「保存」写回 Markdown（表格与嵌套结构会被规范化）
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
          <div
            ref={mdRef}
            className={`md-render${richEdit ? " editing" : ""}`}
            contentEditable={richEdit}
            suppressContentEditableWarning
            spellCheck={richEdit}
            onInput={() => { if (richEdit) setRichDirty(true); }}
            onClick={richEdit ? undefined : onRenderedClick}
            dangerouslySetInnerHTML={{ __html: mdHtml }}
          />
        )}
        {useWebview && (
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
    </div>
  );
}
