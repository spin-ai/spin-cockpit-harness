import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { CopyIcon, RefreshIcon, RevealIcon, XIcon } from "./Icons";
import { FileVisual, extOf } from "./FileVisual";
import type { ElementContext } from "../types";
import { requestFilePreview } from "../terminal-events";

// Electron <webview>：独立进程、无 preload；HTML 用文件协议加载，相对资源能正确解析
const Webview: any = "webview";

type Loaded = { text?: string; dataUrl?: string; error?: string; size?: number };
type Mode = "render" | "source";

/**
 * 文件预览（终端区的标签）：文本 / 图片 / Markdown / HTML。
 * Markdown 与 HTML 支持「渲染 / 源码」切换；HTML 在 sandboxed webview 里渲染。
 */
export function FilePreviewPane({ name, rel, root, onClose, onPicked }: {
  name: string; rel: string; root?: string; onClose: () => void;
  onPicked?: (ctx: ElementContext) => void;
}) {
  const ext = extOf(name);
  const isMarkdown = ext === "md" || ext === "markdown";
  const isHtml = ext === "html" || ext === "htm";
  const canToggle = isMarkdown || isHtml;

  const [data, setData] = useState<Loaded | null>(null);
  const [nonce, setNonce] = useState(0);
  const [mode, setMode] = useState<Mode>(canToggle ? "render" : "source");
  const viewRef = useRef<any>(null);
  const wcIdRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ElementContext | null>(null);
  const [pickError, setPickError] = useState("");

  // 切文件时回到默认视图：Markdown / HTML 默认渲染，其余源码
  useEffect(() => { setMode(canToggle ? "render" : "source"); }, [rel, canToggle]);

  // 同一文件刷新时保留旧内容（避免刷新/切标签时闪一下空白），只有换文件才清空
  const fileKeyRef = useRef("");
  useEffect(() => {
    const key = `${root || ""}\n${rel}`;
    let alive = true;
    if (fileKeyRef.current !== key) {
      fileKeyRef.current = key;
      setData(null);
    }
    window.harness.filesRead(rel, root)
      .then((res) => { if (alive) setData(res); })
      .catch((e) => { if (alive) setData({ error: String((e as Error)?.message || e) }); });
    return () => { alive = false; };
  }, [rel, root, nonce]);

  const absPath = useMemo(() => (root ? `${root.replace(/[\\/]+$/, "")}/${rel}` : ""), [root, rel]);
  const fileUrl = useMemo(() => (absPath ? `file://${encodeURI(absPath)}` : ""), [absPath]);
  const htmlRender = isHtml && mode === "render" && Boolean(fileUrl);
  const mdRender = isMarkdown && mode === "render";

  const mdHtml = useMemo(() => {
    if (!mdRender || data?.text == null) return "";
    const raw = marked.parse(data.text, { gfm: true, async: false }) as string;
    const safe = DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "button", "textarea", "select"],
    });
    return addHeadingIds(safe);
  }, [mdRender, data?.text]);

  // HTML 渲染 = 和网页预览同一套 webview / 元素拾取（grab）能力
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !isHtml) { setReady(false); wcIdRef.current = null; return; }
    const onReady = () => {
      try { wcIdRef.current = el.getWebContentsId(); setReady(true); } catch { setReady(false); }
    };
    const onFail = () => setReady(false);
    el.addEventListener("dom-ready", onReady);
    el.addEventListener("did-fail-load", onFail);
    // dom-ready 可能早于 effect 绑定；轮询到 webContents 可用为止
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (onReadyTry()) window.clearInterval(timer);
      else if (tries > 50) window.clearInterval(timer);
    }, 200);
    const onReadyTry = () => {
      try { wcIdRef.current = el.getWebContentsId(); setReady(true); return true; } catch { return false; }
    };
    onReadyTry();
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
  }, [isHtml, fileUrl, data]);

  const pickElement = async () => {
    const id = wcIdRef.current;
    if (!id) { setPickError("页面还没加载完成"); return; }
    setPicking(true);
    setPickError("");
    setPicked(null);
    try {
      const ctx = await window.harness.previewPick(id, root);
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

  const refresh = () => {
    setNonce((n) => n + 1);
    // HTML：webview 保持挂载，直接 reload，不重建 iframe/webContents
    if (isHtml && viewRef.current) {
      try { viewRef.current.reload(); } catch { /* 还没 ready 时由 data 更新兜底 */ }
    }
  };

  const reveal = async () => {
    try { await window.harness.filesReveal(rel, root); } catch { /* ignore */ }
  };
  const copyPath = async () => {
    try { await window.harness.clipboardWrite(rel); } catch { /* ignore */ }
  };
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
    // Markdown 里的相对文档链接：在当前 root 下打开为新的预览标签
    const raw = href.split("#")[0].split("?")[0];
    if (!raw || raw.endsWith("/")) return;
    const baseDir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const parts = (raw.startsWith("/") ? raw.slice(1) : `${baseDir}/${raw}`).split("/");
    const out: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    const target = out.join("/");
    if (target) requestFilePreview({ rel: target, name: target.split("/").pop(), root });
  };

  const bodyClass = `file-preview-body${htmlRender ? " frame" : mdRender ? " doc" : ""}`;

  return (
    <div className="file-preview-main">
      <div className="preview-head file-preview-head">
        <div className="row gap6" style={{ minWidth: 0 }}>
          <FileVisual name={name} size={15} />
          <b className="tiny ellipsis">{name}</b>
          {rel !== name && <span className="tiny faint mono ellipsis" title={rel}>{rel}</span>}
          {data?.size != null && <span className="tiny faint">{formatSize(data.size)}</span>}
        </div>
        <div className="row gap6">
          {canToggle && data?.text != null && (
            <div className="file-preview-seg" role="group" aria-label="预览模式">
              <button className={mode === "render" ? "on" : ""} onClick={() => setMode("render")}>渲染</button>
              <button className={mode === "source" ? "on" : ""} onClick={() => setMode("source")}>源码</button>
            </div>
          )}
          {htmlRender && (
            picking
              ? <button className="btn tiny-btn danger" onClick={() => void cancelPick()}>取消拾取</button>
              : <button className="btn tiny-btn primary" disabled={!ready} title="在渲染的 HTML 里点选元素，注入 Chat" onClick={() => void pickElement()}>拾取元素</button>
          )}
          <div className="row gap4">
            <button className="icon-btn" title="刷新" aria-label="刷新" onClick={refresh}><RefreshIcon size={13} /></button>
            <button className="icon-btn" title="在 Finder 中显示" aria-label="在 Finder 中显示" onClick={() => void reveal()}><RevealIcon size={13} /></button>
            <button className="icon-btn" title="复制相对路径" aria-label="复制相对路径" onClick={() => void copyPath()}><CopyIcon size={13} /></button>
            <button className="icon-btn" title="关闭预览" aria-label="关闭预览" onClick={onClose}><XIcon size={13} /></button>
          </div>
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
      {pickError && <div className="preview-error">{pickError}</div>}
      <div className={bodyClass}>
        {!data && <div className="pane-empty">加载中…</div>}
        {data?.error && <div className="preview-error">{data.error}</div>}
        {data?.dataUrl && <img src={data.dataUrl} alt={name} className="file-preview-img" />}
        {data?.text != null && isHtml && fileUrl && (
          <div className="file-preview-frame" style={{ display: htmlRender ? "flex" : "none" }}>
            <Webview
              ref={viewRef}
              key={fileUrl}
              src={fileUrl}
              partition="preview"
              webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
            />
          </div>
        )}
        {data?.text != null && !htmlRender && mdRender && (
          <div className="md-render" onClick={onRenderedClick} dangerouslySetInnerHTML={{ __html: mdHtml }} />
        )}
        {data?.text != null && !htmlRender && !mdRender && (
          <pre className="file-preview-text">{data.text}</pre>
        )}
      </div>
    </div>
  );
}

/** marked 新版默认不生成 heading id；给 README 目录锚点补上 id */
function addHeadingIds(html: string) {
  return html.replace(/<(h[1-6])>([\s\S]*?)<\/\1>/g, (_m, tag: string, inner: string) => {
    const plain = inner.replace(/<[^>]+>/g, "").trim();
    const id = slugifyHeading(plain);
    return id ? `<${tag} id="${id}">${inner}</${tag}>` : `<${tag}>${inner}</${tag}>`;
  });
}

function slugifyHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, "-")
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "");
}

function formatSize(n: number) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
