import { Fragment, useEffect, useRef, useState } from "react";
import type { ElementContext, State, Thread } from "../types";
import { RUN_STATUS, STATUS, activeRun, agentOf, duration, lastRun, timeAgo } from "../ui";
import { PanelCollapseIcon } from "./Icons";

type Act = (type: string, payload?: unknown) => Promise<any>;

/**
 * Chat 只有一种形态：一个会话（thread）。
 * - 未派活的会话：发一句话 = 派活
 * - 已派活且有运行：发一句话 = 纠偏（带投递回执）
 * - 已派活但没运行：发一句话 = 新起一次运行
 * 任务状态与操作按钮只在 TODO LIST 行内维护，这里不再重复。
 */
export function TaskChat({ state, thread, now, act, onSelect, onNewThread, context, onClearContext, onCollapse, enterToSend = true }: {
  state: State; thread: Thread | null; now: number; act: Act; onSelect: (id: string) => void; onNewThread: () => void;
  context: ElementContext | null; onClearContext: () => void;
  onCollapse?: () => void;
  enterToSend?: boolean;
}) {
  const todo = thread?.todoId ? state.todos.find((t) => t.id === thread.todoId) ?? null : null;
  const active = todo ? activeRun(todo, state.runs) : null;
  const last = todo ? lastRun(todo, state.runs) : null;
  const agent = agentOf(state.agents, thread?.agentId ?? todo?.agentId ?? null);
  const msgs = thread ? state.messages.filter((m) => m.threadId === thread.id) : [];

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);

  const agentId = thread?.agentId ?? state.agents[0]?.id ?? "";
  const projectId = thread?.projectId ?? state.activeProjectId ?? "";
  const lastContent = msgs.length ? msgs[msgs.length - 1].content : "";

  useEffect(() => { setText(""); }, [thread?.id]);
  useEffect(() => {
    const el = bodyRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [thread?.id, msgs.length, lastContent]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const send = async () => {
    const value = text.trim();
    if (!value || sending || !thread) return;
    setSending(true);
    const res = await act("send", { threadId: thread.id, text: value, agentId, projectId, context: context ?? null });
    setSending(false);
    if (!res || res.mode === "error") { textRef.current?.focus(); return; } // 失败保留草稿
    setText("");
    if (context) onClearContext();
    stickRef.current = true;
    if (res.todoId) onSelect(res.todoId);
    textRef.current?.focus();
  };

  const mentionMatch = text.match(/@([a-zA-Z0-9_.-]*)$/);
  const mentionItems = mentionMatch
    ? [
        ...state.agents.map((a) => ({ kind: "agent", alias: a.alias || a.name, label: a.name })),
        ...state.projects.map((p) => ({ kind: "project", alias: p.alias, label: p.name })),
      ].filter((x) => x.alias.toLowerCase().startsWith(mentionMatch[1].toLowerCase()))
    : [];
  const insertMention = (alias: string) => {
    setText(text.replace(/@([a-zA-Z0-9_.-]*)$/, `@${alias} `));
    textRef.current?.focus();
  };

  const placeholder = context
    ? (todo ? "说明这个元素要怎么改，发送即送达当前运行…" : "说明这个元素要怎么改，发送即派活…")
    : !todo
      ? "普通消息只是聊天；输入 @别名 才派活（Enter 发送）"
      : todo.confirmed
        ? "任务已确认，消息仅记录"
        : active
          ? "输入纠正，送达当前运行…"
          : "发送后将新起一次运行…";

  return (
    <section className="chat-pane">
      <div className="pane-head">
        <span>CHAT</span>
        <div className="row gap6">
          {todo && <span className={`pill status ${STATUS[todo.status].cls}`}>{todo.confirmed ? "已确认" : STATUS[todo.status].label}</span>}
          <button className="link" onClick={onNewThread}>＋ 新任务</button>
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
              <span className="tiny muted ellipsis" title={thread.project}>{basename(thread.project)}</span>
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
              {active && <span className="tiny mono muted">{duration(active, now)}</span>}
              {!active && last && <span className="tiny muted">上次 {RUN_STATUS[last.status] ?? last.status}</span>}
            </div>
          </div>

          <div className="chat-scroll" ref={bodyRef} onScroll={onScroll}>
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const showRun = Boolean(m.runId) && m.runId !== prev?.runId;
              const mine = m.role === "agent" && agent ? agent.name : m.role === "user" ? "你" : m.role;
              return (
                <Fragment key={m.id}>
                  {showRun && <RunDivider state={state} runId={m.runId as string} now={now} />}
                  <div className={`msg ${m.role} ${m.kind}`}>
                    <div className="msg-meta">
                      <b>{mine}</b>
                      <span>{timeAgo(m.createdAt, now)}</span>
                      {m.delivery === "pending" && <span className="delivery pending">投递中…</span>}
                      {m.delivery === "injected" && <span className="delivery injected">已注入</span>}
                      {m.delivery === "failed" && (
                        <button className="delivery failed" onClick={() => void act("retryMessage", { id: m.id })}>投递失败 · 重发</button>
                      )}
                    </div>
                    {m.context && (
                      <div className="msg-ctx" title={`${m.context.selector}${m.context.source?.file ? ` · ${m.context.source.file}` : ""}`}>
                        <span className="ctx-tag">元素</span>
                        <span className="mono ellipsis">{m.context.selector}</span>
                      </div>
                    )}
                    <div className="msg-body">{m.content}</div>
                  </div>
                </Fragment>
              );
            })}
            {msgs.length === 0 && (
              <div className="pane-empty">
                {todo ? "还没有消息" : "说一句话就会创建任务并排队，原话保留在这里。"}
              </div>
            )}
          </div>

          {mentionItems.length > 0 && (
            <div className="mention-pop">
              {mentionItems.slice(0, 8).map((m) => (
                <button key={m.kind + m.alias} onMouseDown={(e) => { e.preventDefault(); insertMention(m.alias); }}>
                  <span className="mono">@{m.alias}</span><span className="tiny muted">{m.kind === "project" ? "项目 → agent" : "agent"} · {m.label}</span>
                </button>
              ))}
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
          <div className="composer">
            <textarea
              ref={textRef}
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  const mod = e.metaKey || e.ctrlKey;
                  if (!enterToSend && !mod) return;
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={placeholder}
            />
            <button className="btn primary" disabled={!text.trim() || sending} onClick={() => void send()}>发送</button>
          </div>
        </>
      )}
    </section>
  );
}

function RunDivider({ state, runId, now }: { state: State; runId: string; now: number }) {
  const run = state.runs.find((r) => r.id === runId);
  return (
    <div className="run-divider">
      <span className="mono">{runId}</span>
      <span>{RUN_STATUS[run?.status ?? ""] ?? run?.status ?? "未知"}</span>
      {run && <span className="mono">{duration(run, now)}</span>}
    </div>
  );
}

function basename(p: string) {
  return p.split("/").filter(Boolean).slice(-1)[0] || p || "—";
}
