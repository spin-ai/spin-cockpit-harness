import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon, RefreshIcon } from "./Icons";

/**
 * PDF 阅读器：按页向主进程要页图（pdfjs + skia 在主进程渲），渲染层只做排版与交互。
 *
 * 为什么不用 Chromium 自带的 PDF 阅读器：
 * - 自带阅读器在 webview 里没有我们的翻页 / 缩放 / 主题，暗色下是一块白；
 * - 主进程已经有稳定的 pdfjs 渲图链路（资料库的「看原页」用它），复用即可，渲染层不必打包 pdf.js。
 */

const SCALES = [1.0, 1.4, 1.8, 2.4, 3.0];

export function PdfViewer({ rel, root, name, onError }: {
  rel: string;
  root?: string;
  name: string;
  onError?: (message: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [scaleIdx, setScaleIdx] = useState(2);
  const [img, setImg] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const reqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scale = SCALES[scaleIdx];

  useEffect(() => { setPage(1); setPages(0); setImg(null); setError(""); }, [rel, root]);

  useEffect(() => {
    let alive = true;
    const req = ++reqRef.current;
    setBusy(true);
    setError("");
    void window.harness.filesPageImage(rel, root, page, scale)
      .then((res) => {
        if (!alive || req !== reqRef.current) return;
        setPages(res.pages || 1);
        setImg({ dataUrl: res.dataUrl, width: res.width, height: res.height });
      })
      .catch((e) => {
        if (!alive || req !== reqRef.current) return;
        const msg = String((e as Error)?.message || e);
        setError(msg);
        onError?.(msg);
      })
      .finally(() => { if (alive && req === reqRef.current) setBusy(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rel, root, page, scale, nonce]);

  /* 翻页后回到顶部；键盘 ←/→ PageUp/PageDown 翻页（焦点不在输入框时） */
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [page, scale]);

  const go = useCallback((delta: number) => {
    setPage((cur) => {
      const next = Math.max(1, Math.min(pages || 1, cur + delta));
      return next;
    });
  }, [pages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div className="pdf-viewer">
      <div className="pdf-bar">
        <button className="preview-icon" title="上一页（←）" aria-label="上一页" disabled={page <= 1} onClick={() => go(-1)}>
          <ChevronLeftIcon size={13} />
        </button>
        <span className="pdf-page">
          <input
            value={pages ? String(page) : ""}
            inputMode="numeric"
            aria-label="页码"
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^0-9]/g, ""));
              if (n >= 1 && n <= (pages || 1)) setPage(n);
            }}
          />
          <em>/ {pages || "…"}</em>
        </span>
        <button className="preview-icon" title="下一页（→）" aria-label="下一页" disabled={!!pages && page >= pages} onClick={() => go(1)}>
          <ChevronRightIcon size={13} />
        </button>
        <span className="pdf-sep" />
        <button className="preview-icon" title="缩小" aria-label="缩小" disabled={scaleIdx === 0} onClick={() => setScaleIdx((i) => Math.max(0, i - 1))}><MinusIcon size={13} /></button>
        <button className="pdf-zoom" title="重置为适合宽度" onClick={() => setScaleIdx(2)}>{Math.round(scale * 100)}%</button>
        <button className="preview-icon" title="放大" aria-label="放大" disabled={scaleIdx === SCALES.length - 1} onClick={() => setScaleIdx((i) => Math.min(SCALES.length - 1, i + 1))}><PlusIcon size={13} /></button>
        <span className="pdf-name ellipsis" title={name}>{name}</span>
        <button className="preview-icon" title="重新渲染这一页" aria-label="重新渲染" onClick={() => setNonce((n) => n + 1)}>
          <RefreshIcon size={12} />
        </button>
        {busy && <span className="pdf-busy">渲染中…</span>}
      </div>
      <div className="pdf-canvas" ref={scrollRef}>
        {error ? (
          <div className="inline-empty">
            <div>PDF 打不开：{error}</div>
            <div className="tiny faint">文件可能损坏或被加密；也可以用「在 Finder 中显示」交给系统应用</div>
          </div>
        ) : img ? (
          <img src={img.dataUrl} alt={`第 ${page} 页`} width={img.width} height={img.height} draggable={false} />
        ) : (
          <div className="inline-empty">正在渲染第 {page} 页…</div>
        )}
      </div>
    </div>
  );
}
