import { useCallback, useEffect, useState } from "react";
import { CopyCheckIcon, CopyIcon, EyeIcon, XIcon } from "./Icons";
import { requestFilePreview } from "../terminal-events";

/**
 * 对话内预览：文件 / 运行产出就在消息下面展开一张卡，不用跳去别的标签。
 *
 * 为什么是「卡」而不是浮层：聊天里读一段结果时，位置本身就是上下文
 * （哪一步调的工具、上面的讨论说到哪）；浮层会把人从这段上下文里抽走。
 *
 * 为什么只留一张：同时展开多张会把转录变成文件管理器；点新的就把旧的换掉。
 */

export type InlinePreviewTarget =
  | { kind: "file"; owner: string; path: string; root?: string; name?: string; line?: number }
  | { kind: "text"; owner: string; title: string; text: string; mono?: boolean }

const MAX_LINES = 80;

/** 相对路径按 root 拼；绝对路径直接用（worktree 里的 run 与项目根不一定相同） */
function absoluteOf(path: string, root?: string) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) return raw;
  const base = String(root || "").replace(/\/+$/, "");
  if (!base) return raw;
  return `${base}/${raw.replace(/^\.\//, "")}`;
}

export function useInlinePreview() {
  const [target, setTarget] = useState<InlinePreviewTarget | null>(null);
  const openFile = useCallback((owner: string, path: string, opts: { root?: string; name?: string; line?: number } = {}) => {
    const clean = String(path || "").trim();
    if (!clean) return;
    // 再点同一个 = 收起（不要求用户去卡片上找 X）
    setTarget((prev) => (prev?.kind === "file" && prev.owner === owner && prev.path === clean ? null : { kind: "file", owner, path: clean, ...opts }));
  }, []);
  const openText = useCallback((owner: string, title: string, text: string, mono = true) => {
    const body = String(text || "");
    if (!body.trim()) return;
    setTarget((prev) => (prev?.kind === "text" && prev.owner === owner && prev.text === body ? null : { kind: "text", owner, title, text: body, mono }));
  }, []);
  const close = useCallback(() => setTarget(null), []);
  return { target, openFile, openText, close };
}

type FileReadState = { loaded: boolean; text?: string; error?: string };

/** 同一次会话里反复展开同一个文件不该重读（docs:read 已经过滤二进制 / 超大 / 凭据文件） */
const fileCache = new Map<string, FileReadState>();

function useFileText(target: InlinePreviewTarget | null) {
  const path = target?.kind === "file" ? target.path : "";
  const root = target?.kind === "file" ? target.root : "";
  const abs = path ? absoluteOf(path, root) : "";
  const [state, setState] = useState<FileReadState>({ loaded: false });

  useEffect(() => {
    if (!abs) { setState({ loaded: false }); return; }
    const cached = fileCache.get(abs);
    if (cached) { setState(cached); return; }
    let alive = true;
    setState({ loaded: false });
    void window.harness.docsRead([abs])
      .then((rows) => {
        const row = Array.isArray(rows) ? rows[0] : null;
        const next: FileReadState = row?.error
          ? { loaded: true, error: row.error }
          : { loaded: true, text: row?.text || "" };
        fileCache.set(abs, next);
        if (alive) setState(next);
      })
      .catch((err) => {
        const next: FileReadState = { loaded: true, error: String((err as Error)?.message || err) };
        fileCache.set(abs, next);
        if (alive) setState(next);
      });
    return () => { alive = false; };
  }, [abs]);

  return state;
}

function lineWindow(text: string, line?: number) {
  const lines = text.split("\n");
  if (lines.length <= MAX_LINES) return { lines, total: lines.length, from: 1 };
  // 指定了行号：以它为中心开窗；否则从顶部
  const center = Math.max(1, Math.min(lines.length, Number(line) || 1));
  const from = Math.max(1, Math.min(lines.length - MAX_LINES + 1, center - Math.floor(MAX_LINES / 2)));
  return { lines: lines.slice(from - 1, from - 1 + MAX_LINES), total: lines.length, from };
}

export function InlinePreviewCard({ target, onClose }: { target: InlinePreviewTarget; onClose: () => void }) {
  const file = useFileText(target);
  const [copied, setCopied] = useState(false);
  const text = target.kind === "file" ? (file.text || "") : target.text;
  const win = lineWindow(text, target.kind === "file" ? target.line : undefined);
  const title = target.kind === "file"
    ? (target.name || target.path.split("/").filter(Boolean).pop() || target.path)
    : target.title;
  const fullPath = target.kind === "file" ? absoluteOf(target.path, target.root).replace(/^\//, "") : "";

  const copy = async () => {
    if (!text) return;
    await window.harness.clipboardWrite(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const openInTab = () => {
    if (target.kind !== "file") return;
    requestFilePreview({ rel: target.path, name: title, root: target.root });
  };

  return (
    <div className="ds-inline-preview" aria-label={`预览 ${title}`}>
      <div className="ds-ip-head">
        <span className="ds-ip-tag">{target.kind === "file" ? "文件" : "结果"}</span>
        <b className="ds-ip-title ellipsis" title={target.kind === "file" ? (fullPath || target.path) : title}>{title}</b>
        {text && <span className="ds-ip-meta">{win.total} 行{win.from > 1 ? ` · 从第 ${win.from} 行` : ""}</span>}
        <span className="ds-ip-spacer" />
        <button className="icon-btn" title={copied ? "已复制" : "复制全文"} aria-label={copied ? "已复制全文" : "复制全文"} onClick={() => void copy()} disabled={!text}>
          {copied ? <CopyCheckIcon size={14} /> : <CopyIcon size={14} />}
        </button>
        {target.kind === "file" && (
          <button className="icon-btn" title="在预览标签里打开（可以编辑 / 看目录上下文）" aria-label="在预览标签里打开" onClick={openInTab}>
            <EyeIcon size={14} />
          </button>
        )}
        <button className="icon-btn" title="收起预览" aria-label="收起预览" onClick={onClose}><XIcon size={14} /></button>
      </div>
      {file.error ? (
        <div className="ds-ip-empty">{file.error}</div>
      ) : !file.loaded && target.kind === "file" ? (
        <div className="ds-ip-empty">读取中…</div>
      ) : (
        <pre className={`ds-ip-body${target.kind === "text" && !target.mono ? " is-prose" : ""}`}>
          {win.lines.map((line, i) => {
            // 指到某一行时，就在窗口里把那一行照亮（只到页级，不做列级定位）
            const abs = win.from + i;
            const hit = target.kind === "file" && target.line ? abs === Number(target.line) : false;
            return <span key={i} className={hit ? "is-hit" : ""}>{line}{"\n"}</span>;
          })}
        </pre>
      )}
    </div>
  );
}
