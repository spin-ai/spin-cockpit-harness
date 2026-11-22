import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoltIcon, PencilIcon, TrashIcon, XIcon } from "./Icons";

/**
 * 终端快捷命令（对照 ORCA 的 quick commands）。
 *
 * - 每条命令有：名称、命令内容、作用域（本项目 / 全部项目）、发送后是否回车
 * - 存在 localStorage，按项目路径分组；不新增 State 字段，也不经过主进程
 * - 发送 = 往当前窗格的 pty 写内容，和手打完全一样（Agent 正在跑的会话也能用）
 */

export interface TermQuickCommand {
  id: string;
  label: string;
  content: string;
  scope: "project" | "global";
  /** 发送后补一个回车（关掉就是只填进命令行，让你先改） */
  appendEnter: boolean;
}

const STORE_KEY = "harness.terminal.quickCommands.v1";
const GLOBAL = "*";
type Store = Record<string, TermQuickCommand[]>;

function normalize(raw: unknown): TermQuickCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const content = typeof v.content === "string" ? v.content : "";
  if (!content.trim()) return null;
  return {
    id: typeof v.id === "string" && v.id ? v.id : `qc${Math.random().toString(36).slice(2, 8)}`,
    label: typeof v.label === "string" && v.label.trim() ? v.label.trim() : content.trim().split("\n")[0].slice(0, 24),
    content,
    scope: v.scope === "global" ? "global" : "project",
    appendEnter: v.appendEnter !== false,
  };
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Store = {};
    for (const [key, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const cmds = list.map(normalize).filter((c): c is TermQuickCommand => Boolean(c));
      if (cmds.length) out[key] = cmds;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* 配额满了就当没存 */ }
}

export function useQuickCommands(projectPath: string) {
  const [store, setStore] = useState<Store>(readStore);
  const key = projectPath || GLOBAL;

  const commands = useMemo(
    () => [...(store[GLOBAL] ?? []), ...(key === GLOBAL ? [] : store[key] ?? [])],
    [store, key],
  );

  const mutate = useCallback((fn: (draft: Store) => void) => {
    setStore((cur) => {
      const draft: Store = { ...cur };
      for (const k of Object.keys(draft)) draft[k] = [...draft[k]];
      fn(draft);
      for (const k of Object.keys(draft)) if (!draft[k].length) delete draft[k];
      writeStore(draft);
      return draft;
    });
  }, []);

  const save = useCallback((cmd: TermQuickCommand) => {
    mutate((draft) => {
      const bucket = cmd.scope === "global" ? GLOBAL : key;
      const list = draft[bucket] ?? [];
      const i = list.findIndex((c) => c.id === cmd.id);
      if (i >= 0) list[i] = cmd;
      else list.push(cmd);
      draft[bucket] = list;
      /* 改了作用域：从另一个桶里摘掉 */
      const other = cmd.scope === "global" ? key : GLOBAL;
      if (draft[other]) draft[other] = draft[other].filter((c) => c.id !== cmd.id);
    });
  }, [key, mutate]);

  const remove = useCallback((id: string) => {
    mutate((draft) => {
      for (const k of Object.keys(draft)) draft[k] = draft[k].filter((c) => c.id !== id);
    });
  }, [mutate]);

  return { commands, save, remove };
}

function commandPreview(content: string) {
  const one = content.replace(/\s+/g, " ").trim();
  return one.length > 64 ? `${one.slice(0, 64)}…` : one;
}

/** 快捷命令菜单：挂在舞台头的按钮下面，也用作终端右键菜单里的「快捷命令」 */
export function QuickCommandMenu({ point, commands, onRun, onEdit, onCreate, onRemove, onClose }: {
  point: { x: number; y: number };
  commands: TermQuickCommand[];
  onRun: (cmd: TermQuickCommand) => void;
  onEdit: (cmd: TermQuickCommand) => void;
  onCreate: () => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const width = 280;
  const height = Math.min(commands.length * 44 + 62, 380);
  const left = Math.max(8, Math.min(point.x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(point.y, window.innerHeight - height - 8));

  return (
    <div ref={ref} className="term-menu term-qc-menu" style={{ left, top, width }} onContextMenu={(e) => e.preventDefault()}>
      <div className="term-qc-head">
        <span>快捷命令</span>
        <button className="term-qc-add" title="新建快捷命令" aria-label="新建快捷命令" onClick={onCreate}>
          <BoltIcon size={14} />
        </button>
      </div>
      <div className="term-qc-list">
        {commands.length === 0 ? (
          <div className="term-qc-empty">还没有快捷命令；新建后可以在终端一键发送。</div>
        ) : commands.map((cmd) => (
          <div key={cmd.id} className="term-qc-row">
            <button className="term-qc-run" title={cmd.content} onClick={() => onRun(cmd)}>
              <span className="term-qc-label">
                {cmd.label}
                {cmd.scope === "global" && <em>全局</em>}
                {!cmd.appendEnter && <em>不回车</em>}
              </span>
              <span className="term-qc-cmd">{commandPreview(cmd.content)}</span>
            </button>
            <button className="term-qc-icon" title="编辑" aria-label={`编辑 ${cmd.label}`} onClick={() => onEdit(cmd)}>
              <PencilIcon size={11} />
            </button>
            <button className="term-qc-icon" title="删除" aria-label={`删除 ${cmd.label}`} onClick={() => onRemove(cmd.id)}>
              <TrashIcon size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="term-qc-foot">
        <button className="term-qc-new" onClick={onCreate}>＋ 新建快捷命令</button>
      </div>
    </div>
  );
}

/** 新建 / 编辑快捷命令 */
export function QuickCommandDialog({ initial, onSave, onCancel }: {
  initial?: TermQuickCommand;
  onSave: (cmd: TermQuickCommand) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [scope, setScope] = useState<TermQuickCommand["scope"]>(initial?.scope ?? "project");
  const [appendEnter, setAppendEnter] = useState(initial?.appendEnter ?? true);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => { labelRef.current?.focus(); }, []);

  const submit = () => {
    const text = content.trim();
    if (!text) return;
    onSave({
      id: initial?.id ?? `qc${Math.random().toString(36).slice(2, 8)}`,
      label: label.trim() || text.split("\n")[0].slice(0, 24),
      content: text,
      scope,
      appendEnter,
    });
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        className="modal term-qc-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "编辑快捷命令" : "新建快捷命令"}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
        }}
      >
        <div className="row between gap8">
          <h3>{initial ? "编辑快捷命令" : "新建快捷命令"}</h3>
          <button className="icon-btn" title="关闭" aria-label="关闭" onClick={onCancel}><XIcon size={14} /></button>
        </div>
        <label>
          名称
          <input ref={labelRef} value={label} placeholder="例如：跑回归" maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>
          命令
          <textarea
            value={content}
            rows={4}
            placeholder="要发送到终端的命令；多行会一次性写入"
            style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        <label>
          范围
          <select value={scope} onChange={(e) => setScope(e.target.value === "global" ? "global" : "project")}>
            <option value="project">只在这个项目里出现</option>
            <option value="global">所有项目都能用</option>
          </select>
        </label>
        <label className="term-qc-check">
          <span>
            <input type="checkbox" checked={appendEnter} onChange={(e) => setAppendEnter(e.target.checked)} />
            发送后回车
          </span>
          <em>关掉就只把命令填进命令行，你可以先改再执行</em>
        </label>
        <div className="row between gap8">
          <span className="tiny faint">⌘↩ 保存</span>
          <div className="row gap8">
            <button className="btn" onClick={onCancel}>取消</button>
            <button className="btn primary" disabled={!content.trim()} onClick={submit}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}
