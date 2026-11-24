import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { confirmDialog } from "./ConfirmHost";
import type { Delegation, ElementContext, Message, MissionPlanRecord, Run, State, Thread, Todo } from "../types";
import { RUN_STATUS, STATUS, agentOf, duration, lastRun, missingKeyInfo, timeAgo } from "../ui";
import { CheckSquareIcon, ChevronDownIcon, CopyCheckIcon, CopyIcon, FileTextIcon, PanelExpandIcon, PanelRestoreIcon, PencilIcon, RefreshIcon, SendIcon, SparkleIcon, WrenchIcon } from "./Icons";
import { requestTerminalAdopt } from "../terminal-events";
import { RowMenu } from "./RowMenu";
import { templateOf } from "../office/templates";
import { XIcon } from "./Icons";
import { FAMILY_LABEL, FAMILY_UNIT, FAMILY_VERB, STATUS_LABEL, familyOf, formatDuration, isFileLike, objectOf, runsOfFamily, statusOf, summarizeFamilies, turnStatusOf, type ToolFamily, type ToolStatus } from "../tool-family";
import { InlinePreviewCard, useInlinePreview, type InlinePreviewTarget } from "./InlinePreview";
import { ToolFamilyIcon } from "./ToolFamilyIcon";
import { TrajectoryView, type TrajectoryRecord } from "./TrajectoryView";

/** 只读工具的人话名（和 electron/bot/tools.mjs 一一对应） */
const BOT_TOOL_LABEL: Record<string, string> = {
  memory_search: "记忆",
  knowledge_search: "资料库",
  todo_list: "任务清单",
  run_status: "运行状态",
};

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
/** 一次运行的可读产出：来源必须标清楚（文字结论 / 终端尾部 / 失败原因），不许拿终端日志冒充报告 */
function runSourceLabel(source?: string | null, error?: string | null) {
  if (source === "acp_text") return "文字结论";
  if (source === "pty_tail") return "终端输出 · 尾部";
  if (source === "error") return "失败原因";
  return error ? "失败原因" : "运行记录";
}

const RUN_FOCUS_CLAMP = 900;

function RunFocusCard({ run, todo, onOpenTerminal, onClose }: {
  run: Run; todo: Todo | null;
  onOpenTerminal: (opts: { terminalId: string; cwd: string; title: string; taskId?: string }) => void;
  onClose?: () => void;
}) {
  const text = String(run.result || run.error || "");
  // 默认收起：只在头行显示一句摘要，避免一次失败白占三行
  const [open, setOpen] = useState(false);
  const long = text.length > RUN_FOCUS_CLAMP;
  const preview = String(text.split("\n")[0] || "").trim();
  return (
    <section className={`run-focus is-${run.resultSource || "none"}`} aria-label="运行产出">
      <div className="run-focus-head">
        <span className="mono tiny">{run.id}</span>
        <span className={`pill status ${run.status === "failed" ? "failed" : run.status === "completed" ? "done" : "running"}`}>{RUN_STATUS[run.status] || run.status}</span>
        <span className="tiny muted ellipsis" title={preview}>{runSourceLabel(run.resultSource, run.error)} · {preview || "（无输出）"}</span>
        <span className="spacer" />
        {run.terminalId && (
          <button
            className="link tiny"
            title="这次运行绑定了终端：去终端里继续看 / 接着干"
            onClick={() => onOpenTerminal({ terminalId: run.terminalId!, cwd: run.cwd || todo?.cwd || "", title: todo?.title || "终端", taskId: run.todoId ?? undefined })}
          >在终端里继续</button>
        )}
        {long && (
          <button
            className="icon-btn"
            title={open ? "收起全文" : "展开全文"}
            aria-label={open ? "收起全文" : "展开全文"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          ><ChevronDownIcon size={14} className={open ? "rot-180" : ""} /></button>
        )}
        {onClose && (
          <button className="icon-btn" title="收起这次运行的产出" aria-label="收起这次运行的产出" onClick={onClose}><XIcon size={14} /></button>
        )}
      </div>
      {open && (
        <div className={`run-focus-body${run.resultSource === "pty_tail" ? " is-mono" : ""}`}>
          {run.resultSource === "pty_tail" ? <pre>{text}</pre> : <RichText text={text} />}
        </div>
      )}
    </section>
  );
}

export function TaskChat({ state, globalState, thread, now, act, onSelect, onNewThread, onOpenThread, onOpenGlobal, threads = [], context, onClearContext, onCollapse, enterToSend = true, confirmStop = false, maximized = false, onToggleMaximize, onOpenBotSettings, embedded = false, focusRun = null, onClearFocusRun }: {
  state: State; globalState?: State; thread: Thread | null; now: number; act: Act; onSelect: (id: string) => void; onNewThread: () => void; onOpenThread?: (id: string) => void; onOpenGlobal?: (id: string) => void; threads?: Thread[];
  context: ElementContext | null; onClearContext: () => void;
  onCollapse?: () => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  enterToSend?: boolean;
  confirmStop?: boolean;
  /** 嵌在终端标签里（工作台）：不写区域名、不占 pane 控制 */
  embedded?: boolean;
  /** 这次对话聚焦哪一次运行：它决定「产出物」那一条显示谁的结论 */
  focusRun?: Run | null;
  onClearFocusRun?: () => void;
  /** 机器人会话：在工作区右侧打开配置抽屉 */
  onOpenBotSettings?: () => void;
}) {
  const todo = thread?.todoId ? state.todos.find((t) => t.id === thread.todoId) ?? null : null;
  /** 机器人会话：走 botChat（它用自己的口吻回答），不走派活 / run */
  const botThread = thread?.kind === "bot" && thread.botId ? thread.botId : null;
  const bot = botThread ? (state.bots ?? []).find((b) => b.id === botThread) ?? null : null;
  const mission = todo?.kind === "mission" ? todo : null;
  const missionPlans = mission ? (state.missionPlans ?? []).filter((p) => p.missionId === mission.id) : [];
  const latestPlan = [...missionPlans].sort((a, b) => b.revision - a.revision)[0] ?? null;
  const delegations = mission ? (state.delegations ?? []).filter((d) => d.missionId === mission.id) : [];
  const activeRuns = todo ? state.runs.filter((r) => r.todoId === todo.id && ["running", "waiting_input", "waiting_plan", "waiting_children"].includes(r.status)) : [];
  const [steerRunId, setSteerRunId] = useState("");
  const active = activeRuns.find((r) => r.id === steerRunId) || activeRuns[0] || null;
  const last = todo ? lastRun(todo, state.runs) : null;
  /** 对话内预览：工具行里的文件路径就地展开，不跳标签（一次只留一张，点新的换旧的） */
  const preview = useInlinePreview();
  /** 工具输出里的路径按哪条 run 的 cwd 解析：worktree 里的改动不在项目根 */
  const previewRoot = last?.cwd || todo?.cwd || state.projectPath;
  useEffect(() => {
    if (!activeRuns.length) { if (steerRunId) setSteerRunId(""); return; }
    if (!activeRuns.some((r) => r.id === steerRunId)) setSteerRunId(activeRuns[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRuns.map((r) => r.id).join(",")]);
  const agent = agentOf(state.agents, thread?.agentId ?? todo?.agentId ?? null);
  const isRunnable = (a: (typeof state.agents)[number] | null | undefined) =>
    Boolean(a && (a.chatRunnable ?? state.executors?.find((e) => e.id === String(a.cli || "").trim().toLowerCase())?.implemented));
  const runnableAgents = state.agents.filter((a) => isRunnable(a));
  const workerRunnable = runnableAgents.filter((a) => a.role !== "supervisor");
  const agentRunnable = isRunnable(agent);
  const dshAvailable = state.executors?.find((e) => e.id === "dsh")?.available ?? (state.cliCapabilities ?? []).includes("dsh");
  const agentHost = agent ? state.hosts.find((h) => h.id === agent.hostId) ?? null : null;
  const localHost = state.hosts.find((h) => h.kind === "local") ?? null;
  const hostOffline = Boolean(agent && agentHost && agentHost.status === "offline");
  // 被「编辑后重发」取代的消息不再展示：新回答紧跟在编辑后的提问下面
  const msgs = useMemo(() => (thread ? state.messages.filter((m) => m.threadId === thread.id && !m.supersededBy) : []), [state.messages, thread]);
  const lastAgentId = useMemo(() => [...msgs].reverse().find((m) => m.role === "agent")?.id ?? null, [msgs]);
  const userInputHistory = useMemo(() => msgs.filter((m) => m.role === "user").map((m) => m.content), [msgs]);
  // 运行中的「正在处理」需要细节：第几步、刚做了什么、跑了多久
  const liveSteps = useMemo(() => {
    type LiveStep = { id: string; kind: string; text: string; detail: string; at: number; family: ToolFamily; status: ToolStatus };
    if (!active) return { total: 0, all: [] as LiveStep[], recent: [] as LiveStep[] };
    const steps: LiveStep[] = state.messages
      .filter((m) => m.runId === active.id && (m.kind === "tool" || m.kind === "thought" || m.kind === "approval"))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => {
        if (m.kind === "approval") {
          return { id: m.id, kind: m.kind, text: `审批 · ${m.meta?.decision || "已处理"}`, detail: m.meta?.title || "", at: m.createdAt, family: "plan" as ToolFamily, status: "done" as ToolStatus };
        }
        if (m.kind === "thought") return { id: m.id, kind: m.kind, text: firstLine(m.content), detail: "", at: m.createdAt, family: "think" as ToolFamily, status: "done" as ToolStatus };
        const { head, rest } = normalizeToolContent(m.content);
        return { id: m.id, kind: m.kind, text: head, detail: firstLine(rest), at: m.createdAt, family: familyOf(m.meta, { content: head }), status: statusOf(m.meta) };
      })
      .filter((step) => step.text);
    return { total: steps.length, all: [...steps].reverse(), recent: steps.slice(-6).reverse() };
  }, [active, state.messages]);

  // 任务会话的轨迹：按 run 分段（一段 run = 一"轮"），记录 user / 模型 / 思考 / 工具
  const trajectory = useMemo<TrajectoryRecord[]>(() => {
    const out: TrajectoryRecord[] = [];
    const order: string[] = [];
    for (const m of msgs) {
      const id = m.runId || "thread";
      if (!order.includes(id)) order.push(id);
    }
    order.forEach((runId, index) => {
      const turn = index + 1;
      for (const m of msgs.filter((x) => (x.runId || "thread") === runId)) {
        const base = { turn, turnId: runId, at: m.createdAt, ms: 1 };
        if (m.kind === "thought") out.push({ ...base, id: m.id, kind: "thought", title: "思考", text: String(m.content || "").trim() });
        else if (m.role === "user") out.push({ ...base, id: m.id, kind: "user", title: "用户", text: String(m.content || "").trim() });
        else if (m.kind === "tool") {
          const meta = m.meta;
          const head = normalizeToolContent(m.content).head;
          out.push({
            ...base, id: m.id, kind: "tool",
            title: meta?.title || head,
            args: meta?.input || head,
            result: meta?.output || "",
            ms: meta?.durationMs || 1,
          });
        } else if (m.kind === "approval") out.push({ ...base, id: m.id, kind: "context", title: `审批 · ${m.meta?.decision || ""}`, text: m.meta?.title || "" });
        else if (m.role === "agent" || m.role === "system") {
          // 助手记录带上这次 run 的用量：轨迹里能回答「这句花了多少、跑了多久」
          const run = state.runs.find((r) => r.id === runId) ?? null;
          const usage = run
            ? [run.tokens ? `${run.tokens} tokens` : "", run.startedAt ? duration(run, now) : ""].filter(Boolean).join(" · ") || undefined
            : undefined;
          out.push({ ...base, id: m.id, kind: "assistant", title: "助手", text: String(m.content || "").trim(), usage });
        }
      }
    });
    return out;
  }, [msgs]);

  const jumpToRun = useCallback((runId: string) => {
    setChatTab("chat");
    window.setTimeout(() => {
      const el = document.querySelector(`[data-run-id="${runId}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 40);
  }, []);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  /** 中栏：对话 / 轨迹（和 BOT 会话同一套轨迹视图，任务会话按 run 分段） */
  const [chatTab, setChatTab] = useState<"chat" | "trajectory">("chat");
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
  /** 机器人会话的流式回复：消息要等整轮结束才落库，不在这里拼就看不到“及时回复” */
  const [botStream, setBotStream] = useState("");
  const [botPending, setBotPending] = useState<string | null>(null);
  const [botBusy, setBotBusy] = useState(false);
  /** 它正在调哪个只读工具（查记忆 / 查任务），让"打字中"有具体内容 */
  const [botTool, setBotTool] = useState<string | null>(null);
  useEffect(() => {
    setBotStream("");
    setBotPending(null);
    setBotBusy(false);
    setBotTool(null);
    if (!botThread) return;
    const offDelta = window.harness.onBotDelta?.((payload) => {
      if (payload.botId !== botThread) return;
      botDeltaBuf.current += payload.delta;
      if (botDeltaRaf.current) return;
      botDeltaRaf.current = requestAnimationFrame(() => {
        botDeltaRaf.current = 0;
        const next = botDeltaBuf.current;
        botDeltaBuf.current = "";
        if (next) setBotStream((prev) => prev + next);
      });
    });
    const offTool = window.harness.onBotTool?.((payload) => {
      if (payload.botId !== botThread) return;
      setBotTool(payload.phase === "start" ? payload.name : null);
    });
    return () => {
      offDelta?.(); offTool?.();
      if (botDeltaRaf.current) { cancelAnimationFrame(botDeltaRaf.current); botDeltaRaf.current = 0; }
      botDeltaBuf.current = "";
    };
  }, [botThread]);
  // Mission 面板占的高度按 mission 记：默认收起（有待审批计划时才展开），聊天区优先
  const missionDockKey = mission ? `cmh.chat.missionDock.${mission.id}` : "";
  const [missionOpen, setMissionOpen] = useState(false);
  useEffect(() => {
    if (!missionDockKey) { setMissionOpen(false); return; }
    let saved: string | null = null;
    try { saved = localStorage.getItem(missionDockKey); } catch { saved = null; }
    setMissionOpen(saved === null ? latestPlan?.status === "draft" : saved === "1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionDockKey, latestPlan?.status]);
  const toggleMission = () => {
    setMissionOpen((open) => {
      try { if (missionDockKey) localStorage.setItem(missionDockKey, open ? "0" : "1"); } catch { /* 忽略 */ }
      return !open;
    });
  };
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressScope, setProgressScope] = useState<"session" | "project" | "all">("all");
  const [previewAllocation, setPreviewAllocation] = useState(true);
  const [chatOnly, setChatOnly] = useState(false);
  const [proposal, setProposal] = useState<{
    text: string; projectId: string | null; projectName: string;
    agentId: string; agentName: string; agentAlias: string;
    runtime: "acp" | "terminal"; worktree: string; reason: string; summary: string;
  } | null>(null);
  const [inputHistoryIndex, setInputHistoryIndex] = useState<number | null>(null);
  const inputHistoryDraft = useRef("");

  const bodyRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const atBottomRef = useRef(true);
  const drafts = useRef<Record<string, string>>({});
  /** 中文输入法：候选态的回车只上屏（Chromium 会同时给 keyCode 229 与 isComposing） */
  const composingRef = useRef(false);
  /** 机器人流式增量按帧合并：每个 delta 都 setState 会把长会话拖成幻灯片 */
  const botDeltaBuf = useRef("");
  const botDeltaRaf = useRef(0);
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
    setProposal(null);
    setChatOnly(false);
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
    setProposal(null);
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

  // 流式回复也要跟着滚：否则每来一段都得自己手动拉到底部
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [botStream, botBusy]);

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

  const send = async (override?: { text?: string; allocation?: { projectId: string | null; agentId: string } }) => {
    const value = (override?.text ?? text).trim();
    if (!value || sending || !thread) return;
    if (botThread) {
      setSending(true);
      setBotPending(value);
      setBotStream("");
      setBotTool(null);
      setBotBusy(true);
      try {
        const res = await act("botChat", { botId: botThread, text: value, threadId: thread.id });
        if (!res) { textRef.current?.focus(); return; } // 失败保留草稿
        setText("");
        drafts.current[thread.id] = "";
        setInputHistoryIndex(null);
        inputHistoryDraft.current = "";
        stickRef.current = true;
        atBottomRef.current = true;
      } finally {
        setSending(false);
        setBotBusy(false);
        setBotPending(null);
        setBotStream("");
        setBotTool(null);
      }
      return;
    }
    if (!todo && !override && !chatOnly && previewAllocation) {
      setSending(true);
      const p = await act("proposeDispatch", { threadId: thread.id, text: value, agentId, projectId: scopeProjectId || undefined });
      setSending(false);
      if (p) setProposal({ ...p, text: value });
      return;
    }
    setSending(true);
    // 纯聊天 / 只聊：走无 Todo 的对话 Run；发送仍然是一次明确动作
    const useChat = !todo && (chatOnly || pureChat);
    const res = useChat
      ? await act("chat", { threadId: thread.id, text: value, agentId, projectId: scopeProjectId || undefined })
      : await act("send", {
        threadId: thread.id, text: value, agentId, projectId: scopeProjectId || undefined,
        context: context ?? null, allocation: override?.allocation,
        runId: activeRuns.length > 1 ? active?.id : undefined,
      });
    setSending(false);
    if (!res || res.mode === "error") { textRef.current?.focus(); return; } // 失败保留草稿
    setText("");
    drafts.current[thread.id] = "";
    setInputHistoryIndex(null);
    inputHistoryDraft.current = "";
    setProposal(null);
    if (context) onClearContext();
    stickRef.current = true;
    atBottomRef.current = true;
    if (res.mode === "terminal") {
      try {
        const created = await window.harness.createTerminal(res.cwd, {
          command: res.command,
          projectId: res.projectId,
          todoId: res.todoId,
          agentId: res.agentId,
          branch: res.branch,
          initialInput: res.prompt,
          cols: 120,
          rows: 32,
        });
        requestTerminalAdopt({ terminalId: created.id, cwd: created.cwd, title: res.title, taskId: res.todoId, branch: res.branch });
      } catch (err) {
        window.dispatchEvent(new CustomEvent("harness:toast", { detail: `终端启动失败：${String((err as Error)?.message || err)}` }));
      }
    }
    if (res.todoId) onSelect(res.todoId);
    if (res.view) window.dispatchEvent(new CustomEvent("harness:view", { detail: res.view }));
    textRef.current?.focus();
  };

  const regenerate = async () => {
    if (!thread || active || sending) return;
    setSending(true);
    const res = await act("regenerate", { threadId: thread.id });
    setSending(false);
    if (!res) return;
    stickRef.current = true;
    atBottomRef.current = true;
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
      ...state.agents.map((a) => ({ kind: "agent", alias: a.alias || a.name, label: a.name, note: isRunnable(a) ? (a.chatRuntime === "terminal" ? " · 终端" : "") : " · 未安装" })),
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
  /** 纯聊天：无 Todo 的受管对话 Run（thread.chatOnly）；可随时「转为任务」 */
  const pureChat = !todo && Boolean(thread?.chatOnly);
  const activeChatRun = pureChat
    ? (globalState ?? state).runs.find((r) => r.threadId === thread?.id && !r.todoId && ["queued", "running", "waiting_input"].includes(r.status))
    : null;
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
  const terminalDispatch = !todo && dispatchAgent?.chatRuntime === "terminal";
  const sendLabel = botThread ? "发送" : blocked ? "发送" : pureChat ? (activeChatRun ? "纠偏" : "发送") : baseMode === "dispatch" ? (chatOnly ? "只聊" : previewAllocation ? "预览分配" : terminalDispatch ? "终端派活" : "派活") : baseMode === "steer" ? "纠偏" : baseMode === "run" ? "发送并运行" : "发送";
  const blockedReason = blocked
    ? (dispatchAgent ? (dispatchAgent.chatRuntime === "terminal" ? `未检测到 ${dispatchAgent.cli}` : `「${dispatchAgent.cli}」仅终端可用`) : "没有可用的 Agent")
    : undefined;

  const placeholder = botThread
    ? "回复机器人（它会用自己的口吻回答）…"
    : context
    ? "描述改动…"
    : !todo
      ? (pureChat ? "输入消息…" : "描述要完成的事，发送后创建任务并派活…")
      : todo.confirmed
        ? "仅记录…"
        : active
          ? "输入纠正…"
          : "输入消息…";

  const project = state.projects.find((p) => p.id === scopeProjectId) ?? null;
  const gs = globalState || state;
  const progressTodo = (todoId: string) => gs.todos.find((t) => t.id === todoId) || null;
  const progressInScope = (todoId: string) => {
    const t = progressTodo(todoId);
    if (progressScope === "session") return Boolean(todo?.id && todoId === todo.id);
    if (progressScope === "project") {
      const pid = todo?.projectId || scopeProjectId || state.activeProjectId;
      return Boolean(t && (!pid || t.projectId === pid));
    }
    return true;
  };
  const progressRuns = (gs.runs || [])
    .filter((r) => ["queued", "running", "waiting_input"].includes(r.status) && progressInScope(r.todoId ?? ""))
    .sort((a, b) => (b.startedAt || b.createdAt || 0) - (a.startedAt || a.createdAt || 0));
  const progressReview = (gs.todos || [])
    .filter((t) => t.kind !== "chat" && t.status === "in_review" && !t.confirmed && progressInScope(t.id))
    .slice(0, 5);
  const progressTerminals = (gs.terminals || [])
    .filter((t) => t.status === "running" && (progressScope === "all" || (t.projectId && (t.projectId === (todo?.projectId || scopeProjectId || state.activeProjectId)))))
    .filter((t) => !progressRuns.some((r) => r.terminalId === t.id));
  const progressCount = progressRuns.length + progressReview.length + progressTerminals.length;

  const openGlobalTodo = (todoId: string) => {
    if (onOpenGlobal) onOpenGlobal(todoId);
    else onSelect(todoId);
  };
  const openGlobalTerminal = (t: { terminalId: string; cwd: string; title: string; taskId?: string | null }) => {
    requestTerminalAdopt({ terminalId: t.terminalId, cwd: t.cwd, title: t.title, taskId: t.taskId || undefined });
  };
  const promoteChat = async () => {
    if (todo) {
      const res = await act("promoteChat", { id: todo.id });
      if (res) onSelect(todo.id);
      return;
    }
    // 纯聊天（无 Todo）：建真实任务，历史 run 原样挂上去
    const res = await act("promoteThreadToTodo", { threadId: thread!.id });
    if (res?.id) onSelect(res.id);
  };

  // 把连续的 tool / thought 收成一组，避免一屏都是工具气泡
  type ChatItem =
    | { kind: "run"; key: string; runId: string }
    | { kind: "msg"; key: string; msg: Message }
    | { kind: "tools"; key: string; msgs: Message[] }
    | { kind: "approval"; key: string; msg: Message }
    | { kind: "thought"; key: string; msg: Message };
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
      // 思考过程单独成块：默认就露一行，不用先展开工具组才看得到
      if (m.kind === "thought") { flush(); items.push({ kind: "thought", key: `thought-${m.id}`, msg: m }); continue; }
      // 审批在流里留痕：模态关掉后还能回看批了什么
      if (m.kind === "approval") { flush(); items.push({ kind: "approval", key: `approval-${m.id}`, msg: m }); continue; }
      if (m.role === "tool") group.push(m);
      else { flush(); items.push({ kind: "msg", key: m.id, msg: m }); }
    }
    flush();
    return items;
  }, [msgs, showTool]);

  /** 直接跳到该 Mission 的航母舞台；没有航母场景时按 Mission 角色建一个再跳 */
  const openCarrier = async () => {
    const projectId = todo?.projectId ?? state.activeProjectId ?? null;
    const mark = (sceneId: string | null | undefined) => window.dispatchEvent(new CustomEvent("harness:view", { detail: { view: "scene", sceneId: sceneId || null } }));
    const agentIds = new Set([mission?.agentId, ...delegations.map((d) => d.agentId)].filter(Boolean) as string[]);
    const carriers = (state.coordinationScenes ?? []).filter((s) => (s.projectId || null) === (projectId || null) && templateOf(s.template) === "carrier");
    // 同一个项目可能有好几个航母场景：优先选阵容就是这个 Mission 那几个 Agent 的那个
    const existing = carriers.find((s) => (s.config?.cast ?? []).some((member) => member.agentId && agentIds.has(member.agentId))) ?? carriers[0];
    if (existing) { mark(existing.id); return; }
    const cast = mission
      ? [
          { agentId: mission.agentId, role: "lead" as const, seat: null },
          ...delegations.map((d, index) => ({ agentId: d.agentId, role: "worker" as const, seat: index })),
        ]
      : [];
    const created = await act("coordinationSceneSave", {
      projectId,
      name: `${(mission?.title || todo?.title || "任务").slice(0, 12)} · 弹射`,
      template: "carrier",
      config: { cast, prefs: {} },
    });
    mark(created?.id ?? null);
  };

  const stop = async () => {
    if (!active) return;
    if (confirmStop && !(await confirmDialog("停止当前运行？"))) return;
    void act("stop", { runId: active.id });
  };

  const useDshAgent = async () => {
    if (!thread) return;
    const existing = workerRunnable[0];
    if (existing) { await act("setThreadAgent", { threadId: thread.id, agentId: existing.id }); return; }
    const created = await act("createAgent", { cli: "dsh", role: "worker", projectId }) as { id?: string } | null;
    if (created?.id) await act("setThreadAgent", { threadId: thread.id, agentId: created.id });
  };
  const useSupervisor = async () => {
    if (!thread) return;
    const existing = state.agents.find((a) => a.role === "supervisor" && isRunnable(a));
    if (existing) { await act("setThreadAgent", { threadId: thread.id, agentId: existing.id }); return; }
    const created = await act("createAgent", { cli: "dsh", projectId, role: "supervisor" }) as { id?: string } | null;
    if (created?.id) await act("setThreadAgent", { threadId: thread.id, agentId: created.id });
  };

  return (
    <section className={`chat-pane${embedded ? " is-embedded" : ""}${maximized ? " pane-max-target" : ""}`} tabIndex={0} aria-label="Chat">
      {/* 嵌入终端标签时不再占一行 chrome：区域名由标签承担，只把「会话与进展」浮在右上角 */}
      <div className={embedded ? "chat-float-head" : "pane-head"} onDoubleClick={(event) => { if (!embedded && !(event.target as HTMLElement).closest("button")) onToggleMaximize?.(); }}>
        {!embedded && <span>Chat</span>}
        <div className="row gap6">
          <RowMenu title="会话与进展">
            {historyThreads.length > 1 && (
              <>
                <div className="row-menu-label">历史会话</div>
                {historyThreads.slice(0, 8).map((item) => {
                  const itemTodo = item.todoId ? state.todos.find((t) => t.id === item.todoId) ?? null : null;
                  return (
                    <button
                      key={item.id}
                      className={item.id === thread?.id ? "on" : ""}
                      title={itemTodo?.title || item.title || "新任务"}
                      onClick={() => onOpenThread?.(item.id)}
                    >
                      <span className="row-menu-title">{itemTodo ? `${itemTodo.key} ` : ""}{itemTodo?.title || item.title || "新任务"}</span>
                      <span className="row-menu-hint">{threadMsgCounts[item.id] || 0} 条</span>
                    </button>
                  );
                })}
              </>
            )}
            <button onClick={() => setProgressOpen((v) => !v)} title="所有项目 / 终端的全局进展">
              {progressOpen ? "收起全局进展" : `全局进展${progressCount > 0 ? ` ${progressCount}` : ""}`}
            </button>
          </RowMenu>
          {onToggleMaximize && !embedded && (
            <button className="pane-collapse" title={maximized ? "还原（Esc）" : "最大化"} aria-label={maximized ? "还原 Chat" : "最大化 Chat"} onClick={onToggleMaximize}>
              {maximized ? <PanelRestoreIcon size={14} /> : <PanelExpandIcon size={14} />}
            </button>
          )}
          {onCollapse && !embedded && (
            <button className="pane-collapse" title="收起 Chat" aria-label="收起 Chat" aria-expanded={true} onClick={onCollapse}>
              <ChevronDownIcon size={14} className="rot-180" />
            </button>
          )}
        </div>
      </div>

      {progressOpen && (
        <div className="chat-progress">
          <div className="chat-progress-head">
            <span>全局进展</span>
            <div className="seg">
              {([["session", "当前会话"], ["project", "当前项目"], ["all", "所有项目"]] as const).map(([id, label]) => (
                <button key={id} className={progressScope === id ? "on" : ""} onClick={() => setProgressScope(id)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="chat-progress-list">
            {progressRuns.slice(0, 8).map((run) => {
              const t = run.todoId ? progressTodo(run.todoId) : null;
              const a = agentOf(gs.agents, run.agentId);
              return (
                <div key={run.id} className="chat-progress-row">
                  <button className="progress-main" onClick={() => run.todoId && openGlobalTodo(run.todoId)} title={t?.title || run.todoId || "探索运行"}>
                    <span className={`dot ${run.status === "waiting_input" ? "amber" : run.status === "queued" ? "slate" : "green"}`} />
                    <span className="ellipsis">{t ? `${t.key} ${t.title}` : `探索 · ${run.id}`}</span>
                    <em>{a?.name || "Agent"} · {RUN_STATUS[run.status] || run.status} · {duration(run, now)}</em>
                  </button>
                  <span className="row gap4">
                    {run.terminalId && <button className="link tiny" onClick={() => openGlobalTerminal({ terminalId: run.terminalId!, cwd: t?.cwd || run.cwd || "", title: t?.title || "终端", taskId: run.todoId })}>终端</button>}
                    <button className="link tiny" onClick={async () => { if (!confirmStop || await confirmDialog("停止这个运行？")) void act("stop", { runId: run.id }); }}>停止</button>
                  </span>
                </div>
              );
            })}
            {progressTerminals.slice(0, 6).map((term) => {
              const a = agentOf(gs.agents, term.agentId);
              return (
                <div key={term.id} className="chat-progress-row">
                  <button className="progress-main" onClick={() => openGlobalTerminal({ terminalId: term.id, cwd: term.cwd, title: term.title })} title={term.cwd}>
                    <span className="dot green" />
                    <span className="ellipsis">{term.title || "终端"}</span>
                    <em>{a?.name || "未绑定任务"} · 运行中 · {timeAgo(term.createdAt, now)}前</em>
                  </button>
                  <span className="row gap4">
                    <button className="link tiny" onClick={() => openGlobalTerminal({ terminalId: term.id, cwd: term.cwd, title: term.title })}>打开</button>
                    <button className="icon-btn" title="结束进程（不可恢复）" aria-label="结束进程" onClick={() => void window.harness.closeTerminal(term.id)}><XIcon size={14} /></button>
                  </span>
                </div>
              );
            })}
            {progressReview.map((t) => (
              <div key={t.id} className="chat-progress-row">
                <button className="progress-main" onClick={() => openGlobalTodo(t.id)}>
                  <span className="dot amber" />
                  <span className="ellipsis">{t.key} {t.title}</span>
                  <em>待确认</em>
                </button>
                <button className="link tiny" onClick={() => openGlobalTodo(t.id)}>打开</button>
              </div>
            ))}
            {progressCount === 0 && <div className="chat-progress-empty">这个范围没有运行中或待处理的事项。</div>}
          </div>
        </div>
      )}

      {!thread ? (
        <div className="chat-empty-inline">
          <span className="inline-empty">还没有会话。新建一个，或点一条任务回到它的对话。</span>
          <button className="btn tiny" onClick={onNewThread} title="新建会话（⌘N）">新建会话</button>
        </div>
      ) : (
        <>
          <div className="thread-bar">
            <div className="thread-title-row">
              <span
                className={`thread-dot ${botThread ? "running" : todo ? STATUS[todo.status].cls : "todo"}`}
                title={botThread ? "机器人会话" : todo ? (todo.confirmed ? "已确认" : STATUS[todo.status].label) : "草稿"}
              />
              <span className="thread-title" title={todo?.title ?? thread.title}>{todo?.title ?? thread.title}</span>
              {active && <span className="run-live tiny">{duration(active, now)}</span>}
            </div>
            <div className="ds-chat-tabs" role="tablist" aria-label="会话视图">
              <button role="tab" aria-selected={chatTab === "chat"} className={chatTab === "chat" ? "on" : ""} onClick={() => setChatTab("chat")}>对话</button>
              <button role="tab" aria-selected={chatTab === "trajectory"} className={chatTab === "trajectory" ? "on" : ""} onClick={() => setChatTab("trajectory")}>轨迹</button>
            </div>
            <div className="thread-meta">
              {mission && (
                <button className="link tiny" onClick={() => void openCarrier()} title="在航母舞台上看这个 Mission 的弹射起飞">看弹射</button>
              )}
              {(todo?.kind === "chat" || (!thread.todoId && thread.chatOnly)) && (
                <button className="link tiny" onClick={() => void promoteChat()} title="把这段聊天变成 TODO 任务（历史运行原样挂上去）">转为任务</button>
              )}
              {activeRuns.length > 1 ? (
                <>
                  <select className="composer-select" value={active?.id || ""} onChange={(e) => setSteerRunId(e.target.value)} title="选择这次纠偏的目标 Agent">
                    {activeRuns.map((r) => <option key={r.id} value={r.id}>{agentOf(state.agents, r.agentId)?.name || r.agentId}</option>)}
                  </select>
                  <button className="link composer-stop" onClick={stop}>停止</button>
                </>
              ) : active ? (
                <button className="link composer-stop" onClick={stop}>停止</button>
              ) : null}
              {botBusy && botThread && (
                <button className="link composer-stop" onClick={() => void act("botCancel", { botId: botThread })}>停止</button>
              )}
              <RowMenu title="会话信息">
                {botThread && onOpenBotSettings && (
                  <button onClick={onOpenBotSettings}>配置机器人</button>
                )}
                <div className="row-menu-info">
                  {todo && <div><span>任务</span><em className="mono">{todo.key}</em></div>}
                  <div><span>作用域</span><em>{botThread ? "机器人" : scopeProjectId ? project?.name ?? "项目" : "全局"}</em></div>
                  {agent && <div><span>Agent</span><em>{agent.alias || agent.name}</em></div>}
                  {thread.modelName && <div><span>模型</span><em>{thread.modelName}</em></div>}
                  <div><span>状态</span><em>{active ? "运行中" : last ? RUN_STATUS[last.status] ?? last.status : "未运行"}</em></div>
                </div>
              </RowMenu>
            </div>
          </div>

          {mission && (
            <div className={`mission-dock${missionOpen ? "" : " is-collapsed"}`}>
              <MissionOverview
                mission={mission}
                plan={latestPlan}
                delegations={delegations}
                state={state}
                act={act}
                onOpenThread={onOpenThread}
                open={missionOpen}
                onToggle={toggleMission}
              />
            </div>
          )}

          {chatTab === "trajectory" && (
            <div className="ds-trajectory-host">
              <TrajectoryView records={trajectory} onJump={jumpToRun} unit="段" />
            </div>
          )}
          {chatTab === "chat" && (() => {
            // 「看起来是空的」有三种：真没聊过 / 只有系统事件 / 全被「隐藏工具与思考」收起来了。
            // 第三种最坑：会话有 100 多步工具调用，界面上却只剩两条分隔线。
            const talk = msgs.some((m) => (m.role === "user" || m.role === "agent") && m.kind !== "thought" && String(m.content || "").trim());
            if (talk) return null;
            const steps = msgs.filter((m) => m.role === "tool" || m.kind === "thought").length;
            if (steps > 0 && !showTool) {
              return (
                <div className="chat-empty-hint">
                  <span className="inline-empty">这段会话有 {steps} 步工具与思考，现在收起着；没有文字结论{todo ? "，任务说明和验收在「任务详情」标签里" : ""}。</span>
                  <button className="btn tiny" title="展开工具调用与思考过程" onClick={() => setShowTool(true)}>显示工具与思考</button>
                </div>
              );
            }
            if (steps > 0) return null;
            return (
              <div className="chat-empty-hint">
                <span className="inline-empty">
                  {todo ? <>还没有对话记录 · <span className="faint">{todo.key}</span> 的说明与验收在</> : "还没有对话记录"}
                </span>
                {todo && (
                  <button className="link tiny" title="看任务的描述 / 验收 / 环境 / 产物" onClick={() => window.dispatchEvent(new Event("harness:task-detail"))}>任务详情</button>
                )}
                <span className="faint tiny">· 在下面说一句就开始</span>
              </div>
            );
          })()}

          {focusRun && (focusRun.result || focusRun.error) && (
            <RunFocusCard run={focusRun} todo={todo} onOpenTerminal={openGlobalTerminal} onClose={onClearFocusRun} />
          )}

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
                if (item.kind === "thought") {
                  return <ThoughtBlock key={item.key} message={item.msg} now={now} />;
                }
                if (item.kind === "approval") {
                  return <ApprovalRow key={item.key} message={item.msg} now={now} />;
                }
                if (item.kind === "tools") {
                  return (
                    <ToolGroup
                      key={item.key}
                      messages={item.msgs}
                      now={now}
                      copiedId={copiedId}
                      onCopy={(m) => void copy(m.id, m.content)}
                      onRetry={(m) => void act("retryMessage", { id: m.id })}
                      preview={preview}
                      previewRoot={previewRoot}
                    />
                  );
                }
                const m = item.msg;
                return (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    agentName={roleLabel(m.role, bot?.name || agent?.name)}
                    now={now}
                    copied={copiedId === m.id}
                    onCopy={() => void copy(m.id, m.content)}
                    onRetry={() => void act("retryMessage", { id: m.id })}
                    canRegenerate={!botThread && m.role === "agent" && m.id === lastAgentId && !active && !todo?.confirmed}
                    onRegenerate={() => void regenerate()}
                    onEdit={botThread ? undefined : (text) => void act("editMessage", { id: m.id, text })}
                  />
                );
              })}
              {active && ["running", "waiting_input", "waiting_plan", "waiting_children"].includes(active.status) && chatItems.length > 0 && (
                <LiveStatus
                  run={active}
                  steps={liveSteps}
                  now={now}
                />
              )}
              {/* 机器人会话：先用本地气泡把这一轮显出来，不等整轮跑完（真实消息落库后再由 state 接管） */}
              {botThread && (botPending || botBusy) && (
                <>
                  {botPending && (
                    <div className="ds-user">
                      <div className="ds-bubble">{botPending}</div>
                    </div>
                  )}
                  {botBusy && (
                    <div className="ds-assistant">
                      <div className="ds-assistant-body">
                        {botStream ? <RichText text={botStream} /> : <span className="ds-shimmer">正在回复…</span>}
                        {botTool && <span className="ds-stream-note">正在{familyLabelOfTool(botTool)} · {BOT_TOOL_LABEL[botTool] || botTool}</span>}
                      </div>
                    </div>
                  )}
                </>
              )}
              {msgs.length === 0 && (
                <div className="chat-empty">
                  <div className="chat-empty-mark"><SparkleIcon size={14} /></div>
                  {botThread ? (
                    <>
                      <b>还没有回合</b>
                      <p>在右侧配置面板点「跑一次决策」：有值得说的事件它才会开口，沉默也会留记录。</p>
                    </>
                  ) : (
                  <>
                  <b>{todo ? "还没有消息" : runnableAgents.length > 0 ? "说一句话开始" : dshAvailable ? "还没有可用的 Agent" : "未检测到 dsh"}</b>
                  <p>{todo ? "在下面补充信息、纠偏或追问。" : "直接描述要完成的事；@别名 指定 Agent，或从预览里拾取元素后发送。"}</p>
                  {!todo && (
                    <>
                      {runnableAgents.length > 0 && (
                        <div className="chat-suggestions">
                          <button className="chat-suggestion" title="描述目标，Agent 直接开工" onClick={() => updateText("帮我实现 ")}>
                            <b>实现功能</b><span>描述目标，Agent 直接开工</span>
                          </button>
                          <button className="chat-suggestion" title="看 diff、找风险、给修改建议" onClick={() => updateText("审查这段改动：")}>
                            <b>审查改动</b><span>看 diff、找风险、给修改建议</span>
                          </button>
                          <button className="chat-suggestion" title="跑起来，失败项逐个修" onClick={() => updateText("运行测试并修复失败：")}>
                            <b>运行测试</b><span>跑起来，失败项逐个修</span>
                          </button>
                          <button className="chat-suggestion" title="拆目标、验收和涉及模块" onClick={() => updateText("先帮我理一下这个任务：")}>
                            <b>先理清楚</b><span>拆目标、验收和涉及模块</span>
                          </button>
                        </div>
                      )}
                      <button className="link chat-guide-link" onClick={() => window.dispatchEvent(new CustomEvent("harness:view", { detail: { view: "guide", page: "super-agent" } }))}>Super Agent 怎么用？</button>
                    </>
                  )}
                  </>
                  )}
                </div>
              )}
            </div>
            {!atBottom && (
              <button className="chat-jump" onClick={jumpToBottom}>
                {unseen > 0 ? `${unseen} 条新消息` : "回到底部"} ↓
              </button>
            )}
          </div>

          {proposal && (
            <div className="dispatch-preview">
              <div className="dispatch-preview-head">分配建议 <span className="tiny faint">确认后才创建任务和运行</span></div>
              <div className="dispatch-preview-grid">
                <label>项目
                  <select value={proposal.projectId || ""} onChange={(e) => setProposal((p) => p ? { ...p, projectId: e.target.value || null, projectName: state.projects.find((x) => x.id === e.target.value)?.name || "全局" } : p)}>
                    <option value="">全局</option>
                    {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label>Agent
                  <select value={proposal.agentId} onChange={(e) => setProposal((p) => {
                    if (!p) return p;
                    const a = state.agents.find((x) => x.id === e.target.value);
                    return a ? { ...p, agentId: a.id, agentName: a.name, agentAlias: a.alias || a.name, runtime: a.chatRuntime === "terminal" ? "terminal" : "acp" } : p;
                  })}>
                    {runnableAgents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.chatRuntime === "terminal" ? "（终端）" : ""}</option>)}
                  </select>
                </label>
                <div>执行方式<b>{proposal.runtime === "terminal" ? "终端 pty" : "ACP"}</b></div>
                <div>worktree<b>{proposal.worktree}</b></div>
              </div>
              <div className="dispatch-preview-reason">{proposal.reason}</div>
              <div className="row gap6" style={{ justifyContent: "flex-end" }}>
                <button className="btn tiny" onClick={() => setProposal(null)}>取消</button>
                <button className="btn tiny primary" disabled={sending} onClick={() => void send({ text: proposal.text, allocation: { projectId: proposal.projectId, agentId: proposal.agentId } })}>确认派活</button>
              </div>
            </div>
          )}
          <div className="ds-composer">
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
              className="ds-composer-input"
              ref={textRef}
              rows={1}
              value={text}
              onChange={(e) => updateText(e.target.value)}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onKeyDown={(e) => {
                // 中文输入法：候选态的回车只上屏，不能顺手把半句话发出去
                if (composingRef.current || e.nativeEvent.isComposing || (e.nativeEvent as KeyboardEvent).keyCode === 229) return;
                if (mentionOpen) {
                  const size = Math.min(mentionItems.length, 8);
                  if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => (i + 1) % size); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => (i - 1 + size) % size); return; }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const item = mentionItems[mentionIndex]; if (item) insertMention(item.alias); return; }
                  if (e.key === "Escape") { e.preventDefault(); setMentionDismissed(true); return; }
                }
                if (e.key === "Escape") {
                  // 先撤掉待发送的界面上下文，其次才是停止这次运行（Esc 是聊天里最顺手的停键）
                  if (context) { e.preventDefault(); onClearContext(); return; }
                  if (active) { e.preventDefault(); void stop(); return; }
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
            <div className="ds-composer-bar">
              <div className="composer-chips">
                {botThread ? (
                  <>
                    <span className="ds-chip static" title="机器人会话：它用自己的记忆与人格回答">◆ 机器人</span>
                  </>
                ) : (
                <>
                {state.agents.length > 0 ? (
                  <select
                    className="composer-select"
                    value={agentId}
                    disabled={Boolean(active) || Boolean(mission)}
                    title={mission ? "Mission 由主管继续；不能切换到普通 Agent" : "选择 Agent"}
                    onChange={(e) => void act("setThreadAgent", { threadId: thread.id, agentId: e.target.value })}
                  >
                    {state.agents.map((a) => (
                      <option
                        key={a.id}
                        value={a.id}
                        disabled={!isRunnable(a) || (!!todo && !mission && a.role === "supervisor") || (!!mission && a.role !== "supervisor")}
                      >
                        {a.role === "supervisor" ? "✦ " : ""}{a.alias || a.name}{isRunnable(a) ? (a.chatRuntime === "terminal" ? "（终端）" : "") : "（未安装）"}
                      </option>
                    ))}
                  </select>
                ) : dshAvailable ? (
                  <button className="composer-link" onClick={() => void useDshAgent()} title="创建 dsh Agent 并用于当前会话">未检测到 Agent · 用 dsh</button>
                ) : (
                  <span className="composer-none">未检测到 Agent</span>
                )}
                {state.agents.length > 0 && workerRunnable.length === 0 && dshAvailable && (
                  <button className="composer-link" onClick={() => void useDshAgent()} title="创建 worker Agent 并用于当前会话">＋ dsh</button>
                )}
                {!todo && dshAvailable && !state.agents.some((a) => a.role === "supervisor") && (
                  <button className="composer-link" onClick={() => void useSupervisor()} title="创建一个 Mission 主管">＋ 主管</button>
                )}
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
                {showModelPicker && !botThread && (
                  <>
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
                </>
                )}
              </div>
              <div className="composer-actions">
                {!botThread && (
                  <RowMenu title="更多发送选项">
                    <label className="row-menu-label">添加 Agent
                      <select
                        value=""
                        onChange={async (e) => {
                          const cli = e.target.value;
                          if (!cli) return;
                          const created = await act("createAgent", { cli, projectId });
                          if (created?.id) await act("setThreadAgent", { threadId: thread.id, agentId: created.id });
                        }}
                      >
                        <option value="">选择 CLI…</option>
                        {(state.executors || []).filter((x) => x.available).map((x) => (
                          <option key={x.id} value={x.id}>{x.id} · {x.implemented ? "ACP" : "终端"}</option>
                        ))}
                      </select>
                    </label>
                    {!todo && !pureChat && (
                      <button onClick={() => { setChatOnly((v) => !v); setProposal(null); }}>{chatOnly ? "取消只聊（会建任务）" : "只聊（不建任务）"}</button>
                    )}
                    {!todo && <button onClick={() => setPreviewAllocation((v) => !v)}>{previewAllocation ? "取消预览分派" : "发送前预览分派"}</button>}
                    <button onClick={() => setShowTool((v) => !v)}>{showTool ? "隐藏工具与思考" : "显示工具与思考"}</button>
                  </RowMenu>
                )}
                <button
                  className={`ds-send mode-${baseMode}`}
                  disabled={!text.trim() || sending}
                  title={blockedReason ?? `${sendLabel} · ${enterToSend ? "Enter 发送 / Shift+Enter 换行" : "⌘Enter 发送"}`}
                  aria-label={blockedReason ?? sendLabel}
                  onClick={() => void send()}
                >
                  {sending ? <span className="ds-sending" aria-hidden /> : <SendIcon size={16} />}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function missionStateLabel(value?: string | null) {
  return ({
    planning: "规划中", plan_review: "计划待审批", running: "执行中", waiting_children: "等待子任务",
    in_review: "待确认", done: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断",
  } as Record<string, string>)[value || ""] || "Mission";
}
function missionPillClass(value?: string | null) {
  if (value === "plan_review" || value === "in_review") return "review";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  if (value === "done") return "done";
  if (value === "waiting_children") return "waiting";
  return "running";
}

export function MissionOverview({ mission, plan, delegations, state, act, onOpenThread, open, onToggle }: {
  mission: Todo; plan: MissionPlanRecord | null;
  delegations: Delegation[]; state: State;
  act: Act; onOpenThread?: (id: string) => void;
  /** 面板正文（计划 / 子任务）默认收起，头部一行常驻，方便把高度还给聊天区 */
  open: boolean; onToggle: () => void;
}) {
  const draft = plan && plan.status === "draft" ? plan : null;
  const done = delegations.filter((d) => ["completed", "accepted"].includes(d.status));
  return (
    <section className={`mission-panel mission-${mission.missionState || "planning"}`} aria-label="Mission">
      <div className="mission-head">
        <span className="mission-mark">✦</span>
        <b>Mission</b>
        <span className={`pill status ${missionPillClass(mission.missionState)}`}>{missionStateLabel(mission.missionState)}</span>
        <span className="tiny muted">{done.length}/{delegations.length} 子任务</span>
        <span className="spacer" />
        {mission.missionState === "in_review" && (
          <button className="btn tiny primary" onClick={() => void act("confirm", { id: mission.id })}>确认完成</button>
        )}
        {["interrupted", "failed"].includes(mission.missionState || "") && (
          <button className="btn tiny" onClick={() => void act("resumeMission", { id: mission.id })}>恢复 Mission</button>
        )}
        {mission.missionState !== "done" && mission.missionState !== "cancelled" && (
          <button className="link mission-danger" onClick={async () => { if (await confirmDialog("取消整个 Mission？所有未完成子任务会一起停止。")) void act("cancelMission", { id: mission.id }); }}>取消 Mission</button>
        )}
        <button className="pane-fold" onClick={onToggle} title={open ? "收起 Mission 详情" : "展开 Mission 详情"} aria-label={open ? "收起 Mission 详情" : "展开 Mission 详情"} aria-expanded={open}>
          <ChevronDownIcon size={14} className={open ? "rot-180" : ""} />
        </button>
      </div>
      {open && draft && (
        <div className="mission-plan">
          <div className="mission-plan-head">
            <b>计划待审批</b>
            <span className="tiny muted">rev {draft.revision}</span>
            <span className="spacer" />
            <span className="tiny faint">批准在终端（可对着代码看依赖与 worktree）</span>
            <button className="btn tiny primary" onClick={() => window.dispatchEvent(new CustomEvent("harness:view", { detail: "terminal" }))}>去终端批准</button>
          </div>
          {draft.plan.summary && <p className="mission-summary">{draft.plan.summary}</p>}
          <ol className="mission-steps">
            {draft.plan.steps.map((step) => (
              <li key={step.key}>
                <span className="mission-step-key mono">{step.key}</span>
                <span className="mission-step-title">{step.title}</span>
                <span className="tiny muted">{step.agent || "默认 worker"}</span>
                {step.dependsOn?.length ? <span className="tiny faint">依赖 {step.dependsOn.join(", ")}</span> : null}
                {step.acceptance?.length ? <span className="mission-step-accept tiny muted">{step.acceptance.join(" · ")}</span> : null}
              </li>
            ))}
          </ol>
          {draft.plan.risks?.length ? <div className="mission-risks"><b>风险</b>{draft.plan.risks.map((r, i) => <span key={i}>{r}</span>)}</div> : null}
        </div>
      )}
      {open && plan && plan.status === "approved" && !draft && (
        <div className="mission-approved-note">计划已批准 · {delegations.length} 个子任务</div>
      )}
      {open && delegations.length > 0 && (
        <div className="delegation-list">
          {delegations.map((d) => {
            const child = state.todos.find((t) => t.id === d.childTodoId);
            const childThread = state.threads.find((t) => t.todoId === d.childTodoId);
            const running = ["queued", "running", "waiting_input", "rework"].includes(d.status);
            return (
              <div className={`delegation-card delegation-${d.status}`} key={d.id}>
                <div className="delegation-main">
                  <span className={`thread-dot ${running ? "running" : d.status === "failed" ? "failed" : "done"}`} />
                  <span className="mono tiny faint">{child?.key || "—"}</span>
                  <b className="ellipsis" title={d.title}>{d.title}</b>
                  <span className={`pill status ${d.status === "failed" ? "failed" : running ? "running" : "done"}`}>{delegationLabel(d.status)}</span>
                  <span className="tiny muted">{state.agents.find((a) => a.id === d.agentId)?.alias || d.agentId}</span>
                  {d.branch && <span className="mono tiny faint ellipsis" title={d.branch}>{d.branch}</span>}
                  <span className="spacer" />
                  {childThread && onOpenThread && <button className="link" onClick={() => onOpenThread(childThread.id)}>查看会话</button>}
                  {running && d.childRunId && <button className="link" onClick={() => void act("stop", { runId: d.childRunId })}>停止</button>}
                  {["failed", "cancelled"].includes(d.status) && child && <button className="link" onClick={() => void act("retry", { id: child.id })}>重试</button>}
                </div>
                {d.resultSummary && <div className="delegation-result">{d.resultSummary.slice(0, 360)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
function delegationLabel(value: string) {
  return ({
    proposed: "待分派", queued: "排队", running: "执行中", waiting_input: "等待审批",
    completed: "已完成", accepted: "已接受", rework: "返工", failed: "失败", cancelled: "已取消",
  } as Record<string, string>)[value] || value;
}

function ChatMessage({ message: m, agentName, now, copied, onCopy, onRetry, canRegenerate, onRegenerate, onEdit }: {
  message: Message; agentName: string; now: number; copied: boolean; onCopy: () => void; onRetry: () => void;
  canRegenerate?: boolean; onRegenerate?: () => void;
  onEdit?: (text: string) => void;
}) {
  const collapsible = (m.role === "tool" || m.kind === "thought" || m.kind === "system") && m.content.length > 220;
  const [expanded, setExpanded] = useState(false);
  // 已发送的用户消息可以再编辑：改完直接重发（运行中则作为纠偏投递）
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const shown = collapsible && !expanded ? `${m.content.slice(0, 220).trimEnd()}…` : m.content;
  const isUser = m.role === "user";
  const canEdit = isUser && Boolean(onEdit) && m.delivery !== "pending";
  const isSystem = m.role === "system" || m.kind === "system";

  if (isSystem) {
    return (
      <div className="ds-system">
        <span className="ds-system-line" aria-hidden />
        <span className="ds-system-text">{shown}</span>
        <span className="ds-system-line" aria-hidden />
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="ds-user">
        {m.context && (
          <div className="ds-user-ctx" title={`${m.context.selector}${m.context.source?.file ? ` · ${m.context.source.file}` : ""}`}>
            <span className="ds-tag">元素</span>
            <span className="mono ellipsis">{m.context.selector}</span>
          </div>
        )}
        {editing ? (
          <div className="ds-edit">
            <textarea
              className="ds-edit-input"
              value={draft}
              autoFocus
              rows={Math.min(10, Math.max(2, draft.split("\n").length))}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); setDraft(m.content); setEditing(false); }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
                  e.preventDefault();
                  onEdit?.(draft.trim());
                  setEditing(false);
                }
              }}
            />
            <div className="ds-edit-actions">
              <span className="ds-edit-hint">⌘Enter 发送 · Esc 取消</span>
              <button className="ds-action-text" onClick={() => { setDraft(m.content); setEditing(false); }}>取消</button>
              <button className="ds-action-text primary" disabled={!draft.trim() || draft.trim() === m.content.trim()} onClick={() => { onEdit?.(draft.trim()); setEditing(false); }}>保存并发送</button>
            </div>
          </div>
        ) : (
          <div className="ds-bubble"><RichText text={m.content} /></div>
        )}
        <div className="ds-actions ds-actions-user">
          {m.delivery === "pending" && <span className="ds-delivery">投递中…</span>}
          {m.delivery === "injected" && <span className="ds-delivery">已注入</span>}
          {m.delivery === "failed" && <button className="ds-delivery failed" onClick={onRetry}>投递失败 · 重发</button>}
          <span className="ds-time">{timeAgo(m.createdAt, now)}</span>
          <button className="ds-action" title="复制这条消息" aria-label="复制这条消息" onClick={onCopy}>
            {copied ? <CopyCheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
          {canEdit && !editing && (
            <button className="ds-action" title="编辑后重发" aria-label="编辑后重发" onClick={() => { setDraft(m.content); setEditing(true); }}>
              <PencilIcon size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`ds-assistant ${m.kind === "error" ? "is-error" : ""}`}>
      {m.context && (
        <div className="ds-user-ctx" title={`${m.context.selector}${m.context.source?.file ? ` · ${m.context.source.file}` : ""}`}>
          <span className="ds-tag">元素</span>
          <span className="mono ellipsis">{m.context.selector}</span>
        </div>
      )}
      {m.kind === "error" && missingKeyInfo(m.content) && (() => {
        const info = missingKeyInfo(m.content)!;
        const env = info.envVars[0];
        return (
          <div className="missing-key-card">
            <div className="missing-key-head">未配置模型密钥{info.provider ? ` · ${info.provider}` : ""}</div>
            <div className="missing-key-body">
              执行器读不到 <code>{env}</code>。两种配法任选其一：
              <ol>
                <li>在「设置 → 执行 → 模型密钥」里写 <code>{env}=sk-…</code>（只注入本机启动的 dsh，最省事）</li>
                <li>或在你启动 App 的终端里 <code>export {env}=sk-…</code>，然后重启 App</li>
              </ol>
            </div>
            <div className="missing-key-actions">
              <button className="btn tiny primary" onClick={() => window.dispatchEvent(new CustomEvent("harness:open-settings", { detail: { section: "execution", focus: "dshEnv" } }))}>去设置里填</button>
              <button className="btn tiny" onClick={() => void window.harness.clipboardWrite(`export ${env}=`)}>复制 export 前缀</button>
            </div>
          </div>
        );
      })()}
      <div className="ds-assistant-body"><RichText text={shown} /></div>
      {collapsible && (
        <button className="ds-more" aria-expanded={expanded} title={expanded ? "收起" : "展开全部"} aria-label={expanded ? "收起" : "展开全部"} onClick={() => setExpanded((v) => !v)}>
          <ChevronDownIcon size={14} className={expanded ? "rot-180" : ""} />
        </button>
      )}
      <div className="ds-actions">
        <button className="ds-action" title="复制回答" aria-label="复制回答" onClick={onCopy}>
          {copied ? <CopyCheckIcon size={14} /> : <CopyIcon size={14} />}
        </button>
        {canRegenerate && onRegenerate && (
          <button className="ds-action" title="重新生成" aria-label="基于上一轮提问重新生成" onClick={onRegenerate}>
            <RefreshIcon size={14} />
          </button>
        )}
        <span className="ds-time">{agentName} · {timeAgo(m.createdAt, now)}</span>
      </div>
    </div>
  );
}

/** 思考过程：DeepSeek 式折叠行 —— 24px 一行，展开后正文缩进 */
/** 机器人只读工具的名字 → 「正在查 / 正在想」里的动作词 */
function familyLabelOfTool(name: string): string {
  const family = familyOf(null, { title: name });
  return family === "read" ? "读" : family === "search" ? "查" : family === "run" ? "跑" : family === "edit" ? "改" : "查";
}

/** 审批行：模态关掉之后还能在会话里回看批了什么 */
function ApprovalRow({ message, now }: { message: Message; now: number }) {
  const meta = message.meta || {};
  const allowed = meta.allow !== false;
  const decision = meta.decision || (allowed ? "允许" : "拒绝");
  return (
    <div className={`ds-approval ${allowed ? "ok" : "deny"}`} role="note">
      <span className="ds-row-icon" aria-hidden>{allowed ? <CheckSquareIcon size={14} /> : <XIcon size={14} />}</span>
      <span className="ds-approval-title">审批 · {decision}</span>
      {meta.title && <><span className="ds-sep" aria-hidden /><span className="ds-approval-what">{meta.title}</span></>}
      {meta.description && <span className="ds-approval-cmd mono" title={meta.description}>{firstLine(meta.description)}</span>}
      <span className="ds-tool-time">{timeAgo(message.createdAt, coarseNow(now))}</span>
    </div>
  );
}

function ThoughtBlock({ message, now }: { message: Message; now: number }) {
  const [open, setOpen] = useState(false);
  const text = message.content.trim();
  if (!text) return null;
  const summary = firstLine(text);
  return (
    <div className={`ds-reason ${open ? "open" : ""}`}>
      <button className="ds-reason-head" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={open ? "收起思考" : "展开思考"}>
        <span className="ds-row-icon"><SparkleIcon size={14} /></span>
        <span className="ds-reason-title">已深度思考</span>
        {!open && summary && (
          <>
            <span className="ds-sep" aria-hidden />
            <span className="ds-reason-summary">{summary}</span>
          </>
        )}
        <span className="ds-reason-time">{timeAgo(message.createdAt, coarseNow(now))}</span>
        <ChevronDownIcon size={14} className={`ds-row-chev ${open ? "rot-180" : ""}`} />
      </button>
      {open && <div className="ds-reason-body">{text}</div>}
    </div>
  );
}

/** 连续的工具 / 思考步骤收成「已处理」一行，展开是一行一步 */
/** 一行摘要 + 步骤常驻（ZCode 的做法：过程是日志，不是要展开的盒子） */
type PreviewApi = {
  target: InlinePreviewTarget | null;
  openFile: (owner: string, path: string, opts?: { root?: string; name?: string; line?: number }) => void;
  openText: (owner: string, title: string, text: string, mono?: boolean) => void;
  close: () => void;
};

function ToolGroup({ messages, now, copiedId, onCopy, onRetry, preview, previewRoot }: {
  messages: Message[]; now: number; copiedId: string | null;
  onCopy: (m: Message) => void; onRetry: (m: Message) => void;
  preview: PreviewApi; previewRoot?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const first = messages[0];
  const last = messages[messages.length - 1];
  const secs = Math.max(1, Math.round((last.createdAt - first.createdAt) / 1000));
  const steps = messages.map((m) => ({
    family: familyOf(m.meta, { title: m.meta?.title, content: normalizeToolContent(m.content).head }),
    status: statusOf(m.meta),
  }));
  const summary = summarizeFamilies(steps.map((s) => s.family));
  const state = turnStatusOf(steps.map((s) => s.status));
  const prefix = state === "failed" ? "失败" : state === "stopped" ? "已停止" : state === "denied" ? "被拒" : state === "running" ? "执行中" : "已完成";
  const visible = showAll || messages.length <= 20 ? messages : messages.slice(messages.length - 20);
  const hidden = messages.length - visible.length;
  return (
    <div className={`ds-steps k-${state}`}>
      <div className="ds-steps-head">
        <span className="ds-steps-label">{prefix}</span>
        {summary && <><span className="ds-sep" aria-hidden /><span className="ds-steps-summary">{summary}</span></>}
        <span className="ds-steps-time mono">{secs}s</span>
      </div>
      {hidden > 0 && (
        <button className="ds-steps-more" onClick={() => setShowAll(true)}>显示更早 {hidden} 步</button>
      )}
      {runsOfFamily(visible, (m) => familyOf(m.meta, { title: m.meta?.title, content: normalizeToolContent(m.content).head })).map((run) => (
        run.items.length < 3 ? (
          <ToolRow
            key={run.items[0].id}
            message={run.items[0]}
            now={now}
            copied={copiedId === run.items[0].id}
            onCopy={() => onCopy(run.items[0])}
            onRetry={() => onRetry(run.items[0])}
            preview={preview}
            previewRoot={previewRoot}
          />
        ) : (
          <StepRun
            key={`run-${run.items[0].id}`}
            family={run.family}
            messages={run.items}
            now={now}
            copiedId={copiedId}
            onCopy={onCopy}
            onRetry={onRetry}
            preview={preview}
            previewRoot={previewRoot}
          />
        )
      ))}
    </div>
  );
}

/** 连续同族步骤（≥3 条）：一行「已执行 6 条命令」，展开才逐条看 */
function StepRun({ family, messages, now, copiedId, onCopy, onRetry, preview, previewRoot }: {
  family: ToolFamily; messages: Message[]; now: number; copiedId: string | null;
  onCopy: (m: Message) => void; onRetry: (m: Message) => void;
  preview: PreviewApi; previewRoot?: string;
}) {
  const [open, setOpen] = useState(false);
  const failed = messages.some((m) => statusOf(m.meta) === "failed") || messages.some((m) => statusOf(m.meta) === "denied");
  return (
    <div className={`ds-step-run k-${failed ? "failed" : "done"}`}>
      <button className="ds-tool-main ds-step-run-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="ds-row-icon" aria-hidden><ToolFamilyIcon family={family} /></span>
        <span className="ds-tool-title">{FAMILY_VERB[family]}</span>
        <span className="ds-tool-summary">{messages.length} {FAMILY_UNIT[family] || "步"}</span>
        {failed && <span className="ds-tool-status failed">有失败</span>}
        <ChevronDownIcon size={14} className={`ds-tool-chev ${open ? "rot-180" : ""}`} />
      </button>
      {open && messages.map((m) => (
        <ToolRow key={m.id} message={m} now={now} copied={copiedId === m.id} onCopy={() => onCopy(m)} onRetry={() => onRetry(m)} preview={preview} previewRoot={previewRoot} />
      ))}
    </div>
  );
}

function ToolRow({ message: m, now, copied, onCopy, onRetry, preview, previewRoot }: {
  message: Message; now: number; copied: boolean; onCopy: () => void; onRetry: () => void;
  preview: PreviewApi; previewRoot?: string;
}) {
  const [expanded, setExpanded] = useState(m.kind === "error" || m.delivery === "failed" || statusOf(m.meta) === "failed");
  const { head, rest } = normalizeToolContent(m.content);
  const family = familyOf(m.meta, { title: m.meta?.title, content: head });
  const state = statusOf(m.meta);
  const object = objectOf(m.meta, family, splitToolHead(head).summary || head);
  const fileLike = (family === "read" || family === "edit") && isFileLike(object);
  const args = String(m.meta?.input || "").trim();
  const result = String(m.meta?.output || rest || "").trim();
  const long = Boolean(result) || Boolean(args) || head.length > 120;
  const ms = formatDuration(m.meta?.durationMs);
  const toggle = () => { if (long) setExpanded((v) => !v); };
  /** 对话内预览的文件/行号：`src/a.ts:12` 这种也认（行号只用来开窗，不用来定位高亮） */
  const targetOfObject = object.replace(/:\d+(?::\d+)?$/, "");
  const lineOfObject = Number(object.match(/:(\d+)/)?.[1]) || undefined;
  const openPreview = () => {
    if (!targetOfObject) return;
    preview.openFile(m.id, fileLike ? targetOfObject : object, { root: previewRoot, name: targetOfObject.split("/").pop(), line: lineOfObject });
  };
  return (
    <>
      <div className={`ds-tool-row ${m.kind} k-${state}${m.meta?.parentToolId ? " child" : ""}`} data-family={family}>
        <span className="ds-row-icon" aria-hidden><ToolFamilyIcon family={family} /></span>
        <button
          className="ds-tool-main"
          onClick={toggle}
          disabled={!long}
          title={long ? (expanded ? "收起输出" : "查看参数 / 输出") : object}
          aria-expanded={long ? expanded : undefined}
        >
          <span className="ds-tool-title">{FAMILY_VERB[family]}</span>
          {object && (fileLike
            ? <FileChip path={targetOfObject} onOpen={openPreview} />
            : <span className="ds-tool-summary">{object}</span>)}
          {state !== "done" && <span className={`ds-tool-status ${state}`}>{STATUS_LABEL[state]}</span>}
          {ms && <span className="ds-tool-ms mono">{ms}</span>}
          {long && <ChevronDownIcon size={14} className={`ds-tool-chev ${expanded ? "rot-180" : ""}`} />}
        </button>
        <span className="ds-tool-time">{timeAgo(m.createdAt, coarseNow(now))}</span>
        <button className="ds-action ds-tool-copy" title={copied ? "已复制" : "复制这一步"} aria-label={copied ? "已复制" : "复制这一步"} onClick={onCopy}>
          {copied ? <CopyCheckIcon size={14} /> : <CopyIcon size={14} />}
        </button>
      </div>
      {long && expanded && (
        <div className="ds-tool-detail">
          {args && (
            <div className="ds-tool-field">
              <div className="ds-tool-field-head"><span>参数</span></div>
              <pre className="ds-tool-field-body">{args}</pre>
            </div>
          )}
          {result && (
            <div className="ds-tool-field">
              <div className="ds-tool-field-head"><span>输出</span></div>
              <pre className="ds-tool-field-body">{result || "（没有输出）"}</pre>
            </div>
          )}
          {!args && !result && <pre className="ds-tool-field-body">{head}</pre>}
        </div>
      )}
      {preview.target?.owner === m.id && <InlinePreviewCard target={preview.target} onClose={preview.close} />}
      {m.delivery === "failed" && <button className="ds-delivery failed" onClick={onRetry}>投递失败 · 重发</button>}
    </>
  );
}

/** 文件 chip：点击在预览面板打开 */
function FileChip({ path, onOpen }: { path: string; onOpen: (target: string) => void }) {
  const name = path.split("/").filter(Boolean).pop() || path;
  const short = name.length > 28 ? `${name.slice(0, 26)}…` : name;
  return (
    <span className="ds-file-chip" title={path}>
      <FileTextIcon size={14} />
      <button className="ds-file-chip-name" onClick={(e) => { e.stopPropagation(); onOpen(path); }}>{short}</button>
    </span>
  );
}

/** 工具首行 → 标题 + 参数摘要（旧数据没有 meta 时用） */
function splitToolHead(head: string) {
  const parts = head.split(" · ");
  if (parts.length > 1) return { title: parts[0], summary: parts.slice(1).join(" · ") };
  const split = head.match(/^([A-Za-z_][\w.-]*)\s+(.+)$/);
  if (split) return { title: prettifyToolName(split[1]), summary: split[2] };
  return { title: head, summary: "" };
}

/** ACP 的英文状态 → 中文；老消息里的 `bash · completed` 在渲染时归一化 */
const ACP_STATUS_ZH: Record<string, string> = {
  pending: "排队中", in_progress: "运行中", running: "运行中", completed: "完成",
  failed: "失败", cancelled: "已取消", canceled: "已取消", awaiting_approval: "待批准",
};

function prettifyToolName(name: string) {
  const raw = String(name || "").trim();
  if (!raw) return "工具";
  if (/^[a-z][a-z0-9]*([_-][a-z0-9]+)+$/.test(raw)) {
    return raw.split(/[_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  if (/^[a-z][a-z0-9]*$/.test(raw)) return raw[0].toUpperCase() + raw.slice(1);
  return raw;
}

/** 返回首行（干了什么）与展开内容（命令 / 路径 / 输出） */
function normalizeToolContent(content: string) {
  const lines = String(content || "").split("\n");
  const head = (lines[0] || "").trim();
  const rest = lines.slice(1).join("\n").trim();
  const legacy = head.match(/^([^·]+?)\s*·\s*([a-z_]+)$/);
  if (legacy && ACP_STATUS_ZH[legacy[2]]) {
    return { head: `${prettifyToolName(legacy[1])} · ${ACP_STATUS_ZH[legacy[2]]}`, rest };
  }
  const parts = head.split(" · ");
  if (parts.length >= 2) parts[0] = prettifyToolName(parts[0]);
  return { head: parts.join(" · "), rest };
}

/** 历史行的时间按 10s 粒度刷新：每秒跳数字会让拖选位置抖动 */
function coarseNow(now: number) {
  return Math.floor(now / 10000) * 10000;
}

function firstLine(text: string) {
  return (text.split("\n")[0] || "").trim().slice(0, 120);
}


function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await window.harness.clipboardWrite(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };
  return (
    <div className="md-code-block">
      <div className="md-code-head">
        <span>{lang || "code"}</span>
        <button className="md-code-copy" onClick={() => void copy()} title="复制代码">
          {copied ? <CopyCheckIcon size={14} /> : <CopyIcon size={14} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="md-code"><code>{text}</code></pre>
    </div>
  );
}

/**
 * 轻量 Markdown：围栏代码块 + 行内 code / 粗体 / @提及 / 链接。
 * 不引入第三方依赖，也不使用 innerHTML，避免注入风险。
 */
export function RichText({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "code") {
          return <CodeBlock key={`c${i}`} lang={b.lang} text={b.text} />;
        }
        if (b.type === "table") {
          return (
            <div className="md-table-wrap" key={`tbl${i}`}>
              <table className="md-table">
                <thead><tr>{b.header.map((cell, ci) => <th key={ci}>{inlineNodes(cell, `th${i}-${ci}`)}</th>)}</tr></thead>
                <tbody>{b.rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{inlineNodes(cell, `td${i}-${ri}-${ci}`)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (b.type === "heading") {
          const Tag = (`h${Math.min(6, Math.max(1, b.level))}`) as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
          return <Tag className={`md-heading md-h${b.level}`} key={`h${i}`}>{inlineNodes(b.text, `h${i}`)}</Tag>;
        }
        if (b.type === "list") {
          const List = b.ordered ? "ol" : "ul";
          return (
            <List className={`md-list ${b.ordered ? "ordered" : ""}`} key={`l${i}`}>
              {b.items.map((item, li) => <li key={li} style={{ marginLeft: item.depth * 14 }}>{inlineNodes(item.text, `li${i}-${li}`)}</li>)}
            </List>
          );
        }
        if (b.type === "quote") {
          return <blockquote className="md-quote" key={`q${i}`}>{inlineNodes(b.text, `q${i}`)}</blockquote>;
        }
        if (b.type === "hr") return <hr className="md-hr" key={`hr${i}`} />;
        return <Fragment key={`t${i}`}>{inlineNodes(b.text, `t${i}`)}</Fragment>;
      })}
    </>
  );
}

type Block =
  | { type: "text"; text: string }
  | { type: "code"; text: string; lang: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: { text: string; depth: number }[] }
  | { type: "quote"; text: string }
  | { type: "hr" };

function parseTableRow(line: string) {
  const raw = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === "\\" && raw[i + 1] === "|") { cell += "|"; i++; continue; }
    if (char === "|") { cells.push(cell.trim()); cell = ""; continue; }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseTextBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const out: Block[] = [];
  let buffer: string[] = [];
  // 文本块与代码 / 列表之间的空行已经由块间距表达；保留 pre-wrap 会在正文里多出一条空行
  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join("\n").replace(/^\n+|\n+$/g, "");
    if (text) out.push({ type: "text", text });
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || "";
    const header = line.includes("|") ? parseTableRow(line) : [];
    const separator = next.includes("-") ? parseTableRow(next) : [];
    const isTable = header.length > 1
      && separator.length === header.length
      && separator.every((cell) => /^:?-{3,}:?$/.test(cell));
    if (!isTable) {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flush();
        out.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
        continue;
      }
      if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
        flush();
        out.push({ type: "hr" });
        continue;
      }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flush();
        const parts = [quote[1]];
        while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) parts.push(lines[++i].replace(/^>\s?/, ""));
        out.push({ type: "quote", text: parts.join("\n") });
        continue;
      }
      const list = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
      if (list) {
        flush();
        const ordered = /^\d/.test(list[2]);
        const items: { text: string; depth: number }[] = [];
        let current = i;
        while (current < lines.length) {
          const match = lines[current].match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
          if (!match) break;
          items.push({ text: match[3].trim(), depth: Math.min(4, Math.floor(match[1].replace(/\t/g, "  ").length / 2)) });
          current++;
        }
        i = current - 1;
        out.push({ type: "list", ordered, items });
        continue;
      }
      buffer.push(line);
      continue;
    }
    flush();
    const rows: string[][] = [];
    i += 2;
    while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
      rows.push(parseTableRow(lines[i]));
      i++;
    }
    i--;
    out.push({ type: "table", header, rows });
  }
  flush();
  return out;
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const re = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) blocks.push(...parseTextBlocks(text.slice(last, m.index)));
    blocks.push({ type: "code", lang: m[1] || "", text: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < text.length) blocks.push(...parseTextBlocks(text.slice(last)));
  if (blocks.length === 0) blocks.push({ type: "text", text });
  return blocks;
}

function inlineNodes(text: string, keyPrefix: string): ReactNode[] {
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|`[^`\n]+`|@[a-zA-Z0-9_.-]+|https?:\/\/[^\s<>()]+)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**") || token.startsWith("__")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("~~")) nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    else if (token.startsWith("*")) nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
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

const LIVE_STATUS: Record<string, string> = {
  running: "正在处理",
  waiting_input: "等你回答",
  waiting_plan: "等你确认计划",
  waiting_children: "等待子任务",
};

/** 运行中的实时进展：状态 + 已用时 + 步数 + 最近动作，可展开看最近几步。 */
type LiveStep = { id: string; kind: string; text: string; detail: string; at: number; family: ToolFamily; status: ToolStatus };

function LiveStatus({ run, steps, now }: {
  run: State["runs"][number];
  steps: { total: number; all: LiveStep[]; recent: LiveStep[] };
  now: number;
}) {
  const [open, setOpen] = useState(false);
  // 展开后冻结计时：否则每秒重渲染会把正在拖选的文字改掉（"11s"→"12s"），选区跟着跳
  const [frozenAt, setFrozenAt] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const tick = open && frozenAt ? frozenAt : now;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setFrozenAt(Date.now());
      // 面板向下展开，可能被滚动容器裁掉一半：先把它带进视野
      window.requestAnimationFrame(() => boxRef.current?.scrollIntoView({ block: "nearest" }));
    }
  };
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? steps.all : steps.recent;
  const label = LIVE_STATUS[run.status] ?? RUN_STATUS[run.status] ?? run.status;
  const latest = steps.recent[0];
  const waiting = run.status !== "running";
  // 「正在做什么」用最近一步的家族说，而不是只说「正在深入处理」
  const doing = latest?.kind === "thought" ? "正在想"
    : latest?.kind === "approval" ? "等你审批"
      : latest ? `正在${FAMILY_LABEL[latest.family] || "处理"}` : "";
  return (
    <>
      <div className={`ds-running ${waiting ? "waiting" : ""}`} aria-live="polite" ref={boxRef}>
        <span className="ds-running-icon" aria-hidden><SparkleIcon size={14} /></span>
        <span className="ds-running-text">
          <span className="ds-shimmer">{waiting ? label : `${doing || "正在深入处理"}`} · 已用 {duration(run, tick)}</span>
          {steps.total > 0 && <span className="ds-running-steps"> · {steps.total} 步</span>}
        </span>
        {steps.recent.length > 0 && (
          <button className="ds-action" onClick={toggle} aria-expanded={open} title={open ? "收起进展" : "查看进展"} aria-label={open ? "收起进展" : "查看进展"}>
            <ChevronDownIcon size={14} className={open ? "rot-180" : ""} />
          </button>
        )}
      </div>
      {open && (
        <div className="ds-running-detail">
          {latest && <div className="ds-running-latest mono ellipsis" title={latest.detail || latest.text}>{latest.text}</div>}
          <div className={`ds-running-steps ${showAll ? "all" : ""}`}>
            {steps.total > steps.recent.length && (
              <div className="ds-running-note">
                <span>{showAll ? `全部 ${steps.total} 步` : `最近 ${steps.recent.length} 步 · 共 ${steps.total} 步`}</span>
                <button className="ds-action-text" onClick={() => setShowAll((v) => !v)}>{showAll ? "只看最近" : "看全部"}</button>
              </div>
            )}
            {list.map((step) => (
              <div className="ds-running-step" key={step.id}>
                <span className="ds-row-icon">{step.kind === "thought" ? <SparkleIcon size={14} /> : <WrenchIcon size={14} />}</span>
                <span className="ds-running-step-main">
                  <span className="mono ellipsis" title={step.detail ? `${step.text}\n${step.detail}` : step.text}>{step.text}</span>
                  {step.detail && <span className="ds-running-step-detail mono ellipsis" title={step.detail}>{step.detail}</span>}
                </span>
                <span className="ds-tool-time">{timeAgo(step.at, tick)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function RunDivider({ state, runId, now }: { state: State; runId: string; now: number }) {
  const run = state.runs.find((r) => r.id === runId);
  const status = run?.status ?? "";
  return (
    <div className={`ds-divider ${status}`} data-run-id={runId}>
      <span className="ds-divider-line" aria-hidden />
      <span className="ds-divider-text">
        {RUN_STATUS[status] ?? status ?? "未知"}
        {run && <span className="mono"> · {duration(run, now)}</span>}
        {run?.branch && <span className="mono ellipsis" title={run.branch}> · {run.branch}</span>}
      </span>
      <span className="ds-divider-line" aria-hidden />
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

