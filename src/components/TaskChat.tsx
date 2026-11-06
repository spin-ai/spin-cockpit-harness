import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ElementContext, Message, State, Thread } from "../types";
import { RUN_STATUS, STATUS, activeRun, agentOf, duration, lastRun, timeAgo } from "../ui";
import { ChevronRightIcon, PanelCollapseIcon, SendIcon } from "./Icons";

type Act = (type: string, payload?: unknown) => Promise<any>;
type ModelOption = { value: string; name: string; group?: string };
type ModelCatalog = { models: ModelOption[]; efforts: { value: string; name: string }[]; currentModel?: string; currentEffort?: string; error?: string | null };

// 同一 Agent 的模型目录在应用生命周期内只探测一次（主进程还有 10 分钟缓存）
const modelCatalogCache = new Map<string, ModelCatalog>();

/**
 * Chat 只有一种形态：一个会话（thread）。
 * - 未派活的会话：发一句话 = 建任务并派活；@别名 可指定 Agent / 项目
 * - 已派活且有运行：发一句话 = 纠偏（带投递回执）
 * - 已派活但没运行：发一句话 = 新起一次运行
 * 任务状态与操作按钮只在 TODO LIST 行内维护，这里不再重复。
 */
export function TaskChat({ state, thread, now, act, onSelect, onNewThread, onOpenThread, threads = [], context, onClearContext, onCollapse, enterToSend = true, confirmStop = false }: {
  state: State; thread: Thread | null; now: number; act: Act; onSelect: (id: string) => void; onNewThread: () => void; onOpenThread?: (id: string) => void; threads?: Thread[];
  context: ElementContext | null; onClearContext: () => void;
  onCollapse?: () => void;
  enterToSend?: boolean;
  confirmStop?: boolean;
}) {
  const todo = thread?.todoId ? state.todos.find((t) => t.id === thread.todoId) ?? null : null;
  const active = todo ? activeRun(todo, state.runs) : null;
  const last = todo ? lastRun(todo, state.runs) : null;
  const agent = agentOf(state.agents, thread?.agentId ?? todo?.agentId ?? null);
  const isRunnable = (a: (typeof state.agents)[number] | null | undefined) =>
    Boolean(a && (a.chatRunnable ?? state.executors?.find((e) => e.id === String(a.cli || "").trim().toLowerCase())?.implemented));
  const runnableAgents = state.agents.filter((a) => isRunnable(a));
  const agentRunnable = isRunnable(agent);
  const dshAvailable = state.executors?.find((e) => e.id === "dsh")?.available ?? (state.cliCapabilities ?? []).includes("dsh");
  const agentHost = agent ? state.hosts.find((h) => h.id === agent.hostId) ?? null : null;
  const localHost = state.hosts.find((h) => h.kind === "local") ?? null;
  const hostOffline = Boolean(agent && agentHost && agentHost.status === "offline");
  const msgs = useMemo(() => (thread ? state.messages.filter((m) => m.threadId === thread.id) : []), [state.messages, thread]);
  const userInputHistory = useMemo(() => msgs.filter((m) => m.role === "user").map((m) => m.content), [msgs]);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showTool, setShowTool] = useState(() => {
    try { return localStorage.getItem("cmh.chat.showTool") !== "0"; } catch { return true; }
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>({ models: [], efforts: [] });
  const [modelLoading, setModelLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inputHistoryIndex, setInputHistoryIndex] = useState<number | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const inputHistoryDraft = useRef("");

  const bodyRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const atBottomRef = useRef(true);
  const drafts = useRef<Record<string, string>>({});
  const prevCount = useRef(0);

  const agentId = thread?.agentId ?? runnableAgents[0]?.id ?? state.agents[0]?.id ?? "";
  // 作用域：空 = 全局对话；非空 = 绑定项目。主动派活时全局会话用 Agent 所在项目兜底。
  const scopeProjectId = thread?.projectId ?? "";
  const projectId = scopeProjectId || state.activeProjectId || "";
  const lastContent = msgs.length ? msgs[msgs.length - 1].content : "";

  // 模型目录：ACP session/new 的 configOptions（模型 / reasoning effort）
  useEffect(() => {
    if (!agentId) { setModelCatalog({ models: [], efforts: [] }); return; }
    const cached = modelCatalogCache.get(agentId);
    if (cached) { setModelCatalog(cached); return; }
    let alive = true;
    setModelLoading(true);
    void act("listModels", { agentId })
      .then((res) => {
        const catalog: ModelCatalog = res && Array.isArray(res.models)
          ? res
          : { models: [], efforts: [], error: String(res?.error || "") };
        if (!catalog.error) modelCatalogCache.set(agentId, catalog);
        if (alive) setModelCatalog(catalog);
      })
      .catch((e) => { if (alive) setModelCatalog({ models: [], efforts: [], error: String((e as Error)?.message || e) }); })
      .finally(() => { if (alive) setModelLoading(false); });
    return () => { alive = false; };
  }, [agentId, act]);

  const showModelPicker = Boolean(thread && (modelLoading || modelCatalog.models.length > 0 || thread.model || String(agent?.cli || "").toLowerCase() === "dsh"));
  const threadMsgCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of state.messages) counts[m.threadId] = (counts[m.threadId] || 0) + 1;
    return counts;
  }, [state.messages]);
  const historyThreads = useMemo(() => [...threads].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [threads]);

  useEffect(() => {
    if (!historyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!historyRef.current?.contains(e.target as Node)) setHistoryOpen(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [historyOpen]);

  useEffect(() => { try { localStorage.setItem("cmh.chat.showTool", showTool ? "1" : "0"); } catch { /* ignore */ } }, [showTool]);

  // TODO 行「问清楚」：把预填的澄清问题灌进对应任务的输入框（不自动发送，用户可改）
  const pendingDraft = useRef<Record<string, string>>({});
  const applyDraft = (value: string) => {
    setText(value);
    setInputHistoryIndex(null);
    if (thread) drafts.current[thread.id] = value;
    // 会话切换 / 行选中会重渲染，等一拍再聚焦，避免焦点被抢走
    const focus = () => {
      const el = textRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(value.length, value.length);
    };
    requestAnimationFrame(focus);
    window.setTimeout(focus, 160);
  };
  useEffect(() => {
    const onDraft = (e: Event) => {
      const detail = (e as CustomEvent<{ todoId?: string; text?: string }>).detail;
      if (!detail?.text) return;
      if (detail.todoId && thread?.todoId !== detail.todoId) {
        pendingDraft.current[detail.todoId] = detail.text; // 会话还没切过来，先存着
        return;
      }
      applyDraft(detail.text);
    };
    window.addEventListener("harness:chat-draft", onDraft);
    return () => window.removeEventListener("harness:chat-draft", onDraft);
  }, [thread?.todoId, thread?.id]);

  // 会话切到目标任务后补灌草稿（覆盖「事件先到、会话后到」的时序）
  useEffect(() => {
    const todoId = thread?.todoId;
    if (!todoId) return;
    const pending = pendingDraft.current[todoId];
    if (!pending) return;
    delete pendingDraft.current[todoId];
    setText(pending);
    setInputHistoryIndex(null);
    if (thread) drafts.current[thread.id] = pending;
    requestAnimationFrame(() => textRef.current?.focus());
  }, [thread?.id, thread?.todoId]);

  // 切会话时保留各自的草稿，避免打字内容丢失
  useEffect(() => {
    if (!thread) { setText(""); return; }
    setText(drafts.current[thread.id] ?? "");
    stickRef.current = true;
    atBottomRef.current = true;
    setAtBottom(true);
    setUnseen(0);
    setMentionDismissed(false);
    setInputHistoryIndex(null);
  }, [thread?.id]);

  const applyText = (value: string) => {
    setText(value);
    setMentionDismissed(false);
    if (thread) drafts.current[thread.id] = value;
  };

  const updateText = (value: string) => {
    setInputHistoryIndex(null);
    applyText(value);
  };

  const recallHistory = (dir: -1 | 1, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!userInputHistory.length) return false;
    if (dir === 1 && inputHistoryIndex === null) return false;
    if (dir === -1 && inputHistoryIndex === null) {
      if (text !== "") return false;
      e.preventDefault();
      inputHistoryDraft.current = text;
      const next = userInputHistory.length - 1;
      setInputHistoryIndex(next);
      applyText(userInputHistory[next]);
    } else if (dir === -1 && inputHistoryIndex !== null) {
      e.preventDefault();
      if (inputHistoryIndex === 0) return true;
      const next = inputHistoryIndex - 1;
      setInputHistoryIndex(next);
      applyText(userInputHistory[next]);
    } else {
      e.preventDefault();
      if (inputHistoryIndex === null) return true;
      if (inputHistoryIndex < userInputHistory.length - 1) {
        const next = inputHistoryIndex + 1;
        setInputHistoryIndex(next);
        applyText(userInputHistory[next]);
      } else {
        setInputHistoryIndex(null);
        applyText(inputHistoryDraft.current);
      }
    }
    requestAnimationFrame(() => {
      const el = textRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
    return true;
  };

  // 跟随底部滚动；用户一旦往上滚，就不再抢滚动位置
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (stickRef.current && atBottomRef.current) {
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
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  };

  const onChatWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) stickRef.current = false;
  };

  const onChatKeyDown = (e: React.KeyboardEvent) => {
    const el = bodyRef.current;
    if (!el) return;
    const page = el.clientHeight * 0.85;
    const step = 48;
    if (e.key === "ArrowUp") { e.preventDefault(); el.scrollTop -= step; }
    else if (e.key === "ArrowDown") { e.preventDefault(); el.scrollTop += step; }
    else if (e.key === "PageUp") { e.preventDefault(); el.scrollTop -= page; }
    else if (e.key === "PageDown") { e.preventDefault(); el.scrollTop += page; }
    else if (e.key === "Home") { e.preventDefault(); el.scrollTop = 0; }
    else if (e.key === "End") { e.preventDefault(); jumpToBottom(); }
    else return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickRef.current = bottom;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  };

  const jumpToBottom = () => {
    stickRef.current = true;
    atBottomRef.current = true;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setUnseen(0);
  };

  const send = async () => {
    const value = text.trim();
    if (!value || sending || !thread) return;
    setSending(true);
    const res = await act("send", { threadId: thread.id, text: value, agentId, projectId: scopeProjectId || undefined, context: context ?? null });
    setSending(false);
    if (!res || res.mode === "error") { textRef.current?.focus(); return; } // 失败保留草稿
    setText("");
    drafts.current[thread.id] = "";
    setInputHistoryIndex(null);
    inputHistoryDraft.current = "";
    if (context) onClearContext();
    stickRef.current = true;
    atBottomRef.current = true;
    if (res.todoId) onSelect(res.todoId);
    if (res.view) window.dispatchEvent(new CustomEvent("harness:view", { detail: res.view }));
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
      ...state.agents.map((a) => ({ kind: "agent", alias: a.alias || a.name, label: a.name, note: isRunnable(a) ? "" : " · 终端专用" })),
      ...state.projects.map((p) => ({ kind: "project", alias: p.alias, label: p.name, note: "" })),
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
  const firstMention = (text.match(/(?:^|\s)@([a-zA-Z0-9_.-]+)/)?.[1] || "").toLowerCase();
  // @ 目标优先于下拉选择：后端也是先解析 @别名
  const mentionedAgent = firstMention
    ? state.agents.find((a) => (a.alias || "").toLowerCase() === firstMention) || null
    : null;
  const mentionIsProject = Boolean(firstMention && state.projects.some((p) => (p.alias || "").toLowerCase() === firstMention));
  const fallbackAgent = agent ?? runnableAgents[0] ?? null;
  const dispatchAgent = mentionedAgent
    || (mentionIsProject && !isRunnable(fallbackAgent)
      ? runnableAgents.find((a) => a.projectId === projectId) || runnableAgents[0] || null
      : fallbackAgent);
  const queuedRun = todo ? state.runs.some((r) => r.todoId === todo.id && r.status === "queued") : false;
  const willRun = todo ? (!todo.confirmed && !active && !queuedRun) : true;
  const blocked = willRun && !isRunnable(dispatchAgent);
  const baseMode: "dispatch" | "steer" | "queue" | "run" | "note" =
    !todo
      ? "dispatch"
      : todo.confirmed
        ? "note"
        : active
          ? "steer"
          : queuedRun
            ? "queue"
            : "run";
  const sendLabel = blocked ? "发送" : baseMode === "dispatch" ? "派活" : baseMode === "steer" ? "纠偏" : baseMode === "run" ? "发送并运行" : "发送";
  const blockedReason = blocked
    ? (dispatchAgent ? `「${dispatchAgent.cli}」仅终端可用` : "没有可用的 Agent")
    : undefined;

  const placeholder = context
    ? "描述改动…"
    : !todo
      ? "描述要完成的事，发送后创建任务并派活…"
      : todo.confirmed
        ? "仅记录…"
        : active
          ? "输入纠正…"
          : "输入消息…";

  const project = state.projects.find((p) => p.id === scopeProjectId) ?? null;

  // 把连续的 tool / thought 收成一组，避免一屏都是工具气泡（参考 Multica 的 steps 折叠）
  type ChatItem =
    | { kind: "run"; key: string; runId: string }
    | { kind: "msg"; key: string; msg: Message }
    | { kind: "tools"; key: string; msgs: Message[] };
  const chatItems = useMemo(() => {
    const items: ChatItem[] = [];
    let group: Message[] = [];
    let prevRun = "";
    const flush = () => {
      if (!group.length) return;
      items.push({ kind: "tools", key: `tools-${group[0].id}`, msgs: group });
      group = [];
    };
    for (const m of msgs) {
      if (m.runId && m.runId !== prevRun) {
        flush();
        items.push({ kind: "run", key: `run-${m.runId}-${items.length}`, runId: m.runId });
        prevRun = m.runId;
      }
      const hidden = !showTool && (m.role === "tool" || m.kind === "thought");
      if (hidden) continue;
      if (m.role === "tool" || m.kind === "thought") group.push(m);
      else { flush(); items.push({ kind: "msg", key: m.id, msg: m }); }
    }
    flush();
    return items;
  }, [msgs, showTool]);

  const stop = () => {
    if (!active) return;
    if (confirmStop && !window.confirm("停止当前运行？")) return;
    void act("stop", { runId: active.id });
  };

  const useDshAgent = async () => {
    if (!thread) return;
    const existing = runnableAgents[0];
    if (existing) { await act("setThreadAgent", { threadId: thread.id, agentId: existing.id }); return; }
    const created = await act("createAgent", { cli: "dsh", projectId }) as { id?: string } | null;
    if (created?.id) await act("setThreadAgent", { threadId: thread.id, agentId: created.id });
  };

  return (
    <section className="chat-pane">
      <div className="pane-head">
        <span>CHAT</span>
        <div className="row gap6">
          {todo && <span className={`pill status ${STATUS[todo.status].cls}`}>{todo.confirmed ? "已确认" : STATUS[todo.status].label}</span>}
          {historyThreads.length > 1 && (
            <div className="chat-history" ref={historyRef}>
              <button className="link" onClick={() => setHistoryOpen((v) => !v)}>历史</button>
              {historyOpen && (
                <div className="chat-history-pop">
                  {historyThreads.map((item) => {
                    const itemTodo = item.todoId ? state.todos.find((t) => t.id === item.todoId) ?? null : null;
                    return (
                      <button
                        key={item.id}
                        className={`chat-history-item ${item.id === thread?.id ? "on" : ""}`}
                        onClick={() => { setHistoryOpen(false); onOpenThread?.(item.id); }}
                      >
                        <span className={`thread-dot ${itemTodo ? STATUS[itemTodo.status].cls : "todo"}`} />
                        <span className="chat-history-title ellipsis">{itemTodo?.title || item.title || "新任务"}</span>
                        <span className="chat-history-meta">{threadMsgCounts[item.id] || 0} 条 · {timeAgo(item.updatedAt, now)}前</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <button className="link" onClick={onNewThread} title="新建会话">＋ 新任务</button>
          {onCollapse && (
            <button className="pane-collapse" title="收起 Chat" aria-label="收起 Chat" onClick={onCollapse}>
              <PanelCollapseIcon size={13} />
            </button>
          )}
        </div>
      </div>

      {!thread ? (
        <div className="pane-empty">点「＋ 新任务」开始</div>
      ) : (
        <>
          <div className="thread-bar">
            <div className="thread-title-row">
              <span className={`thread-dot ${todo ? STATUS[todo.status].cls : "todo"}`} />
              <span className="thread-key mono">{todo?.key ?? "draft"}</span>
              <span className="thread-title" title={todo?.title ?? thread.title}>{todo?.title ?? thread.title}</span>
              {todo && <span className={`pill status ${STATUS[todo.status].cls}`}>{todo.confirmed ? "已确认" : STATUS[todo.status].label}</span>}
            </div>
            <div className="thread-meta">
              <span className={`thread-scope ${scopeProjectId ? "" : "global"}`} title={scopeProjectId ? "对话作用于该项目" : "全局对话：切换项目时不隐藏"}>
                {scopeProjectId ? project?.name ?? "项目" : "全局"}
              </span>
              {agent && <><span className="thread-meta-sep">/</span><span className="ellipsis" title={agent.name}>@{agent.alias || agent.name}</span></>}
              {thread.modelName && <><span className="thread-meta-sep">·</span><span className="ellipsis" title={thread.modelName}>{thread.modelName}</span></>}
              <span className="spacer" />
              {active ? (
                <>
                  <span className="run-live">{duration(active, now)}</span>
                  <button className="link composer-stop" onClick={stop}>停止</button>
                </>
              ) : last ? (
                <span className="muted">上次 {RUN_STATUS[last.status] ?? last.status}</span>
              ) : null}
            </div>
          </div>

          <div className="chat-body-wrap">
            <div
              className="chat-scroll"
              ref={bodyRef}
              tabIndex={0}
              onScroll={onScroll}
              onWheel={onChatWheel}
              onKeyDown={onChatKeyDown}
            >
              {chatItems.map((item) => {
                if (item.kind === "run") return <RunDivider key={item.key} state={state} runId={item.runId} now={now} />;
                if (item.kind === "tools") {
                  return (
                    <ToolGroup
                      key={item.key}
                      messages={item.msgs}
                      now={now}
                      copiedId={copiedId}
                      onCopy={(m) => void copy(m.id, m.content)}
                      onRetry={(m) => void act("retryMessage", { id: m.id })}
                    />
                  );
                }
                const m = item.msg;
                return (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    agentName={roleLabel(m.role, agent?.name)}
                    now={now}
                    copied={copiedId === m.id}
                    onCopy={() => void copy(m.id, m.content)}
                    onRetry={() => void act("retryMessage", { id: m.id })}
                  />
                );
              })}
              {active && atBottom && chatItems.length > 0 && (
                <div className="chat-typing" aria-label="agent 正在处理">
                  <span /><span /><span />
                  <em>{agent?.name ?? "Agent"} 正在处理</em>
                </div>
              )}
              {msgs.length === 0 && (
                <div className="chat-empty">
                  <div className="chat-empty-mark">✦</div>
                  <b>{todo ? "还没有消息" : runnableAgents.length > 0 ? "说一句话开始" : dshAvailable ? "还没有可用的 Agent" : "未检测到 dsh"}</b>
                  <p>{todo ? "在下面补充信息、纠偏或追问。" : "直接描述要完成的事；@别名 指定 Agent，或从预览里拾取元素后发送。"}</p>
                </div>
              )}
            </div>
            {!atBottom && (
              <button className="chat-jump" onClick={jumpToBottom}>
                {unseen > 0 ? `${unseen} 条新消息` : "回到底部"} ↓
              </button>
            )}
          </div>

          <div className="composer-shell">
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
                    <span className="tiny muted">{m.kind === "project" ? "项目 → agent" : "agent"} · {m.label}{m.note}</span>
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
            {agent && !agentRunnable && (
              <div className="composer-warn">
                <span className="dot red" />
                <span className="ellipsis">{agent.name} 仅终端可用</span>
                <button className="link" onClick={() => void useDshAgent()}>换用 dsh</button>
              </div>
            )}
            {hostOffline && (
              <div className="composer-warn">
                <span className="dot red" />
                <span className="ellipsis">{agent?.name} 主机离线</span>
                {localHost && localHost.id !== agentHost?.id && (
                  <button className="link" onClick={() => void act("setAgentHost", { agentId: agent!.id, hostId: localHost.id })}>改用本机</button>
                )}
              </div>
            )}
            <textarea
              ref={textRef}
              rows={1}
              value={text}
              onChange={(e) => updateText(e.target.value)}
              onKeyDown={(e) => {
                if (mentionOpen) {
                  const size = Math.min(mentionItems.length, 8);
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % size); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + size) % size); return; }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const item = mentionItems[mentionIndex]; if (item) insertMention(item.alias); return; }
                  if (e.key === "Escape") { e.preventDefault(); setMentionDismissed(true); return; }
                }
                if (e.key === "Escape") {
                  if (context) { e.preventDefault(); onClearContext(); return; }
                }
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  if (recallHistory(e.key === "ArrowUp" ? -1 : 1, e)) return;
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
            <div className="composer-foot">
              <div className="composer-chips">
                <span className="composer-label">@</span>
                {state.agents.length > 0 ? (
                  <select
                    className="composer-select"
                    value={agentId}
                    disabled={Boolean(active)}
                    title="选择 Agent"
                    onChange={(e) => void act("setThreadAgent", { threadId: thread.id, agentId: e.target.value })}
                  >
                    {state.agents.map((a) => (
                      <option key={a.id} value={a.id} disabled={!isRunnable(a)}>
                        {a.alias || a.name}{isRunnable(a) ? "" : "（终端专用）"}
                      </option>
                    ))}
                  </select>
                ) : dshAvailable ? (
                  <button className="composer-link" onClick={() => void useDshAgent()} title="创建 dsh Agent 并用于当前会话">未检测到 Agent · 用 dsh</button>
                ) : (
                  <span className="composer-none">未检测到 Agent</span>
                )}
                {state.agents.length > 0 && runnableAgents.length === 0 && dshAvailable && (
                  <button className="composer-link" onClick={() => void useDshAgent()} title="创建 dsh Agent 并用于当前会话">＋ dsh</button>
                )}
                <span className="thread-meta-sep">/</span>
                <span className="composer-label" title="对话作用域">◎</span>
                <select
                  className="composer-select"
                  value={scopeProjectId}
                  disabled={Boolean(todo) || Boolean(active) || state.projects.length === 0}
                  title="对话作用域：全局，或绑定到某个项目"
                  onChange={(e) => void act("setThreadProject", { threadId: thread.id, projectId: e.target.value || null })}
                >
                  <option value="">全局</option>
                  {state.projects.map((p) => <option key={p.id} value={p.id}>项目 · {p.name}</option>)}
                </select>
              </div>
              <div className="composer-actions">
                {showModelPicker && (
                  <>
                    <span className="composer-label" title="模型">模型</span>
                    <select
                      className="composer-select model-select"
                      value={thread.model || ""}
                      title={modelCatalog.error ? `模型列表不可用：${modelCatalog.error}` : "选择模型（对下一次运行生效）"}
                      onChange={async (e) => {
                        const value = e.target.value;
                        const item = modelCatalog.models.find((m) => m.value === value);
                        await act("setThreadModel", { threadId: thread.id, model: value, modelName: item?.name || "" });
                      }}
                    >
                      <option value="">默认{state.settings?.model ? ` · ${state.settings.model}` : ""}</option>
                      {modelLoading && modelCatalog.models.length === 0 && <option value="__loading" disabled>加载模型…</option>}
                      {modelCatalog.models.map((m) => (
                        <option key={m.value} value={m.value} title={m.group || undefined}>
                          {m.name}{m.group ? ` · ${m.group}` : ""}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <button
                  className={`chat-toggle ${showTool ? "on" : ""}`}
                  title={showTool ? "隐藏工具与思考" : "显示工具与思考"}
                  onClick={() => setShowTool((v) => !v)}
                >
                  工具
                </button>
                <span className="composer-hint">{enterToSend ? "Enter 发送 · ⇧Enter 换行" : "⌘Enter 发送"}</span>
                <button
                  className={`composer-submit mode-${baseMode}`}
                  disabled={!text.trim() || sending}
                  title={blockedReason ?? `${sendLabel} · ${enterToSend ? "Enter 发送 / Shift+Enter 换行" : "⌘Enter 发送"}`}
                  onClick={() => void send()}
                >
                  {sending ? "发送中…" : sendLabel}
                  <SendIcon size={12} />
                </button>
              </div>
            </div>
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
  const isUser = m.role === "user";
  const isSystem = m.role === "system" || m.kind === "system";
  const initial = isUser ? "你" : (agentName || "A").trim().slice(0, 1).toUpperCase();
  return (
    <div className={`msg ${m.role} kind-${m.kind} ${isUser ? "from-user" : ""} ${isSystem ? "is-system" : ""}`}>
      {!isUser && !isSystem && <div className={`msg-avatar ${m.role}`} aria-hidden>{initial}</div>}
      <div className="msg-main">
        {!isSystem && (
          <div className="msg-meta">
            <b>{agentName}</b>
            <span className="msg-time">{timeAgo(m.createdAt, now)}</span>
            {m.delivery === "pending" && <span className="delivery pending">投递中…</span>}
            {m.delivery === "injected" && <span className="delivery injected">已注入</span>}
            {m.delivery === "failed" && (
              <button className="delivery failed" onClick={onRetry}>投递失败 · 重发</button>
            )}
            <button className="msg-copy" onClick={onCopy}>{copied ? "已复制" : "复制"}</button>
          </div>
        )}
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
    </div>
  );
}

/** 连续的工具 / 思考步骤收成一行，点开看细节（参考 Multica 的 steps 折叠） */
function ToolGroup({ messages, now, copiedId, onCopy, onRetry }: {
  messages: Message[]; now: number; copiedId: string | null;
  onCopy: (m: Message) => void; onRetry: (m: Message) => void;
}) {
  const [open, setOpen] = useState(messages.length <= 2);
  const thought = messages.some((m) => m.kind === "thought");
  const summary = messages.length === 1
    ? firstLine(messages[0].content)
    : `${messages.length} 步 · ${firstLine(messages[messages.length - 1].content)}`;
  return (
    <div className={`tool-group ${open ? "open" : ""}`}>
      <button className="tool-group-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronRightIcon size={12} className="tool-group-caret" />
        <span className="tool-group-label">{thought ? "思考与工具" : "工具调用"}</span>
        <span className="tool-group-summary ellipsis">{summary}</span>
        <span className="tool-group-count">{messages.length}</span>
      </button>
      {open && (
        <div className="tool-group-body">
          {messages.map((m) => (
            <ToolRow
              key={m.id}
              message={m}
              now={now}
              copied={copiedId === m.id}
              onCopy={() => onCopy(m)}
              onRetry={() => onRetry(m)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolRow({ message: m, now, copied, onCopy, onRetry }: {
  message: Message; now: number; copied: boolean; onCopy: () => void; onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = m.content.split("\n");
  const head = (lines[0] ?? "").trim();
  const rest = lines.slice(1).join("\n").trim();
  const long = Boolean(rest) || head.length > 96;
  const shownHead = head.length > 96 ? `${head.slice(0, 96)}…` : head;
  return (
    <div className={`tool-row ${m.kind}`}>
      <span className="tool-row-dot" />
      <div className="tool-row-main">
        <div className="tool-row-head">
          <span className="mono ellipsis" title={head}>{shownHead || "（空）"}</span>
          {long && head.length <= 96 && (
            <button className="link tool-row-toggle" onClick={() => setExpanded((v) => !v)}>{expanded ? "收起" : "展开"}</button>
          )}
          <span className="tool-row-time">{timeAgo(m.createdAt, now)}</span>
        </div>
        {long && expanded && <pre className="tool-row-rest">{rest || m.content}</pre>}
        {m.delivery === "failed" && <button className="delivery failed" onClick={onRetry}>投递失败 · 重发</button>}
      </div>
      <button className="msg-copy tool-row-copy" onClick={onCopy}>{copied ? "已复制" : "复制"}</button>
    </div>
  );
}

function firstLine(text: string) {
  return (text.split("\n")[0] || "").trim().slice(0, 120);
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
        return <Fragment key={`t${i}`}>{inlineNodes(b.text, `t${i}`)}</Fragment>;
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
    else nodes.push(
      <a
        key={key}
        href={token}
        title={token}
        onClick={(e) => { e.preventDefault(); void window.harness.openExternal(token); }}
      >{token}</a>,
    );
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

function roleLabel(role: string, agentName?: string) {
  if (role === "agent") return agentName || "agent";
  if (role === "user") return "你";
  if (role === "tool") return "工具";
  if (role === "system") return "系统";
  return role;
}

function basename(p: string) {
  return p.split("/").filter(Boolean).slice(-1)[0] || p || "—";
}
