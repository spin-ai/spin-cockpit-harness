import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ElementContext, Message, State, Thread } from "../types";
import { RUN_STATUS, STATUS, activeRun, agentOf, duration, lastRun, timeAgo } from "../ui";
import { PanelCollapseIcon } from "./Icons";

type Act = (type: string, payload?: unknown) => Promise<any>;

/**
 * Chat 只有一种形态：一个会话（thread）。
 * - 未派活的会话：发一句话 = 记录；带 @别名 / 元素上下文 = 派活
 * - 已派活且有运行：发一句话 = 纠偏（带投递回执）
 * - 已派活但没运行：发一句话 = 新起一次运行
 * 任务状态与操作按钮只在 TODO LIST 行内维护，这里不再重复。
 */
export function TaskChat({ state, thread, now, act, onSelect, onNewThread, context, onClearContext, onCollapse, enterToSend = true, confirmStop = false }: {
  state: State; thread: Thread | null; now: number; act: Act; onSelect: (id: string) => void; onNewThread: () => void;
  context: ElementContext | null; onClearContext: () => void;
  onCollapse?: () => void;
  enterToSend?: boolean;
  confirmStop?: boolean;
}) {
  const todo = thread?.todoId ? state.todos.find((t) => t.id === thread.todoId) ?? null : null;
  const active = todo ? activeRun(todo, state.runs) : null;
  const last = todo ? lastRun(todo, state.runs) : null;
  const agent = agentOf(state.agents, thread?.agentId ?? todo?.agentId ?? null);
  const msgs = useMemo(() => (thread ? state.messages.filter((m) => m.threadId === thread.id) : []), [state.messages, thread]);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showTool, setShowTool] = useState(() => {
    try { return localStorage.getItem("ymh.chat.showTool") !== "0"; } catch { return true; }
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const drafts = useRef<Record<string, string>>({});
  const prevCount = useRef(0);

  const agentId = thread?.agentId ?? state.agents[0]?.id ?? "";
  const projectId = thread?.projectId ?? state.activeProjectId ?? "";
  const lastContent = msgs.length ? msgs[msgs.length - 1].content : "";

  useEffect(() => { try { localStorage.setItem("ymh.chat.showTool", showTool ? "1" : "0"); } catch { /* ignore */ } }, [showTool]);

  // 切会话时保留各自的草稿，避免打字内容丢失
  useEffect(() => {
    if (!thread) { setText(""); return; }
    setText(drafts.current[thread.id] ?? "");
    stickRef.current = true;
    setAtBottom(true);
    setUnseen(0);
    setMentionDismissed(false);
    window.setTimeout(() => textRef.current?.focus(), 0);
  }, [thread?.id]);

  const updateText = (value: string) => {
    setText(value);
    setMentionDismissed(false);
    if (thread) drafts.current[thread.id] = value;
  };

  // 跟随底部滚动；不在底部时累计新消息计数并显示「回到底部」
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
      setAtBottom(true);
      setUnseen(0);
    } else if (msgs.length > prevCount.current) {
      setUnseen((n) => n + (msgs.length - prevCount.current));
    }
    prevCount.current = msgs.length;
  }, [thread?.id, msgs.length, lastContent]);

  // 输入框随内容自动长高
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 34), 168)}px`;
  }, [text, thread?.id]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  };

  const jumpToBottom = () => {
    stickRef.current = true;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setUnseen(0);
  };

  const send = async () => {
    const value = text.trim();
    if (!value || sending || !thread) return;
    setSending(true);
    const res = await act("send", { threadId: thread.id, text: value, agentId, projectId, context: context ?? null });
    setSending(false);
    if (!res || res.mode === "error") { textRef.current?.focus(); return; } // 失败保留草稿
    setText("");
    drafts.current[thread.id] = "";
    if (context) onClearContext();
    stickRef.current = true;
    if (res.todoId) onSelect(res.todoId);
    textRef.current?.focus();
  };

  const copy = async (id: string, content: string) => {
    const ok = await copyText(content);
    if (!ok) return;
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1400);
  };

  const mentionMatch = text.match(/@([a-zA-Z0-9_.-]*)$/);
  const mentionItems = useMemo(() => {
    if (!mentionMatch) return [];
    const query = mentionMatch[1].toLowerCase();
    return [
      ...state.agents.map((a) => ({ kind: "agent", alias: a.alias || a.name, label: a.name })),
      ...state.projects.map((p) => ({ kind: "project", alias: p.alias, label: p.name })),
    ].filter((x) => x.alias.toLowerCase().startsWith(query));
  }, [mentionMatch?.[1], state.agents, state.projects]);
  const mentionOpen = mentionItems.length > 0 && !mentionDismissed;

  useEffect(() => setMentionIndex(0), [mentionMatch?.[1]]);

  const insertMention = (alias: string) => {
    const next = text.replace(/@([a-zA-Z0-9_.-]*)$/, `@${alias} `);
    updateText(next);
    setMentionDismissed(true);
    textRef.current?.focus();
  };

  // 发送行为提示：让用户明确这一句会「派活 / 纠偏 / 记录」中的哪一种
  const hasMention = Boolean(mentionMatch);
  const mode: "dispatch" | "steer" | "queue" | "run" | "chat" | "note" =
    !todo
      ? (hasMention || context ? "dispatch" : "chat")
      : todo.confirmed
        ? "note"
        : active
          ? "steer"
          : state.runs.some((r) => r.todoId === todo.id && r.status === "queued")
            ? "queue"
            : "run";

  const sendLabel = mode === "dispatch" ? "派活" : mode === "steer" ? "纠偏" : mode === "run" ? "发送并运行" : "发送";
  const modeHint = !thread
    ? ""
    : mode === "dispatch"
      ? `${agent ? `派活给 ${agent.name}` : "派活"}${context ? " · 带上元素上下文" : ""}`
      : mode === "steer"
        ? `运行中 · 发送即纠偏${todo?.confirmed ? "" : "（送达当前 run）"}`
        : mode === "queue"
          ? "已排队 · 发送后作为本轮补充指令"
          : mode === "run"
            ? "发送后新起一次运行"
            : mode === "note"
              ? "任务已确认 · 消息仅记录"
              : "普通消息只记录；输入 @别名 才派活";

  const placeholder = context
    ? (todo ? "说明这个元素要怎么改，发送即送达当前运行…" : "说明这个元素要怎么改，发送即派活…")
    : !todo
      ? "说一句话，或 @别名 派活…"
      : todo.confirmed
        ? "任务已确认，消息仅记录"
        : active
          ? "输入纠正，发送即送达当前运行…"
          : "发送后将新起一次运行…";

  const visibleMsgs = showTool ? msgs : msgs.filter((m) => m.role !== "tool" && m.kind !== "thought");
  const project = state.projects.find((p) => p.id === (thread?.projectId ?? projectId)) ?? null;
  const suggestions = !todo && msgs.length === 0
    ? [
        agent ? `@${agent.alias || agent.name} 先读一遍项目，说明结构和入口文件` : "先读一遍项目，说明结构和入口文件",
        agent ? `@${agent.alias || agent.name} 跑一下测试，修掉失败用例` : "跑一下测试，修掉失败用例",
        agent ? `@${agent.alias || agent.name} 检查当前页面的样式问题并给出改动` : "检查当前页面的样式问题并给出改动",
      ]
    : [];

  const stop = () => {
    if (!active) return;
    if (confirmStop && !window.confirm("停止当前运行？")) return;
    void act("stop", { runId: active.id });
  };

  return (
    <section className="chat-pane">
      <div className="pane-head">
        <span>CHAT</span>
        <div className="row gap6">
          {todo && <span className={`pill status ${STATUS[todo.status].cls}`}>{todo.confirmed ? "已确认" : STATUS[todo.status].label}</span>}
          <button className="link" onClick={onNewThread} title="新建会话（⌘N）">＋ 新任务</button>
          {onCollapse && (
            <button className="pane-collapse" title="收起 Chat" aria-label="收起 Chat" onClick={onCollapse}>
              <PanelCollapseIcon size={13} />
            </button>
          )}
        </div>
      </div>

      {!thread ? (
        <div className="pane-empty">点「＋ 新任务」开始一段对话。</div>
      ) : (
        <>
          <div className="thread-bar">
            <div className="row between gap6">
              <span className="mono tiny faint">{todo?.key ?? "draft"}</span>
              <span className="tiny muted ellipsis" title={thread.project || project?.path}>
                {project?.name ?? basename(thread.project)}
              </span>
            </div>
            <div className="task-title">{todo?.title ?? thread.title}</div>
            <div className="row gap6 wrap">
              <select
                className="thread-select"
                value={agentId}
                disabled={Boolean(active) || state.agents.length === 0}
                title={active ? "运行中不能换 Agent" : "Agent"}
                onChange={(e) => void act("setThreadAgent", { threadId: thread.id, agentId: e.target.value })}
              >
                {state.agents.length === 0 && <option value="">未检测到 Agent</option>}
                {state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select
                className="thread-select"
                value={projectId}
                disabled={Boolean(todo) || Boolean(active) || state.projects.length === 0}
                title={todo ? "任务已绑定项目" : "项目目录"}
                onChange={(e) => void act("setThreadProject", { threadId: thread.id, projectId: e.target.value })}
              >
                {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {active && <span className="tiny mono muted run-live">{duration(active, now)}</span>}
              {!active && last && <span className="tiny muted">上次 {RUN_STATUS[last.status] ?? last.status}</span>}
              <button
                className={`chat-toggle ${showTool ? "on" : ""}`}
                onClick={() => setShowTool((v) => !v)}
                title={showTool ? "隐藏工具调用与思考" : "显示工具调用与思考"}
              >
                {showTool ? "工具 ✓" : "工具"}
              </button>
            </div>
          </div>

          <div className="chat-body-wrap">
            <div className="chat-scroll" ref={bodyRef} onScroll={onScroll}>
              {visibleMsgs.map((m, i) => {
                const prev = visibleMsgs[i - 1];
                const showRun = Boolean(m.runId) && m.runId !== prev?.runId;
                return (
                  <Fragment key={m.id}>
                    {showRun && <RunDivider state={state} runId={m.runId as string} now={now} />}
                    <ChatMessage
                      message={m}
                      agentName={m.role === "agent" && agent ? agent.name : m.role === "user" ? "你" : m.role}
                      now={now}
                      copied={copiedId === m.id}
                      onCopy={() => void copy(m.id, m.content)}
                      onRetry={() => void act("retryMessage", { id: m.id })}
                    />
                  </Fragment>
                );
              })}
              {msgs.length === 0 && (
                <div className="chat-empty">
                  <p>{todo ? "还没有消息，补充一句要求即可继续。" : "说一句话就会创建任务；带 @别名 或拾取页面元素会直接派活。"}</p>
                  {suggestions.length > 0 && (
                    <div className="chat-suggestions">
                      {suggestions.map((s) => (
                        <button key={s} onClick={() => { updateText(s); textRef.current?.focus(); }}>{s}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {!atBottom && (
              <button className="chat-jump" onClick={jumpToBottom} title="回到底部">
                {unseen > 0 ? `${unseen} 条新消息` : "回到底部"} ↓
              </button>
            )}
          </div>

          {mentionOpen && (
            <div className="mention-pop">
              {mentionItems.slice(0, 8).map((m, i) => (
                <button
                  key={m.kind + m.alias}
                  className={i === mentionIndex ? "on" : ""}
                  onMouseEnter={() => setMentionIndex(i)}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(m.alias); }}
                >
                  <span className="mono">@{m.alias}</span>
                  <span className="tiny muted">{m.kind === "project" ? "项目 → agent" : "agent"} · {m.label}</span>
                </button>
              ))}
              <div className="mention-hint">↑↓ 选择 · Enter 插入 · Esc 关闭</div>
            </div>
          )}
          {context && (
            <div className="composer-ctx">
              <span className="ctx-tag">元素</span>
              <span className="mono ellipsis" title={context.selector}>{context.selector}</span>
              <span className="tiny faint mono">
                {context.source?.file ? `${context.source.file}${context.source.line ? `:${context.source.line}` : ""}` : context.tag}
              </span>
              <button className="link" onClick={onClearContext}>移除</button>
            </div>
          )}
          <div className="composer-bar">
            <span className={`composer-mode ${mode}`}>
              {active && <span className="live" />}
              {modeHint}
              {active && (
                <button className="link composer-stop" onClick={stop} title="停止当前运行">停止</button>
              )}
            </span>
            <span className="composer-keys">{enterToSend ? "Enter 发送 · Shift+Enter 换行" : "⌘Enter 发送 · Enter 换行"}</span>
          </div>
          <div className="composer">
            <textarea
              ref={textRef}
              rows={1}
              value={text}
              onChange={(e) => updateText(e.target.value)}
              onKeyDown={(e) => {
                if (mentionOpen) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % Math.min(mentionItems.length, 8)); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + Math.min(mentionItems.length, 8)) % Math.min(mentionItems.length, 8)); return; }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const item = mentionItems[mentionIndex]; if (item) insertMention(item.alias); return; }
                  if (e.key === "Escape") { e.preventDefault(); setMentionDismissed(true); return; }
                }
                if (e.key === "Escape") {
                  if (context) { e.preventDefault(); onClearContext(); return; }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  const mod = e.metaKey || e.ctrlKey;
                  if (!enterToSend && !mod) return;
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={placeholder}
            />
            <button className="btn primary" disabled={!text.trim() || sending} onClick={() => void send()}>
              {sending ? "发送中…" : sendLabel}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ChatMessage({ message: m, agentName, now, copied, onCopy, onRetry }: {
  message: Message; agentName: string; now: number; copied: boolean; onCopy: () => void; onRetry: () => void;
}) {
  const collapsible = (m.role === "tool" || m.kind === "thought" || m.kind === "system") && m.content.length > 220;
  const [expanded, setExpanded] = useState(false);
  const shown = collapsible && !expanded ? `${m.content.slice(0, 220).trimEnd()}…` : m.content;
  return (
    <div className={`msg ${m.role} ${m.kind}`}>
      <div className="msg-meta">
        <b>{agentName}</b>
        <span>{timeAgo(m.createdAt, now)}</span>
        {m.delivery === "pending" && <span className="delivery pending">投递中…</span>}
        {m.delivery === "injected" && <span className="delivery injected">已注入</span>}
        {m.delivery === "failed" && (
          <button className="delivery failed" onClick={onRetry} title="重新投递到当前运行">投递失败 · 重发</button>
        )}
        <button className="msg-copy" onClick={onCopy} title="复制内容">{copied ? "已复制" : "复制"}</button>
      </div>
      {m.context && (
        <div className="msg-ctx" title={`${m.context.selector}${m.context.source?.file ? ` · ${m.context.source.file}` : ""}`}>
          <span className="ctx-tag">元素</span>
          <span className="mono ellipsis">{m.context.selector}</span>
        </div>
      )}
      <div className="msg-body">
        {m.role === "agent" || m.role === "user" ? <RichText text={shown} /> : shown}
      </div>
      {collapsible && (
        <button className="msg-more link" onClick={() => setExpanded((v) => !v)}>{expanded ? "收起" : "展开全部"}</button>
      )}
    </div>
  );
}

/**
 * 轻量 Markdown：围栏代码块 + 行内 code / 粗体 / @提及 / 链接。
 * 不引入第三方依赖，也不使用 innerHTML，避免注入风险。
 */
function RichText({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "code") {
          return (
            <pre className="md-code" key={`c${i}`} data-lang={b.lang || undefined}>
              <code>{b.text}</code>
            </pre>
          );
        }
        return <span key={`t${i}`}>{inlineNodes(b.text, `t${i}`)}</span>;
      })}
    </>
  );
}

type Block = { type: "text"; text: string } | { type: "code"; text: string; lang: string };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const re = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) blocks.push({ type: "text", text: text.slice(last, m.index) });
    blocks.push({ type: "code", lang: m[1] || "", text: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < text.length) blocks.push({ type: "text", text: text.slice(last) });
  if (blocks.length === 0) blocks.push({ type: "text", text });
  return blocks;
}

function inlineNodes(text: string, keyPrefix: string): ReactNode[] {
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|@[a-zA-Z0-9_.-]+|https?:\/\/[^\s<>()]+)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) nodes.push(<code className="md-inline" key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("@")) nodes.push(<span className="md-mention" key={key}>{token}</span>);
    else nodes.push(<a key={key} href={token} target="_blank" rel="noreferrer">{token}</a>);
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

function RunDivider({ state, runId, now }: { state: State; runId: string; now: number }) {
  const run = state.runs.find((r) => r.id === runId);
  const status = run?.status ?? "";
  return (
    <div className={`run-divider ${status}`}>
      <span className="mono">{runId}</span>
      <span>{RUN_STATUS[status] ?? status ?? "未知"}</span>
      {run && <span className="mono">{duration(run, now)}</span>}
      {run?.branch && <span className="mono ellipsis" title={run.branch}>{run.branch}</span>}
    </div>
  );
}

function basename(p: string) {
  return p.split("/").filter(Boolean).slice(-1)[0] || p || "—";
}
