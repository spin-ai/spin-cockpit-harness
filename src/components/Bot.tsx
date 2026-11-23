import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmDialog } from "./ConfirmHost";
import { createPortal } from "react-dom";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { RowMenu } from "./RowMenu";
import { CheckSquareIcon, CopyIcon, FileTextIcon, GitIcon, LinkIcon, ListIcon, PencilIcon, PlusIcon, QuoteIcon, RefreshIcon, SearchIcon, SendIcon, SparkleIcon, TerminalIcon, XIcon } from "./Icons";
import { FAMILY_UNIT, FAMILY_VERB, STATUS_LABEL, familyOf, formatDuration, humanArgs, isFileLike, objectOf, runsOfFamily, statusOf, summarizeFamilies, turnStatusOf, type ToolFamily, type ToolStatus } from "../tool-family";
import { requestFilePreview } from "../terminal-events";
import { ToolFamilyIcon } from "./ToolFamilyIcon";
import { UndoBar, type UndoAction } from "./UndoBar";
import { TrajectoryView, type TrajectoryRecord } from "./TrajectoryView";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { useT } from "../i18n";
import { RichText, MissionOverview } from "./TaskChat";
import { relTime } from "../ui";
import { assignmentsForBot } from "../selectors/assignments";
import { requestTerminalAdopt, requestTerminalAt } from "../terminal-events";
import type { BotGroupMessage, State } from "../types";

type Act = (type: string, payload?: unknown) => Promise<any>;

type Persona = { mission?: string; tone?: string; address?: string; length?: string; boundary?: string; habit?: string;
  /** 职责卡：目标 / 范围 / 交付物 / 不做 / 汇报口径（进 system prompt，见 buildSystemPrompt） */
  duty?: { goal?: string; scope?: string; deliverable?: string; forbidden?: string; report?: string } };
type Routine = {
  id: string; botId: string; name?: string; kind?: "daily" | "every" | "once" | "watch";
  atHour?: number; everyMs?: number; onceAt?: number; prompt?: string; enabled?: boolean;
  /** alongside = 到点就跑；in-chat = 等这个 bot 空下来（最多等 5 分钟） */
  mode?: "alongside" | "in-chat"; waitingSince?: number;
  watch?: { kind?: "file" | "cmd"; path?: string; cmd?: string };
  lastFiredAt?: number; lastError?: string; when?: string; nextAt?: number | null;
  due?: boolean; why?: string;
};
type Policy = { maxTurnsPerHour?: number; minGapMs?: number; quietHours?: [number, number]; escalate?: string; whoCanAsk?: "owner" | "group" | "anyone";
  notify?: { proactive?: boolean; needPermission?: boolean; taskDone?: boolean; failed?: boolean };
  standing?: { enabled?: boolean; maxRunsPerHour?: number };
  github?: { enabled?: boolean };
  webhook?: { enabled?: boolean; token?: string } };
type Bot = {
  id: string; name: string; avatar?: string; avatarClass?: string;
  persona?: Persona; capability?: "read" | "dispatch" | "work"; role?: "supervisor" | "worker";
  executorAgentId?: string | null; channels?: string[];
  /** 这个 bot 用哪个模型（空 = 跟随默认） */
  model?: string; effort?: string; skills?: string[];
  projectId?: string | null; hostId?: string | null; team?: string;
  plan?: { goal?: string; steps?: { text: string; status: string }[]; updatedAt?: number } | null;
  policy?: Policy; budget?: { tokensPerTurn?: number; tokensPerHour?: number };
  status?: "active" | "paused"; mutedUntil?: number;
  createdAt?: number; updatedAt?: number;
};
type Turn = {
  id: string; botId: string; channel?: string;
  trigger?: { kind?: string; ref?: string }; input?: string;
  injected?: { layer: string; id: string; title: string }[];
  reply?: string; decision?: "answered" | "replied" | "reported" | "silent" | "blocked" | "escalated" | "asked" | "streaming" | "interrupted" | "watching";
  todoId?: string | null;
  runId?: string | null;
  proposal?: { title: string; desc: string; dismissed?: boolean; acceptedAt?: number } | null;
  reason?: string; cost?: { tokens?: number | null; ms?: number; ttftMs?: number | null; model?: string; rounds?: number | null; toolCalls?: number | null };
  /** 这一轮为什么停（轮数 / 循环 / 预算 / 超时）；空 = 正常说完 */
  stopReason?: string;
  /** 上下文账：注入了多少字符、记忆占多少、是否带摘要 */
  context?: { chars?: number; memory?: number; memoryRaw?: number; history?: number; digest?: boolean; sections?: Record<string, number> };
  /** 这一轮用过的工具（只读）：name / args / ms / ok / preview */
  tools?: { name: string; args?: string; argsRaw?: string; result?: string; at?: number; ms?: number; ok?: boolean; rejected?: boolean; preview?: string; family?: ToolFamily; statusKind?: ToolStatus; durationMs?: number; agentId?: string | null }[];
  /** 结构化轨迹：每次模型请求（usage / TTFT 可算）+ 每次工具调用（原始参数 / 完整输出） */
  trace?: TraceEvent[];
  /** 这一轮落下的日程建议：模型只出草稿，人点「建日程」后才写 routines */
  routineProposal?: { name?: string; kind?: string; prompt?: string; when?: string; mode?: string; atHour?: number; everyMs?: number; onceAt?: number; watch?: { kind?: string; path?: string; cmd?: string }; dismissed?: boolean; acceptedAt?: number } | null;
  /** 已确认建成的日程 id（卡片改显示「已建」） */
  routineId?: string | null;
  /** 这一轮落在哪个会话（ORCA 的 Chats）；老回合为空 = 默认会话 */
  threadId?: string | null;
  createdAt: number;
};
/** 记忆整理计划（主进程算，UI 只展示与确认） */
type TidyPlan = {
  ready: boolean; ratio: number; used: number; budget: number; target: number;
  need: number; freed: number; short?: boolean; reason?: string;
  picks: { id: string; layer: string; title: string; chars: number; score: number }[];
  usage?: { entries?: number; notes?: number; dropped?: number };
};
/** 一个 bot 的会话（照搬 ORCA 的 Chats）：标题 / 最后一句 / 条数 */
type Chat = { id: string; title: string; createdAt: number; updatedAt: number; count: number; last: string; lastAt: number };
type Ask = { turnId: string; botId: string; text: string; createdAt: number };

type TraceEvent = {
  kind: "request" | "tool";
  round?: number;
  at?: number;
  ms?: number;
  usage?: Record<string, number>;
  ttft?: number;
  text?: string;
  name?: string;
  argsRaw?: string;
  result?: string;
  ok?: boolean;
  rejected?: boolean;
};

/** 一轮的完整轨迹：思考 / 工具调用 / 终端；run 的 messages 优先，其次 bot 只读工具 */
type TraceStep = {
  id: string;
  kind: "thought" | "tool" | "terminal";
  title: string;
  summary?: string;
  output?: string;
  at?: number;
  ok?: boolean;
  /** 结构化字段（主进程写入）：家族 / 状态 / 耗时 / 父调用 / 归属 */
  family?: ToolFamily;
  status?: ToolStatus;
  durationMs?: number;
  parentToolId?: string | null;
  agentId?: string | null;
};

type RailTab = "messages" | "schedule" | "settings";

function BotRailTabs({ tab, onTab }: { tab: RailTab; onTab: (t: RailTab) => void }) {
  const t = useT();
  return (
    <div className="bot-rail-tabs">
      <button className={tab === "messages" ? "on" : ""} onClick={() => onTab("messages")}>{t("bot.messages", "消息")}</button>
      <button className={tab === "schedule" ? "on" : ""} onClick={() => onTab("schedule")}>{t("bot.schedule", "调度")}</button>
      <button className={tab === "settings" ? "on" : ""} onClick={() => onTab("settings")}>{t("bot.settings", "设置")}</button>
    </div>
  );
}

/**
 * 调度：跨项目的 Mission 与未绑定任务的会话。
 *
 * 为什么放在机器人页：Mission 是「谁带着干」的事（主管 + 子任务），
 * 不是某个项目的终端里的事；跨项目会话同理——它们不属于任何一栏任务列表。
 */
function SchedulePanel({ state, act, onOpenThread }: { state?: State | null; act: Act; onOpenThread: (id: string) => void }) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  if (!state) return <div className="bot-aside-body"><p className="bot-note">还没有项目数据。</p></div>;
  const missions = (state.todos ?? []).filter((t) => t.kind === "mission")
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
  const loose = (state.threads ?? []).filter((t) => !t.todoId && t.kind !== "bot")
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);
  const latestPlan = (missionId: string) => [...(state.missionPlans ?? [])]
    .filter((p) => p.missionId === missionId)
    .sort((a, b) => b.revision - a.revision)[0] ?? null;
  const toggle = (id: string) => setOpenIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  return (
    <div className="bot-aside-body bot-schedule">
      <div className="bot-sched-label">Mission 调度</div>
      {missions.length === 0 ? (
        <p className="inline-empty">还没有 Mission。在对话里让主管拆目标，计划会先落到这里等审批。</p>
      ) : missions.map((m) => (
        <MissionOverview
          key={m.id}
          mission={m}
          plan={latestPlan(m.id)}
          delegations={(state.delegations ?? []).filter((d) => d.missionId === m.id)}
          state={state}
          act={act}
          onOpenThread={onOpenThread}
          open={openIds.includes(m.id)}
          onToggle={() => toggle(m.id)}
        />
      ))}

      <div className="bot-sched-label">跨项目会话</div>
      {loose.length === 0 ? (
        <p className="inline-empty">没有未绑定任务的会话。</p>
      ) : loose.map((t) => (
        <button key={t.id} className="bot-sched-row" onClick={() => onOpenThread(t.id)} title={t.title || "新任务"}>
          <span className="ellipsis">{t.title || "新会话"}</span>
          <span className="tiny faint">{relTime(t.updatedAt || t.createdAt)}</span>
        </button>
      ))}
    </div>
  );
}



/** 把一轮轮回合拆成轨迹记录：输入 / 思考 / 工具 / 回复 / 终端 */
function trajectoryRecords(turns: Turn[], state?: State | null): TrajectoryRecord[] {
  const out: TrajectoryRecord[] = [];
  turns.forEach((turn, index) => {
    const n = index + 1;
    const base = turn.createdAt || Date.now();
    const push = (rec: Omit<TrajectoryRecord, "turn" | "turnId">) => out.push({ ...rec, turn: n, turnId: turn.id });
    if (turn.input) push({ id: `${turn.id}-user`, kind: "user", at: base, ms: 1, title: "用户", text: turn.input });
    for (const injected of turn.injected || []) {
      push({ id: `${turn.id}-ctx-${injected.layer}-${injected.id}`, kind: "context", at: base, ms: 1, title: injected.layer, text: injected.title });
    }
    const usageText = (usage?: Record<string, number>) => {
      if (!usage) return undefined;
      const total = usage.total_tokens ?? ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
      if (!total) return undefined;
      return `${total} tokens${usage.prompt_tokens ? ` · in ${usage.prompt_tokens}` : ""}${usage.completion_tokens ? ` · out ${usage.completion_tokens}` : ""}`;
    };
    const events = turn.trace || [];
    if (events.length) {
      events.forEach((event, index) => {
        if (event.kind === "request") {
          push({
            id: `${turn.id}-req-${event.round ?? index}`,
            kind: "assistant",
            at: event.at || base,
            ms: event.ms || 1,
            title: "模型请求",
            text: event.text || "",
            usage: [usageText(event.usage), event.ttft ? `TTFT ${event.ttft}ms` : ""].filter(Boolean).join(" · ") || undefined,
          });
        } else {
          push({
            id: `${turn.id}-evt-${event.at || index}-${event.name || index}`,
            kind: "tool",
            at: event.at || base,
            ms: event.ms || 1,
            title: event.name || "工具",
            args: event.argsRaw,
            result: event.result,
            text: event.ok === false ? "失败" : undefined,
          });
        }
      });
    } else {
      const msgs = turn.runId
        ? (state?.messages || []).filter((m) => m.runId === turn.runId && (m.kind === "tool" || m.kind === "thought"))
        : [];
      if (msgs.length) {
        for (const m of msgs) {
          const raw = String(m.content || "");
          const [head, ...rest] = raw.split("\n");
          if (m.kind === "thought") {
            push({ id: m.id, kind: "thought", at: m.createdAt, ms: 1, title: "思考", text: raw });
          } else {
            const [name, ...args] = head.split(/\s*·\s*|:\s*/);
            push({
              id: m.id, kind: "tool", at: m.createdAt, ms: 1, title: m.meta?.title || name || "工具",
              args: m.meta?.input || args.join(" · ") || head,
              result: m.meta?.output || rest.join("\n").trim() || undefined,
              text: m.meta?.status === "failed" ? "失败" : undefined,
            });
          }
        }
      } else {
        for (const [i, tool] of (turn.tools || []).entries()) {
          push({ id: `${turn.id}-tool-${i}`, kind: "tool", at: tool.at || base, ms: tool.ms || 1, title: tool.name, args: tool.argsRaw || tool.args, result: tool.result || tool.preview, text: tool.ok === false ? "失败" : undefined });
        }
      }
      if (turn.reply) {
        push({ id: `${turn.id}-assistant`, kind: "assistant", at: base + (turn.cost?.ms || 1), ms: turn.cost?.ms || 1, title: "助手", text: turn.reply });
      }
    }
    if (!turn.reply && turn.decision !== "replied" && (turn.decision === "silent" || turn.decision === "blocked" || turn.decision === "interrupted")) {
      push({ id: `${turn.id}-silent`, kind: "assistant", at: base + 1, ms: 1, title: turn.decision === "blocked" ? "被拦" : turn.decision === "interrupted" ? "被打断" : "沉默", text: turn.reason || "没有开口" });
    }
    const run = turn.runId ? state?.runs?.find((r) => r.id === turn.runId) : undefined;
    if (run?.terminalId) push({ id: `${turn.id}-terminal`, kind: "terminal", at: base + (turn.cost?.ms || 1), ms: 1, title: "终端", args: run.status });
  });
  return out;
}

function traceStepsOf(turn: Turn, state?: State | null): TraceStep[] {
  const msgs = turn.runId
    ? (state?.messages ?? []).filter((m) => m.runId === turn.runId && (m.kind === "thought" || m.kind === "tool"))
    : [];
  const steps: TraceStep[] = msgs.map((m) => {
    const lines = String(m.content || "").split("\n");
    const head = (lines[0] || "").trim();
    const rest = lines.slice(1).join("\n").trim();
    if (m.kind === "thought") {
      return { id: m.id, kind: "thought", family: "think", status: "done", title: "思考", summary: head, output: String(m.content || "").trim(), at: m.createdAt };
    }
    const [title, ...tail] = head.split(/\s*·\s*|:\s*/);
    return {
      id: m.id,
      kind: "tool",
      title: m.meta?.title || title || "工具",
      summary: m.meta?.input || tail.join(" · ") || head,
      output: m.meta?.output || rest || undefined,
      at: m.createdAt,
      // 结构化优先：家族 / 状态 / 耗时 / 父调用都从 meta 读，正则只给旧数据兜底
      family: familyOf(m.meta, { title: m.meta?.title, content: head }),
      status: statusOf(m.meta),
      durationMs: m.meta?.durationMs,
      parentToolId: m.meta?.parentToolId ?? null,
      agentId: m.meta?.agentId ?? null,
    };
  });
  if (!steps.length && turn.tools?.length) {
    for (const [i, tool] of turn.tools.entries()) {
      steps.push({
        id: `${turn.id}-tool-${i}`,
        kind: "tool",
        title: tool.name,
        summary: tool.argsRaw || (tool.args && tool.args !== "{}" ? tool.args : ""),
        output: tool.result || tool.preview,
        ok: tool.ok,
        family: tool.family || familyOf(null, { title: tool.name }),
        status: tool.statusKind || (tool.rejected ? "denied" : tool.ok === false ? "failed" : "done"),
        durationMs: tool.durationMs ?? tool.ms,
        agentId: tool.agentId ?? null,
      });
    }
  }
  const run = turn.runId ? state?.runs?.find((r) => r.id === turn.runId) : undefined;
  if (run?.terminalId) {
    steps.push({ id: `${run.id}-terminal`, kind: "terminal", title: "终端", summary: run.status, at: turn.createdAt });
  }
  return steps;
}

function ToolCard({ step, child = false }: { step: TraceStep; child?: boolean }) {
  const out = step.output || "";
  const family = step.family || familyOf(null, { title: step.title });
  const state = step.status || (step.ok === false ? "failed" : "done");
  const ms = formatDuration(step.durationMs);
  const body = (inner: React.ReactNode) => <div className="ds-card-body">{inner}</div>;
  const head = (icon: React.ReactNode, title: string, summary?: React.ReactNode, extra?: React.ReactNode) => (
    <>
      <span className="ds-row-icon" aria-hidden>{icon}</span>
      <span className="ds-tool-title">{title}</span>
      {summary && <><span className="ds-sep" aria-hidden /><span className="ds-tool-summary">{summary}</span></>}
      {extra}
      {state !== "done" && <span className={`ds-tool-status ${state}`}>{STATUS_LABEL[state]}</span>}
      {ms && <span className="ds-tool-ms mono">{ms}</span>}
      <ChevronDownIcon size={14} className="ds-tool-chev" />
    </>
  );

  const depthClass = child ? "ds-tool-card child" : "ds-tool-card";
  const object = objectOf(null, family, step.summary || "");
  // 不用语义名时用家族动词（已执行 / 已读取）；工具名本身在卡片标题里
  const label = FAMILY_VERB[family];
  const human = humanArgs(step.summary || "");
  const fileLike = (family === "read" || family === "edit") && isFileLike(object);
  if (family === "run") {
    return (
      <details className={depthClass}>
        <summary className="ds-tool-main">{head(<TerminalIcon size={14} />, label, human || "命令")}</summary>
        {body(
          <>
            <div className="ds-term-cmd">$ {step.summary || ""}</div>
            {out && <pre className="ds-term-out">{out}</pre>}
          </>,
        )}
      </details>
    );
  }
  if (family === "edit") {
    const lines = out.split("\n");
    const added = lines.filter((x) => x.startsWith("+") && !x.startsWith("+++")).length;
    const removed = lines.filter((x) => x.startsWith("-") && !x.startsWith("---")).length;
    return (
      <details className={depthClass}>
        <summary className="ds-tool-main">{head(<PencilIcon size={14} />, label, step.summary, <span className="ds-stat"><em>+{added}</em> <i>-{removed}</i></span>)}</summary>
        {body(
          <pre className="ds-diff">{lines.map((line, i) => (
            <span key={i} className={line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : ""}>{line}{"\n"}</span>
          ))}</pre>,
        )}
      </details>
    );
  }
  if (family === "read") {
    const lineCount = out ? out.split("\n").length : 0;
    return (
      <details className={depthClass}>
        <summary className="ds-tool-main">{head(<FileTextIcon size={14} />, label, fileLike ? <FileChip path={object} /> : (human || ""), lineCount ? <span className="ds-stat">{lineCount} 行</span> : null)}</summary>
        {body(<pre className="ds-card-pre">{out || "（没有内容）"}</pre>)}
      </details>
    );
  }
  if (family === "search") {
    const hits = out ? out.split("\n").filter(Boolean).length : 0;
    return (
      <details className={depthClass}>
        <summary className="ds-tool-main">{head(<SearchIcon size={14} />, label, human, hits ? <span className="ds-stat">{hits} 处</span> : null)}</summary>
        {body(<pre className="ds-card-pre">{out || "没有命中"}</pre>)}
      </details>
    );
  }
  if (family === "net") {
    return (
      <details className={depthClass}>
        <summary className="ds-tool-main">{head(<LinkIcon size={14} />, label, step.summary)}</summary>
        {body(<pre className="ds-card-pre">{out || "没有返回内容"}</pre>)}
      </details>
    );
  }
  // mcp / plan / other：外部工具与计划卡同一种「输入 → 输出」结构，标题保留工具自己的名字
  return (
    <details className={depthClass} data-family={family}>
      <summary className="ds-tool-main">{head(<ToolFamilyIcon family={family} />, label, human)}</summary>
      {body(
        <div className="ds-io-card">
          {step.summary && <div className="ds-io-row"><span>输入</span><pre>{step.summary}</pre></div>}
          {out && <div className="ds-io-row"><span>输出</span><pre>{out}</pre></div>}
        </div>,
      )}
    </details>
  );
}

/** 文件 chip：点击在预览面板打开 */
function FileChip({ path }: { path: string }) {
  const name = path.split("/").filter(Boolean).pop() || path;
  const short = name.length > 28 ? `${name.slice(0, 26)}…` : name;
  return (
    <span className="ds-file-chip" title={path}>
      <FileTextIcon size={14} />
      <button className="ds-file-chip-name" onClick={(e) => { e.stopPropagation(); requestFilePreview({ rel: path, name }); }}>{short}</button>
    </span>
  );
}

function BotTrace({ turn, state, label }: { turn: Turn; state?: State | null; label: string }) {
  const [showAll, setShowAll] = useState(false);
  const steps = traceStepsOf(turn, state);
  const run = turn.runId ? state?.runs?.find((r) => r.id === turn.runId) : undefined;
  // 这一轮干了什么：读 2 个文件 · 改 1 处 · 跑 1 条命令；再带上状态与耗时
  const summary = summarizeFamilies(steps.map((step) => step.family || familyOf(null, { title: step.title })));
  const traceState = turnStatusOf(steps.map((step) => step.status || (step.ok === false ? "failed" : "done")));
  const dur = formatDuration(turn.cost?.ms);
  const stateWord = traceState === "failed" ? "失败" : traceState === "stopped" ? "已停止" : traceState === "denied" ? "被拒" : "";
  const headLabel = [stateWord || label, summary, dur].filter(Boolean).join(" · ");
  if (!steps.length) return <div className="ds-turn-head"><span>{label}</span></div>;
  const visible = showAll || steps.length <= 20 ? steps : steps.slice(steps.length - 20);
  const hidden = steps.length - visible.length;
  return (
    <div className={`ds-steps k-${traceState}`}>
      <div className="ds-steps-head">
        <span className={`ds-steps-label k-${traceState}`}>{headLabel}</span>
      </div>
      {hidden > 0 && (
        <button className="ds-steps-more" onClick={() => setShowAll(true)}>显示更早 {hidden} 步</button>
      )}
      <div className="ds-process-body">
        {runsOfFamily(visible, (step) => step.family || familyOf(null, { title: step.title })).map((bundle) => {
          if (bundle.items.length >= 3) {
            const fam = bundle.family;
            const bad = bundle.items.some((step) => (step.status || "done") === "failed" || step.ok === false);
            return (
              <details className="ds-step-run" key={`run-${bundle.items[0].id}`}>
                <summary className="ds-tool-main ds-step-run-head">
                  <span className="ds-row-icon" aria-hidden><ToolFamilyIcon family={fam} /></span>
                  <span className="ds-tool-title">{FAMILY_VERB[fam]}</span>
                  <span className="ds-tool-summary">{bundle.items.length} {FAMILY_UNIT[fam] || "步"}</span>
                  {bad && <span className="ds-tool-status failed">有失败</span>}
                  <ChevronDownIcon size={14} className="ds-tool-chev" />
                </summary>
                {bundle.items.map((item) => (
                  <ToolCard step={item} key={item.id} child={false} />
                ))}
              </details>
            );
          }
          const step = bundle.items[0];
          const child = Boolean(step.parentToolId);
          if (step.kind === "terminal") {
            return (
              <div className="ds-tool-row" key={step.id}>
                <span className="ds-row-icon" aria-hidden><TerminalIcon size={14} /></span>
                <span className="ds-tool-main-static">
                  <span className="ds-tool-title">终端</span>
                  <span className="ds-sep" aria-hidden />
                  <span className="ds-tool-summary">{step.summary || "pty"}</span>
                </span>
                {run?.terminalId && (
                  <button
                    className="ds-action-text"
                    onClick={() => requestTerminalAdopt({ terminalId: run.terminalId!, cwd: run.cwd || "", title: "Agent 终端" })}
                  >
                    打开终端
                  </button>
                )}
              </div>
            );
          }
          if (step.kind === "thought") {
            return (
              <details className="ds-reason" key={step.id}>
                <summary className="ds-reason-head">
                  <span className="ds-row-icon"><SparkleIcon size={14} /></span>
                  <span className="ds-reason-title">思考</span>
                  {step.summary && <><span className="ds-sep" aria-hidden /><span className="ds-reason-summary">{step.summary}</span></>}
                  <ChevronDownIcon size={14} className="ds-row-chev" />
                </summary>
                {step.output && <div className="ds-reason-body">{step.output}</div>}
              </details>
            );
          }
          return <ToolCard step={step} child={child} key={step.id} />;
        })}
      </div>
    </div>
  );
}

/** 这一句对应的 run 轨迹（tool / thought）；点「在终端查看」落到它的 pty */
function TraceDetails({ runId, botName, state }: { runId?: string | null; botName?: string; state?: State | null }) {
  if (!runId) return null;
  const run = state?.runs?.find((r) => r.id === runId) ?? null;
  const trace = (state?.messages ?? []).filter((m) => m.runId === runId && (m.kind === "tool" || m.kind === "thought"));
  return (
    <details className="im-trace">
      <summary>
        轨迹
        {run && <span className={`tag ${run.status === "failed" ? "fail" : run.status === "done" ? "ok" : ""}`}>{run.status}</span>}
        {run?.terminalId && (
          <button
            className="link tiny"
            onClick={(e) => {
              e.preventDefault();
              requestTerminalAdopt({ terminalId: run.terminalId!, cwd: run.cwd || "", title: `${botName || "BOT"} · ${runId.slice(0, 6)}` });
              window.dispatchEvent(new CustomEvent("harness:view", { detail: "terminal" }));
            }}
          >
            在终端查看
          </button>
        )}
      </summary>
      <div className="im-trace-body">
        {trace.length === 0 && <div className="im-note">这次 run 还没有落工具事件（ACP 会话在跑时会有 tool / thought 片段）。</div>}
        {trace.slice(-12).map((m) => (
          <div className={`im-trace-row ${m.kind}`} key={m.id}>
            <span className="mono tiny faint">{m.kind === "tool" ? "工具" : "思考"}</span>
            <b className="ellipsis" title={m.content}>{m.content}</b>
          </div>
        ))}
      </div>
    </details>
  );
}
type Snapshot = {
  bots: Bot[]; turns: Turn[]; routines?: Routine[]; routineStatus?: Routine[];
  asks?: Ask[];
  botThreads?: Record<string, string>;
  /** 每个 bot 的会话列表：默认会话 + 自己新开的 */
  botChats?: Record<string, Chat[]>;
  recent?: { answeredHour?: number; blockedHour?: number; silentHour?: number };
  agents?: { id: string; name: string; alias: string; cli: string; role: string; hostId?: string | null }[];
  tasks?: { id: string; key: string; title: string; status: string; missionState: string | null; agentId: string | null }[];
  recentTodos?: { id: string; key: string; title: string; status: string; missionState: string | null }[];
  /** 工具目录（主进程下发，渲染层不再手写工具清单） */
  toolCatalog?: { name: string; label: string; risk: string; requiresCapability: string[] | null }[];
  /** 聊天面的小状态：草稿与阅读位置（key = botId:threadId / group:groupId） */
  botUi?: Record<string, { draft?: string; scroll?: { turnId?: string; offset?: number } | null; updatedAt?: number }>;
};

const DECISION_LABEL: Record<string, string> = { answered: "主动", reported: "汇报", watching: "监视中", asked: "先问一句", streaming: "生成中", interrupted: "被打断", silent: "沉默", blocked: "被拦", escalated: "转人工" };
/** 工具名 → 「正在查 / 正在改」；标签来自主进程下发的工具目录，找不到再按家族兜底 */
const toolLabel = (tool?: string, meta?: { label?: string; risk?: string }) => {
  const name = tool || "";
  if (meta?.label) return `正在${meta.risk === "read" ? "查" : meta.risk === "write" ? "改" : "用"} · ${meta.label}`;
  const family = familyOf(null, { title: name });
  const verb = family === "read" ? "读" : family === "edit" ? "改" : family === "run" ? "跑" : family === "net" ? "看网页" : family === "search" ? "查" : "用工具";
  return `正在${verb}${name ? ` · ${name}` : ""}`;
};
const GLYPH: Record<string, string> = { asked: "?", streaming: "…", interrupted: "⏸", silent: "·", blocked: "✕", escalated: "↗" };
const CAP_LABEL: Record<string, string> = { read: "只读", dispatch: "可起任务", work: "能执行" };
const NOTIFY_ROWS = [
  ["proactive", "主动开口", "它自己觉得值得说时"],
  ["needPermission", "需要你决定", "提问卡片 / 转人工"],
  ["taskDone", "任务完成", "它起的 run 完成时"],
  ["failed", "未能完成", "run 失败 / 回复被拦"],
] as const;
/** 群聊：一条真实记录（成员 + replyMode + 消息序列），对齐 ORCA 的 BotGroup */

const dayLabel = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "今天";
  if (d.toDateString() === yesterday.toDateString()) return "昨天";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

const hm = (ts: number) => {
  const d = new Date(ts);
  const same = new Date().toDateString() === d.toDateString();
  return `${same ? "" : `${d.getMonth() + 1}/${d.getDate()} `}${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * 群聊单条消息：memo 住。流式时只更新末尾的流式块，历史消息不参与 reconcile；
 * 微调 props（senderName / state）只在全量 snapshot 到达时变一次。
 */
const GroupMessageRow = memo(function GroupMessageRow({ m, senderName, state }: { m: BotGroupMessage; senderName?: string; state?: State | null }) {
  if (m.author === "owner") {
    return (
      <div className="ds-user" role="article" aria-label={`你 · ${hm(m.createdAt)}`}>
        {m.text && <div className="ds-bubble">{m.text}</div>}
        {(m.meta?.attachments?.length ?? 0) > 0 && (
          <div className="bot-attach-row">
            {m.meta!.attachments!.map((a) => (
              <span className="bot-attach" key={`${m.id}-${a.path}`} title={a.path}>{a.name}</span>
            ))}
          </div>
        )}
        <div className="ds-actions ds-actions-user"><span className="ds-time">{hm(m.createdAt)}</span></div>
      </div>
    );
  }
  if (m.author === "system") {
    return <div className="ds-system-note" role="note">{m.text}</div>;
  }
  const spoke = ["answered", "replied", "reported", "asked"].includes(m.decision);
  return (
    <div className="ds-assistant" role="article" aria-label={`${m.botName || senderName || "机器人"} · ${hm(m.createdAt)}`}>
      <div className="ds-bot-attr">
        <b>{m.botName || senderName}</b>
        <span className="ds-time">{hm(m.createdAt)}</span>
        <span className={`ds-tag ${spoke ? "ai" : ""}`}>{DECISION_LABEL[m.decision] || (spoke ? "回复" : "沉默")}</span>
      </div>
      {spoke
        ? <div className="ds-assistant-body"><RichText text={m.text} /></div>
        : <div className="ds-system-note">{m.text || "没有开口"}<span> · 沉默也留痕</span></div>}
      <TraceDetails runId={m.meta?.runId} botName={m.botName} state={state} />
    </div>
  );
});

/**
 * 人格 bot 控制台（P0）
 *
 * 左：bot 列表（人格 / 状态 / 本小时条数）——不是会话列表。
 * 中：回合流。说过的话是气泡；沉默 / 被拦 / 转人工是细行，且都能展开「为什么」。
 * 右：人格卡 / 记忆注入 / 出场策略。
 *
 * P0 只读能力：tick 只回答与记录，不建 todo、不起 run；dispatch 见 ARCH-bot §9。
 */
export function BotConsole({ act, notify, onOpenThread, onOpenTodo, state, initialBotId = null, onBackToBots }: {
  act: Act;
  notify: (message: string) => void;
  onOpenThread: (threadId: string) => void;
  onOpenTodo?: (todoId: string) => void;
  /** 任务投影需要它；缺省时「分配到的任务」区块只显示未绑定提示 */
  state?: State | null;
  /** 从机器人配置页「打开会话」进来时直接选它 */
  initialBotId?: string | null;
  /** 回机器人配置页 */
  onBackToBots?: () => void;
}) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [memoryOverview, setMemoryOverview] = useState<{ byLayer?: Record<string, number>; notes?: number; injectable?: number } | null>(null);
  const [skillCatalog, setSkillCatalog] = useState<{ id: string; name: string; description: string }[]>([]);
  const [webhook, setWebhook] = useState<{ running?: boolean; port?: number } | null>(null);
  /** 人格 / 职责 / 配额的历史（改坏了可恢复） */
  const [revisions, setRevisions] = useState<{ id: string; at: number; by?: string; name?: string; mission?: string }[]>([]);
  /** 某条历史与当前版本的字段差异 */
  const [revisionDiff, setRevisionDiff] = useState<{ id: string; rows: { label: string; from: unknown; to: unknown }[] } | null>(null);
  /** 记忆整理计划：到 80% 才给候选，人点「归档」才动 */
  const [tidy, setTidy] = useState<TidyPlan | null>(null);
  const [botId, setBotId] = useState("");
  /** 机器人列表搜索：按名字 / 职责 / 能力档 / 执行体过滤（群聊按名字） */
  const [botQuery, setBotQuery] = useState("");
  /** 模型选择：照 rakazo，模型属于 bot，composer 右下角选一次就写回档案（群聊不需要） */
  const [modelMenu, setModelMenu] = useState<{ x: number; y: number } | null>(null);
  const [modelCatalog, setModelCatalog] = useState<{ id: string; name: string; hint?: string }[]>([]);
  const [tab, setTab] = useState<"persona" | "capability" | "memory" | "routines" | "rules">("persona");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // 「分配到的任务」：Bot.executorAgentId → Agent，任务来自 state.todos（与场景同一投影）
  const botEntity = snapshot?.bots.find((b) => b.id === botId);
  const assigned = useMemo(
    () => assignmentsForBot(state?.todos ?? [], state?.delegations, { executorAgentId: botEntity?.executorAgentId ?? null }),
    [state?.todos, state?.delegations, botEntity?.executorAgentId],
  );
  /** 同事消息（peer mail）：对方没能在当轮回的，挂在这个 bot 名下等下一轮 */
  const pendingMails = useMemo(
    () => (state?.botPeerMails ?? []).filter((m) => m.status === "pending" && m.toBotId === (botEntity?.id ?? "")),
    [state?.botPeerMails, botEntity?.id],
  );
  const [draft, setDraft] = useState("");
  /** 会话（ORCA 的 Chats）：null = 看列表，有值 = 在那条会话里 */
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  /** 右栏：消息（会话列表）或设置（人格 / 日程 / 配额） */
  const [railTab, setRailTab] = useState<"messages" | "schedule" | "settings">("messages");
  /** 中栏：对话 / 轨迹 */
  const [chatView, setChatView] = useState<"chat" | "trajectory">("chat");
  /** 从某一轮的动作进轨迹时定位到那一轮（null = 看全部） */
  const [trajectoryTurn, setTrajectoryTurn] = useState<string | null>(null);
  const [chatQuery, setChatQuery] = useState("");
  const [chatHits, setChatHits] = useState<{ threadId: string; snippet: string }[]>([]);
  /** 行内重命名会话（Electron 不实现 window.prompt） */
  /** 转录窗口：一次只画最近 N 个块（200 轮也不会堆出几千个节点） */
  const [renderBlocks, setRenderBlocks] = useState(40);
  const [renamingChat, setRenamingChat] = useState<{ id: string; title: string } | null>(null);
  /** 删除机器人后的撤销条 */
  const [undo, setUndo] = useState<UndoAction | null>(null);
  /** 监视任务：搜索而不是从 30 条里翻 */
  const [watchQuery, setWatchQuery] = useState("");
  /** 工作区目标：行内编辑（Electron 不实现 window.prompt，所以不弹窗） */
  const [wsGoalEdit, setWsGoalEdit] = useState<{ id: string; goal: string } | null>(null);
  /** 交回的工作区默认折叠；展开是只看历史，不影响观察面 */
  const [showReleasedWs, setShowReleasedWs] = useState(false);
  /** 新建群聊：名字 + 勾成员（不再写死「项目群」+ 全员） */
  const [groupDraft, setGroupDraft] = useState<{ name: string; ids: string[] } | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  /** 群共识：所有成员都注入；空 = 不注入 */
  const [groupMemoDraft, setGroupMemoDraft] = useState("");
  /** 会话行展开：这条会话起过的执行（ORCA 的 worker 树） */
  const [expandedChat, setExpandedChat] = useState<string | null>(null);
  /** 附件：随这句话一起带进上下文（文本，读自 docsPick） */
  const [attachments, setAttachments] = useState<{ name: string; path: string; text: string }[]>([]);
  /** 群聊里打 @ 弹出的成员选择器（ORCA 的 mention targets） */
  const [mentionAt, setMentionAt] = useState<{ at: number; query: string } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  /** 递增就重挂「名字」输入框并聚焦（新建 bot 后立刻改名，不用再找入口） */
  const [renameFocus, setRenameFocus] = useState(0);
  /** 日程的新建表单（不再用 window.prompt 连环弹窗） */
  const [routineDraft, setRoutineDraft] = useState<{
    kind: "daily" | "every" | "once" | "watch"; name: string; prompt: string; atHour: number; minutes: number; onceAt: string; path: string;
  } | null>(null);
  const [streaming, setStreaming] = useState<{ botId: string; text: string; phase: "thinking" | "tool" | "streaming"; tool?: string } | null>(null);
  /** 群聊：每个成员一条流式块（主进程逐个回，不能只存一条） */
  const [groupStream, setGroupStream] = useState<{ botId: string; name: string; text: string }[]>([]);
  /** 群聊：还没吐字但已经在想的成员（thinking / tool） */
  const [groupPhases, setGroupPhases] = useState<Record<string, { name: string; phase: "thinking" | "tool"; tool?: string }>>({});
  /** 群聊：主进程增量下发的消息；全量 snapshot 还没到的时候先拼在本地 */
  const [groupLive, setGroupLive] = useState<BotGroupMessage[]>([]);
  /** 群聊：自己刚发出去的那句先就地显示，不等后端返回 */
  const [pendingOwner, setPendingOwner] = useState<{ text: string; at: number; threadId: string } | null>(null);
  /** 群内多话题：当前话题（空 = 默认话题） */
  const [groupThreadId, setGroupThreadId] = useState("");
  /** 话题改名：行内输入，不弹 prompt */
  const [threadRenaming, setThreadRenaming] = useState<{ id: string; title: string } | null>(null);
  /** 1:1：自己刚发出去的那句先就地显示；回合落库后让位 */
  const [pendingUser, setPendingUser] = useState<{ text: string; at: number } | null>(null);
  const groupIdRef = useRef("");
  /** 输入法：composition 期间的回车只上屏（Candidate 里按 Enter 不该发送） */
  const composingRef = useRef(false);
  /** delta 先按帧攒着，一帧最多一次 setState */
  const deltaBufRef = useRef(new Map<string, { groupId?: string; name?: string; text: string }>());
  const deltaRafRef = useRef(0);
  /**
   * 网关常在 40ms 内把整段推完（实测 Ark 6 个 delta / 39ms），直接 setState 看起来
   * 还是「整段出现」。这里做一层很短的打字机：只影响观感，不改落库内容。
   */
  const revealRef = useRef<{ one: { target: string; shown: number }; group: Map<string, { target: string; shown: number }> }>({ one: { target: "", shown: 0 }, group: new Map() });
  const revealRafRef = useRef(0);
  const revealLastRef = useRef(0);
  const startReveal = () => {
    if (revealRafRef.current) return;
    revealLastRef.current = performance.now();
    const step = (now: number) => {
      revealRafRef.current = 0;
      const dt = Math.max(8, Math.min(64, now - revealLastRef.current));
      revealLastRef.current = now;
      const st = revealRef.current;
      const budget = Math.max(1, Math.round(dt * 0.06)); // ~60 字/秒，短回复约 0.8s 长出来
      let more = false;
      if (st.one.shown < st.one.target.length) {
        const left = st.one.target.length - st.one.shown;
        const take = left > 600 ? left : Math.max(budget, Math.ceil(left / 60));
        st.one.shown = Math.min(st.one.target.length, st.one.shown + take);
        setStreaming((prev) => (prev ? { ...prev, text: st.one.target.slice(0, st.one.shown), phase: "streaming" } : prev));
        more = st.one.shown < st.one.target.length;
      }
      if (st.group.size) {
        const texts = new Map<string, string>();
        for (const [botId, item] of st.group) {
          if (item.shown >= item.target.length) continue;
          const left = item.target.length - item.shown;
          const take = left > 600 ? left : Math.max(budget, Math.ceil(left / 60));
          item.shown = Math.min(item.target.length, item.shown + take);
          texts.set(botId, item.target.slice(0, item.shown));
          if (item.shown < item.target.length) more = true;
        }
        if (texts.size) setGroupStream((prev) => prev.map((s) => (texts.has(s.botId) ? { ...s, text: texts.get(s.botId)! } : s)));
      }
      if (more) revealRafRef.current = requestAnimationFrame(step);
    };
    revealRafRef.current = requestAnimationFrame(step);
  };
  /** 回合流自己滚：贴底时跟着新内容走，用户主动往上翻就不抢 */
  const streamRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  /** 跟随阈值 24px（dsh 同口径）；上翻多少就不跟随，由读者的手势说了算 */
  const FOLLOW_PX = 24;
  /** 不在贴底时累积的新块数，用来画「N 条新消息 ↓」 */
  const [pendingCount, setPendingCount] = useState(0);
  const pendingCountRef = useRef(0);
  const setPending = (n: number) => { pendingCountRef.current = n; setPendingCount(n); };

  const turnCount = snapshot?.turns?.length ?? 0;
  const streamText = streaming?.text?.length ?? 0;
  /** 群聊的流式长度：自己那句 + 每个成员的增量，用来触发贴底滚动 */
  const groupStreamText = groupStream.reduce((n, s) => n + s.text.length, 0) + (pendingOwner?.text.length ?? 0);
  // 换 bot = 换一条时间线：重新贴底
  /** 「交给机器人」从别的页面指过来：跟着 initialBotId 切人，而不是只在首次挂载时生效 */
  useEffect(() => {
    if (initialBotId) setBotId(initialBotId);
  }, [initialBotId]);

  useEffect(() => {
    stickRef.current = true;
    setOpenThreadId(null); setRailTab("messages"); setChatQuery(""); setChatHits([]);
    setGroupLive([]); setGroupPhases({}); setPendingUser(null); setRenderBlocks(40);
  }, [botId]);

  const load = useCallback(async () => {
    try {
      const next = (await act("botSnapshot", {})) as Snapshot | null;
      if (next) {
        setSnapshot(next);
        setBotId((current) => current || (initialBotId && next.bots.some((b) => b.id === initialBotId) ? initialBotId : "") || next.bots[0]?.id || "");
      }
      const ov = (await act("memoryOverview", {})) as { byLayer?: Record<string, number>; notes?: number; injectable?: number } | null;
      if (ov) setMemoryOverview(ov);
    } catch (err) {
      setError(String((err as Error)?.message || err));
    }
  }, [act, initialBotId]);

  useEffect(() => { void load(); }, [load]);

  // 流式增量：主进程已经按 ~16ms 合并过；渲染层再按帧合并，一帧最多一次 setState。
  // 之前每个 token 都 setGroupStream，整个 BotConsole（整段历史）会跟着 reconcile，长会话必卡。
  useEffect(() => {
    const flush = () => {
      deltaRafRef.current = 0;
      const entries = [...deltaBufRef.current.entries()];
      deltaBufRef.current.clear();
      if (!entries.length) return;
      const groupEntries = entries.filter(([, v]) => v.groupId);
      if (groupEntries.length) {
        for (const [botId, v] of groupEntries) {
          if (v.groupId !== groupIdRef.current) continue;
          const item = revealRef.current.group.get(botId) || { target: "", shown: 0 };
          item.target += v.text;
          revealRef.current.group.set(botId, item);
        }
        setGroupStream((prev) => {
          const next = prev.map((s) => ({ ...s }));
          for (const [botId, v] of groupEntries) {
            if (v.groupId !== groupIdRef.current) continue;
            if (!next.some((s) => s.botId === botId)) next.push({ botId, name: v.name || "", text: "" });
          }
          return next;
        });
        startReveal();
      }
      const single = entries.find(([, v]) => !v.groupId);
      if (single) {
        const [, v] = single;
        revealRef.current.one.target += v.text;
        startReveal();
      }
    };
    const off = window.harness.onBotDelta((payload) => {
      if (!payload?.delta) return;
      if (payload.groupId && payload.groupId !== groupIdRef.current) return;
      if (payload.groupId && (payload.threadId || "") !== groupThreadIdRef.current) return;
      const item = deltaBufRef.current.get(payload.botId)
        || { groupId: payload.groupId, name: payload.name, text: "" };
      item.groupId = payload.groupId;
      item.name = payload.name;
      item.text += payload.delta;
      deltaBufRef.current.set(payload.botId, item);
      if (!deltaRafRef.current) deltaRafRef.current = requestAnimationFrame(flush);
    });
    return () => {
      off();
      if (deltaRafRef.current) cancelAnimationFrame(deltaRafRef.current);
    };
  }, []);

  // 相位 / 工具 / 群消息：让「发出去之后」立刻有可见状态，而不是等首 token。
  useEffect(() => {
    const offPhase = window.harness.onBotPhase?.((p) => {
      if (!p) return;
      if (p.groupId) {
        if (p.groupId !== groupIdRef.current) return;
        if ((p.threadId || "") !== groupThreadIdRef.current) return;
        setGroupPhases((prev) => {
          const next = { ...prev };
          if (p.phase === "done") delete next[p.botId];
          else next[p.botId] = {
            name: p.name || prev[p.botId]?.name || "",
            phase: p.phase === "tool" ? "tool" : "thinking",
            tool: p.tool,
          };
          return next;
        });
        return;
      }
      setStreaming((prev) => {
        // 1:1 的收尾交给 send()：它在 load() 之后才清 streaming，避免「流式块消失、
        // 回合还没上屏」的空窗。群聊没有这个问题，done 直接删相位。
        if (p.phase === "done") return prev;
        const phase = p.phase === "tool" ? "tool" : "thinking";
        if (prev && prev.botId === p.botId) return { ...prev, phase, tool: p.tool ?? prev.tool };
        return { botId: p.botId, text: "", phase, tool: p.tool };
      });
    });
    const offTool = window.harness.onBotTool?.((p) => {
      if (!p) return;
      if (p.groupId) {
        if (p.groupId !== groupIdRef.current) return;
        if ((p.threadId || "") !== groupThreadIdRef.current) return;
        setGroupPhases((prev) => {
          if (p.phase === "done") {
            if (!prev[p.botId]) return prev;
            return { ...prev, [p.botId]: { ...prev[p.botId], phase: "thinking", tool: undefined } };
          }
          return { ...prev, [p.botId]: { name: p.botName || prev[p.botId]?.name || "", phase: "tool", tool: p.name } };
        });
        return;
      }
      setStreaming((prev) => (prev && prev.botId === p.botId
        ? { ...prev, phase: p.phase === "start" ? "tool" : "thinking", tool: p.phase === "start" ? p.name : undefined }
        : prev));
    });
    const offMessage = window.harness.onBotGroupMessage?.((p) => {
      if (!p?.message || p.groupId !== groupIdRef.current) return;
      setGroupLive((prev) => (prev.some((m) => m.id === p.message.id) ? prev : [...prev, p.message]));
      if ((p.message.threadId || "") !== groupThreadIdRef.current) return;
      setGroupPhases((prev) => {
        if (!prev[p.message.botId || ""]) return prev;
        const next = { ...prev };
        delete next[p.message.botId || ""];
        return next;
      });
    });
    return () => { offPhase?.(); offTool?.(); offMessage?.(); };
  }, []);

  const groups = state?.botGroups ?? [];
  const botMatched = (() => {
    const all = snapshot?.bots ?? [];
    const q = botQuery.trim().toLowerCase();
    if (!q) return { bots: all, groups, empty: false };
    const bots = all.filter((b) => {
      const hay = [b.name, b.persona?.mission, CAP_LABEL[b.capability || "read"], b.role === "supervisor" ? "主管" : "员工"]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
    const gs = groups.filter((g) => g.name.toLowerCase().includes(q));
    return { bots, groups: gs, empty: bots.length === 0 && gs.length === 0 };
  })();
  const group = groups.find((g) => g.id === botId) ?? null;
  const isGroup = Boolean(group);
  useEffect(() => { setGroupNameDraft(group?.name || ""); }, [group?.id, group?.name]);
  useEffect(() => { setGroupMemoDraft(group?.memo || ""); }, [group?.id, group?.memo]);
  // 主进程推的 delta 在 effect 里订阅（只订一次），所以当前群用 ref 带进去
  useEffect(() => { groupIdRef.current = group?.id || ""; }, [group?.id]);
  const groupThreadIdRef = useRef("");
  useEffect(() => {
    groupThreadIdRef.current = groupThreadId;
    // 换话题：上一个话题还在流的块不要串到新话题上
    setGroupStream([]);
    setGroupPhases({});
  }, [groupThreadId]);
  // 换群：回到默认话题
  useEffect(() => { setGroupThreadId(""); setThreadRenaming(null); }, [group?.id]);
  const groupThreads = group?.threads ?? [];
  // 正在看这个群的某个话题：只清这条话题的未读（切群 / 切话题 / 新消息都会跑）
  useEffect(() => {
    if (!group) return;
    const key = groupThreadId || "main";
    const readAt = (group.reads?.[key] ?? (key === "main" ? group.lastReadAt || 0 : 0));
    const latest = (state?.botGroupMessages ?? []).reduce((max, m) => m.groupId === group.id && (m.threadId || "main") === key ? Math.max(max, m.createdAt || 0) : max, 0);
    if (latest > readAt) void act("botGroupSeen", { id: group.id, threadId: groupThreadId });
  }, [act, group?.id, group?.lastReadAt, group?.reads, groupThreadId, state?.botGroupMessages]);
  /** 每个「群 + 话题」最新消息与未读数；群行取所有话题之和 */
  const groupNews = useMemo(() => {
    const map: Record<string, { latest: number; count: number; lastRead: number }> = {};
    for (const g of state?.botGroups ?? []) {
      map[`${g.id}:main`] = { latest: 0, count: 0, lastRead: g.reads?.main ?? g.lastReadAt ?? 0 };
      for (const th of g.threads ?? []) map[`${g.id}:${th.id}`] = { latest: 0, count: 0, lastRead: g.reads?.[th.id] ?? 0 };
    }
    for (const m of state?.botGroupMessages ?? []) {
      const key = `${m.groupId}:${m.threadId || "main"}`;
      const row = map[key];
      if (!row) continue;
      const at = m.createdAt || 0;
      if (at > (row.lastRead || 0)) row.count += 1;
      row.latest = Math.max(row.latest, at);
    }
    return map;
  }, [state?.botGroups, state?.botGroupMessages]);
  const groupUnreadCount = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, row] of Object.entries(groupNews)) {
      const gid = key.slice(0, key.lastIndexOf(":"));
      out[gid] = (out[gid] || 0) + row.count;
    }
    return out;
  }, [groupNews]);
  const groupMessages = useMemo(() => {
    const thread = groupThreadId || "";
    const base = (state?.botGroupMessages ?? []).filter((m) => m.groupId === group?.id && (m.threadId || "") === thread);
    const seen = new Set(base.map((m) => m.id));
    return [...base, ...groupLive.filter((m) => m.groupId === group?.id && (m.threadId || "") === thread && !seen.has(m.id))].sort((a, b) => a.seq - b.seq);
  }, [state?.botGroupMessages, group?.id, groupLive, groupThreadId]);
  /** 自己那句：后端回声一到就用真的那条，别和乐观气泡同时出现 */
  const awaitingOwnerEcho = Boolean(pendingOwner) && (pendingOwner!.threadId || "") === (groupThreadId || "")
    && !groupMessages.some((m) => m.author === "owner" && m.text === pendingOwner!.text && m.createdAt >= pendingOwner!.at - 1500);
  const groupPhaseCount = Object.keys(groupPhases).length;
  // 贴底：回合流自己滚（整页填充时），群聊的回声 / 流式 / 跑完都不掉队。
  // scrollTop 写入放进 rAF，避免每帧同步 layout。
  const contentKey = `${turnCount}|${groupMessages.length}|${groupThreadId}|${streamText > 0}|${groupStreamText > 0}|${pendingUser ? 1 : 0}|${pendingOwner ? 1 : 0}|${groupPhaseCount}|${streaming?.phase || ""}`;
  const lastContentKeyRef = useRef(contentKey);
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const changed = lastContentKeyRef.current !== contentKey;
    lastContentKeyRef.current = contentKey;
    if (!stickRef.current) {
      // 不在贴底：内容变了就攒一条「N 条新消息」，别抢读者的位置
      if (changed) setPending(pendingCountRef.current + 1);
      return;
    }
    const raf = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(raf);
  }, [contentKey, botId, openThreadId, groupThreadId]);
  const bot = useMemo(() => (isGroup ? null : snapshot?.bots.find((b) => b.id === botId) ?? snapshot?.bots[0] ?? null), [snapshot, botId, isGroup]);

  useEffect(() => {
    if (!bot?.id) { setRevisions([]); return; }
    let alive = true;
    void act("botRevisions", { botId: bot.id })
      .then((rows) => { if (alive) setRevisions(Array.isArray(rows) ? rows : []); })
      .catch(() => { /* 没有历史不影响主流程 */ });
    return () => { alive = false; };
  }, [act, bot?.id, snapshot?.bots]);

  const refreshTidy = useCallback(async () => {
    if (!bot?.id) { setTidy(null); return; }
    try {
      setTidy((await act("botMemoryTidyPlan", { botId: bot.id })) as TidyPlan | null);
    } catch {
      setTidy(null);
    }
  }, [act, bot?.id]);

  useEffect(() => {
    if (tab === "memory") void refreshTidy();
  }, [tab, refreshTidy, snapshot?.turns]);
  const members = snapshot?.bots ?? [];
  const botOf = useCallback((id?: string) => members.find((b) => b.id === id) ?? null, [members]);
  /** 工具标签也走主进程下发的目录（流式提示「正在查 · 看目录」） */
  const toolMeta = useMemo(
    () => Object.fromEntries((snapshot?.toolCatalog || []).map((t) => [t.name, t])) as Record<string, { label?: string; risk?: string }>,
    [snapshot?.toolCatalog],
  );
  /** 默认会话 = 老回合与主动开口的落点；新开的会话只装自己的回合 */
  const defaultThreadId = (bot?.id ? snapshot?.botThreads?.[bot.id] : null) || null;
  const turns = useMemo(() => {
    const all = [...(snapshot?.turns || [])].sort((a, b) => a.createdAt - b.createdAt);
    if (isGroup) return all;
    const mine = all.filter((t) => t.botId === bot?.id);
    if (!openThreadId) return mine;
    return mine.filter((t) => (t.threadId ?? defaultThreadId) === openThreadId);
  }, [snapshot, bot?.id, isGroup, openThreadId, defaultThreadId]);
  /** 1:1 同理：回合落库后让位给真正的用户消息 */
  const awaitingUserEcho = Boolean(pendingUser) && !turns.some((t) => t.input === pendingUser!.text && t.createdAt >= pendingUser!.at - 1500);
  /** 把回合切成「IM 行」：日期分隔 / 连续的沉默合并成一行 / 同一人连说合并头像 */
  const rows = useMemo(() => {
    type Row =
      | { kind: "day"; key: string; label: string }
      | { kind: "quiet"; key: string; turns: Turn[] }
      | { kind: "msg"; key: string; turn: Turn; cont: boolean };
    const out: Row[] = [];
    let lastDay = "";
    let lastSender = "";
    let quiet: Turn[] = [];
    const flush = () => {
      if (!quiet.length) return;
      out.push({ kind: "quiet", key: `q-${quiet[0].id}`, turns: quiet });
      quiet = [];
      lastSender = "";
    };
    for (const turn of turns) {
      if (turn.decision === "watching") continue;
      const day = dayLabel(turn.createdAt);
      if (day !== lastDay) {
        flush();
        out.push({ kind: "day", key: `d-${day}-${turn.id}`, label: day });
        lastDay = day;
        lastSender = "";
      }
      const isMessage = ["answered", "replied", "reported", "asked"].includes(turn.decision || "answered");
      if (!isMessage) { quiet.push(turn); continue; }
      flush();
      // 一问一答里「你」先出现，所以这一组从你开始；bot 连续说才合并
      const sender = turn.decision === "replied" ? "you" : turn.botId;
      out.push({ kind: "msg", key: turn.id, turn, cont: lastSender === sender && sender !== "you" });
      lastSender = sender;
    }
    flush();
    return out;
  }, [turns]);
  const railTurns = useMemo(
    () => rows.filter((r) => r.kind === "msg").map((r, i) => ({ id: r.turn.id, index: i + 1, turn: r.turn })),
    [rows],
  );
  /** 窗口化：只渲染最后 renderBlocks 个块，上面留一个「加载更早的回合」 */
  const hiddenRows = Math.max(0, rows.length - renderBlocks);
  const visibleRows = hiddenRows ? rows.slice(hiddenRows) : rows;
  const hiddenGroup = Math.max(0, groupMessages.length - renderBlocks);
  const visibleGroup = hiddenGroup ? groupMessages.slice(hiddenGroup) : groupMessages;
  /** 悬停 / 聚焦回合轨的细线：就地预览这一轮说了什么（不占常驻位） */
  const [peek, setPeek] = useState<{ id: string; top: number } | null>(null);
  const showPeek = (id: string, el: HTMLElement) => {
    const main = el.closest(".bot-main") as HTMLElement | null;
    if (!main) return;
    const base = main.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    setPeek({ id, top: box.top - base.top + box.height / 2 });
  };
  /** 回合轨只画细线不写数字：靠 dark 一条标出「现在读的是第几轮」 */
  const [activeTurnId, setActiveTurnId] = useState("");
  /** 视口顶上是哪一轮：滚动同步与阅读位置都用它（纯读 DOM，不依赖 state） */
  const currentTurnIdOf = (root: HTMLElement) => {
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-turn-id]"));
    if (!nodes.length) return "";
    const rootTop = root.getBoundingClientRect().top;
    let currentId = nodes[0].dataset.turnId || "";
    for (const node of nodes) {
      if (node.getBoundingClientRect().top - rootTop <= 32) currentId = node.dataset.turnId || currentId;
    }
    return currentId;
  };
  const syncActiveTurn = useCallback(() => {
    const root = streamRef.current;
    if (!root) return;
    setActiveTurnId(currentTurnIdOf(root));
  }, []);
  useEffect(() => {
    if (chatView === "chat") syncActiveTurn();
  }, [turns.length, chatView, botId, openThreadId, syncActiveTurn]);

  const jumpToTurn = (id: string) => {
    const root = streamRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-turn-id="${id}"]`) as HTMLElement | null;
    if (!el) return;
    stickRef.current = false;
    root.scrollTo({ top: el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 8, behavior: "smooth" });
  };
  const answered = turns.filter((t) => t.decision === "answered");
  const lastInjected = [...answered].reverse().find((t) => (t.injected || []).length)?.injected || [];
  const lastContext = [...turns].reverse().find((t) => t.context)?.context || null;
  const muted = Boolean(bot?.mutedUntil && bot.mutedUntil > Date.now());

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError("");
    try { await fn(); await load(); }
    catch (err) { setError(String((err as Error)?.message || err)); }
    finally { setBusy(""); }
  };

  const groupMembers = useMemo(
    () => (group ? members.filter((m) => group.memberIds.includes(m.id)) : []),
    [group, members],
  );
  const replyMode = group?.replyMode ?? { kind: "mentions" as const };
  const setReplyMode = (mode: { kind: "bot" | "all" | "mentions"; botId?: string; pace?: "serial" | "parallel" }) => {
    if (!group) return;
    const pace = mode.pace || replyMode.pace || "parallel";
    void act("botGroupSave", { id: group.id, replyMode: mode.kind === "bot" ? { kind: "bot", botId: mode.botId || groupMembers[0]?.id || "", pace } : { kind: mode.kind, pace } });
  };
  const setGroupPace = (pace: "serial" | "parallel") => {
    if (!group) return;
    setReplyMode({ kind: replyMode.kind, botId: "botId" in replyMode ? replyMode.botId : undefined, pace });
  };
  /** 建群：名字自取、成员自选（不再写死「项目群 + 全员」） */
  const createGroupWith = async () => {
    if (!groupDraft) return;
    const name = groupDraft.name.trim() || "群聊";
    if (!groupDraft.ids.length) { notify("至少选一个成员"); return; }
    const res = (await act("botGroupSave", { name, memberIds: groupDraft.ids, replyMode: { kind: "mentions" } })) as { id?: string } | null;
    setGroupDraft(null);
    if (res?.id) setBotId(res.id);
  };

  const renameGroup = async () => {
    if (!group) return;
    const name = groupNameDraft.trim();
    if (!name || name === group.name) { setGroupNameDraft(group.name); return; }
    await act("botGroupSave", { id: group.id, name });
  };

  const toggleGroupMember = async (memberId: string) => {
    if (!group) return;
    const on = group.memberIds.includes(memberId);
    const ids = on ? group.memberIds.filter((id) => id !== memberId) : [...group.memberIds, memberId];
    if (!ids.length) { notify("群里至少留一个人；要解散请用「删除群聊」"); return; }
    await act("botGroupSave", { id: group.id, memberIds: ids });
  };

  const deleteGroup = async () => {
    if (!group) return;
    if (!(await confirmDialog({ danger: true, title: `删除群聊「${group.name}」？`, desc: "群里的消息会一起删除；机器人本身不受影响。" }))) return;
    await act("botGroupRemove", { id: group.id });
    setBotId("");
  };

  const newGroupThread = async () => {
    if (!group) return;
    try {
      const res = (await act("botGroupThreadNew", { groupId: group.id })) as { thread?: { id: string } } | null;
      if (res?.thread?.id) setGroupThreadId(res.thread.id);
      await load();
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  };
  const renameGroupThread = async () => {
    if (!group || !threadRenaming) return;
    await run("thread", () => act("botGroupThreadRename", { groupId: group.id, threadId: threadRenaming.id, title: threadRenaming.title }));
    setThreadRenaming(null);
  };
  const removeGroupThread = async (thread: { id: string; title: string }) => {
    if (!group) return;
    if (!(await confirmDialog({ danger: true, title: `删除话题「${thread.title}」？`, desc: "这个话题里的消息会一起删除；其他话题和机器人不受影响。" }))) return;
    await run("thread", () => act("botGroupThreadRemove", { groupId: group.id, threadId: thread.id }));
    if (groupThreadId === thread.id) setGroupThreadId("");
  };

  /** 草稿键：1:1 按 bot + 会话，群聊按群；切走再回来草稿还在 */
  const draftKey = isGroup && group ? `group:${group.id}:${groupThreadId || "main"}` : `${botId || ""}:${openThreadId || "default"}`;
  /** 阅读位置采样：滚动停下 500ms 记一次（贴底时不记，回到底部就是默认） */
  const lastScrollSaveRef = useRef(0);
  const saveScroll = () => {
    const el = streamRef.current;
    if (!el || !draftKey || stickRef.current) return;
    const turnId = currentTurnIdOf(el);
    if (!turnId) return;
    const node = el.querySelector(`[data-turn-id="${turnId}"]`) as HTMLElement | null;
    if (!node) return;
    const offset = Math.round(node.getBoundingClientRect().top - el.getBoundingClientRect().top);
    void act("botUiSave", { key: draftKey, scroll: { turnId, offset } });
  };
  /** 打开会话时把上次的阅读位置放回去；找不到那一轮就落到最新 */
  const restoredForRef = useRef("");
  useEffect(() => {
    const el = streamRef.current;
    if (!el || !draftKey || restoredForRef.current === draftKey) return;
    restoredForRef.current = draftKey;
    const saved = snapshot?.botUi?.[draftKey]?.scroll;
    if (!saved?.turnId) return;
    stickRef.current = false;
    requestAnimationFrame(() => {
      const node = el.querySelector(`[data-turn-id="${saved.turnId}"]`) as HTMLElement | null;
      if (!node) return;
      el.scrollTop = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop + (saved.offset || 0);
    });
  }, [draftKey, snapshot]);

  // 切会话 / 切 bot：先把这一格的草稿取回来（只在 key 变时跑，不覆盖正在输入的内容）
  useEffect(() => {
    if (!draftKey) return;
    setDraft(snapshot?.botUi?.[draftKey]?.draft || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  // 输入 500ms 后落一次盘（只写 bot_ui 一行，不广播整份 state）
  useEffect(() => {
    if (!draftKey) return;
    const key = draftKey;
    const text = draft;
    const timer = setTimeout(() => { void act("botUiSave", { key, draft: text }); }, 500);
    return () => clearTimeout(timer);
  }, [draft, draftKey, act]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    if (isGroup && group && /@everyone\b/iu.test(text)) {
      const ok = await confirmDialog({
        title: "同时叫醒全体成员？",
        desc: `@everyone 会让 ${groupMembers.length} 个成员各回一条，按各自配额扣 token。`,
        ok: "叫醒",
      });
      if (!ok) return;
    }
    if (isGroup && group) {
      const files = attachments;
      setDraft("");
      setAttachments([]);
      setError("");
      // 自己的话和「正在回」的占位立刻出来：群里每个成员都要想一会儿，不能整段空白
      setPendingOwner({ text, at: Date.now(), threadId: groupThreadId });
      setGroupStream([]);
      setGroupPhases({});
      revealRef.current.group.clear();
      stickRef.current = true;
      setBusy("group");
      try {
        const res = await act("botGroupSend", { id: group.id, text, threadId: groupThreadId, attachments: files }) as { messages?: unknown[] } | null;
        if (!res) { setDraft(text); setAttachments(files); return; }
        await load();
      } catch (err) {
        setError(String((err as Error)?.message || err));
        setDraft(text);
        setAttachments(files);
      } finally {
        setBusy("");
        setPendingOwner(null);
        setGroupStream([]);
        setGroupPhases({});
        revealRef.current.group.clear();
      }
      return;
    }
    const sendTo = bot?.id;
    if (!sendTo) return;
    // 附件拼在正文后面：网关只吃文本，所以把文件内容当上下文带过去，并在正文里留出处
    const withFiles = attachments.length
      ? `${text}\n\n${attachments.map((a) => `附件 ${a.name}（${a.path}）\n\`\`\`\n${a.text.slice(0, 4000)}\n\`\`\``).join("\n\n")}`
      : text;
    setDraft("");
    setAttachments([]);
    setError("");
    // 自己的话立刻上屏；bot 回合结束、落库后由 awaitingUserEcho 自动让位
    setPendingUser({ text, at: Date.now() });
    revealRef.current.one = { target: "", shown: 0 };
    setStreaming({ botId: sendTo, text: "", phase: "thinking" });
    stickRef.current = true;
    try {
      const res = await window.harness.action("botChat", { botId: sendTo, text: withFiles, threadId: openThreadId ?? undefined }) as { ok?: boolean; result?: unknown; error?: string } | null;
      if (!res?.ok) throw new Error(String(res?.error || "没有返回结果"));
      await load();
    } catch (err) {
      const message = String((err as Error)?.message || err);
      // 取消不是失败：回合已经落成「被打断」，刷新一下就能看到半截
      if (/abort/i.test(message)) { notify("已取消这次回复"); await load(); }
      else { setError(message); setDraft(text); }
      setPendingUser(null);
    } finally {
      setStreaming(null);
      composerRef.current?.focus();
      setPendingUser(null);
      revealRef.current.one = { target: "", shown: 0 };
    }
  };

  /** 引用一句再问：只带被引的那几行，别把整段历史再贴一遍 */
  const quote = (text: string) => {
    const line = String(text || "").split("\n").filter((l) => l.trim()).slice(0, 3).join("\n");
    if (!line) return;
    setDraft((prev) => `> ${line.split("\n").join("\n> ")}\n\n${prev}`);
    composerRef.current?.focus();
  };

  /** 附件：读文本进来（和知识库同一套 docsPick / docsRead，不另造存储） */
  const pickAttachments = async () => {
    try {
      const picked = await window.harness.docsPick();
      const usable = (picked || []).filter((p) => p.text && !p.error).slice(0, 3 - attachments.length);
      if (!usable.length) { notify("没读到可用的文本文件"); return; }
      setAttachments((prev) => [...prev, ...usable.map((p) => ({ name: p.name, path: p.path, text: String(p.text || "") }))].slice(0, 3));
    } catch (err) { notify(String((err as Error)?.message || err)); }
  };

  /** 分支：复制到当前末尾，新会话里换一种说法重开（源会话不动） */
  const forkChat = (threadId: string) => void run("fork", async () => {
    const res = (await act("botChatFork", { threadId })) as { thread?: { id?: string } } | null;
    if (res?.thread?.id) { openChat(res.thread.id); notify("已分支出新会话"); }
  });

  /** 会话列表（照搬 ORCA 的 Chats）：默认会话 + 自己新开的；搜索时按命中过滤 */
  const chats = useMemo(() => {
    const list = (bot?.id ? snapshot?.botChats?.[bot.id] : null) || [];
    const q = chatQuery.trim().toLowerCase();
    if (!q) return list;
    const hitIds = new Set(chatHits.map((h) => h.threadId));
    return list.filter((c) => hitIds.has(c.id) || c.title.toLowerCase().includes(q));
  }, [snapshot?.botChats, bot?.id, chatQuery, chatHits]);
  // 选中一个 bot 时，中间直接打开它最新的一条对话（chatsOf 已按 updatedAt 倒序）
  useEffect(() => {
    if (isGroup || !chats.length) return;
    if (openThreadId && chats.some((c) => c.id === openThreadId)) return;
    setOpenThreadId(chats[0].id);
  }, [chats, openThreadId, isGroup]);
  const snippetOf = (id: string) => chatHits.find((h) => h.threadId === id)?.snippet || "";
  /** 这条会话起过的执行：回合带 todoId，反查任务（ORCA 的 worker 树） */
  const threadOfTurn = (t: Turn) => t.threadId || defaultThreadId;
  const workersOf = (threadId: string) => {
    const ids = new Set((snapshot?.turns || []).filter((t) => threadOfTurn(t) === threadId && t.todoId).map((t) => t.todoId as string));
    return (snapshot?.tasks || []).filter((t) => ids.has(t.id));
  };
  /** 打开某条执行（任务）：有会话就跳过去，没有就提示 */
  const openWorker = (todoId: string) => {
    const thread = (state?.threads || []).find((t) => t.todoId === todoId);
    if (thread && onOpenThread) onOpenThread(thread.id);
    else notify("这条执行还没有会话：去任务面板看");
  };
  const openChat = (id: string) => { setOpenThreadId(id); setRailTab("messages"); setChatView("chat"); setChatQuery(""); setChatHits([]); setRenderBlocks(40); };

  /** 加载更早的回合：内容挂到顶上，用 scrollHeight 差值保持当前阅读位置 */
  const loadEarlier = () => {
    const el = streamRef.current;
    const keep = el ? el.scrollHeight - el.scrollTop : 0;
    stickRef.current = false;
    setRenderBlocks((n) => n + 40);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - keep; });
  };

  // 搜索走会话内的消息（标题 + 正文），防抖 220ms，避免每敲一个字就翻库
  useEffect(() => {
    const q = chatQuery.trim();
    if (!q || !bot?.id) { setChatHits([]); return; }
    let dead = false;
    const timer = setTimeout(() => {
      void act("botChats", { botId: bot.id, query: q })
        .then((res) => { if (!dead) setChatHits(((res as { hits?: { threadId: string; snippet: string }[] } | null)?.hits) || []); })
        .catch(() => { if (!dead) setChatHits([]); });
    }, 220);
    return () => { dead = true; clearTimeout(timer); };
  }, [chatQuery, bot?.id, act]);

  const newChat = () => void run("chat", async () => {
    if (!bot) return;
    const created = (await act("botChatNew", { botId: bot.id })) as { id?: string } | null;
    if (created?.id) openChat(created.id);
  });

  const commitChatRename = () => {
    if (!renamingChat) return;
    const title = renamingChat.title.trim();
    const id = renamingChat.id;
    setRenamingChat(null);
    if (!title) return;
    void run("chat", () => act("botChatRename", { threadId: id, title }));
  };

  const removeChat = async (chat: Chat) => {
    if (!(await confirmDialog({ danger: true, title: `删除会话「${chat.title}」？`, desc: "里面的消息会一起删掉。默认会话不能删，可以清空。" }))) return;
    void run("chat", async () => {
      await act("botChatRemove", { threadId: chat.id });
      if (openThreadId === chat.id) setOpenThreadId(null);
    });
  };

  /** 清空一条会话：消息与回合一起清，会话本身留着（默认会话也能清） */
  const clearChat = async (chat: Chat) => {
    if (!(await confirmDialog({ danger: true, title: `清空会话「${chat.title}」？`, desc: "里面的消息会一起删掉；会话本身留着。" }))) return;
    void run("chat", async () => {
      await act("botChatClear", { threadId: chat.id });
      notify("会话已清空");
    });
  };

  const savePatch = async (patch: Record<string, unknown>) => {
    if (!bot) return;
    try {
      await act("botSave", { id: bot.id, expectedUpdatedAt: bot.updatedAt, ...patch });
      await load();
    } catch (err) {
      // 并发：另一个人 / 另一个页签先改了；刷新后让人重试，不悄悄覆盖
      notify(String((err as Error)?.message || err));
      await load();
    }
  };
  const savePersona = (key: keyof Persona, value: string) => savePatch({ persona: { ...(bot?.persona || {}), [key]: value } });
  const saveDuty = (key: "goal" | "scope" | "deliverable" | "forbidden" | "report", value: string) =>
    savePatch({ persona: { ...(bot?.persona || {}), duty: { ...(bot?.persona?.duty || {}), [key]: value } } });
  const savePolicy = (patch: Record<string, unknown>) => savePatch({ policy: { ...(bot?.policy || {}), ...patch } });
  const toggleSkill = (skillId: string) => {
    const current = new Set(Array.isArray(bot?.skills) ? bot.skills : []);
    if (current.has(skillId)) current.delete(skillId);
    else current.add(skillId);
    void savePatch({ skills: [...current] });
  };
  const notifyCfg = { proactive: true, needPermission: true, taskDone: true, failed: true, ...(bot?.policy?.notify || {}) };
  const standingCfg = { enabled: false, maxRunsPerHour: 1, ...(bot?.policy?.standing || {}) };
  const toggleNotify = (key: (typeof NOTIFY_ROWS)[number][0]) =>
    void savePolicy({ notify: { ...notifyCfg, [key]: !notifyCfg[key] } });
  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await act("botModels") as { id: string; name: string; hint?: string }[] | null;
      if (alive && Array.isArray(list)) setModelCatalog(list);
      const skills = await act("botSkills") as { id: string; name: string; description: string }[] | null;
      if (alive && Array.isArray(skills)) setSkillCatalog(skills);
      const hook = await act("botWebhookInfo") as { running?: boolean; port?: number } | null;
      if (alive && hook) setWebhook(hook);
    })();
    return () => { alive = false; };
  }, [act]);
  useEffect(() => {
    if (!modelMenu) return;
    const close = () => setModelMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [modelMenu]);
  const currentModelName = (() => {
    const id = String(bot?.model || "").trim();
    if (!id) return "默认模型";
    return modelCatalog.find((m) => m.id === id)?.name || id;
  })();

  /** 待处理：把「必须人点头」的东西收成一个队列（审批 / 建议 / 计划 / 提问 / 待验收）。
   *  必须在早期 return 之前算，否则 hook 数量会随渲染变化（React #310）。 */
  const needs = useMemo(() => {
    const rows: { id: string; kind: string; title: string; hint?: string; action?: "accept" | "terminal"; turnId?: string; actionLabel?: string }[] = [];
    for (const a of state?.approvals ?? []) {
      rows.push({ id: `ap-${a.id}`, kind: "审批", title: a.title || a.description || "需要授权", hint: "桌面弹窗里确认" });
    }
    const WEEK = 7 * 86400000;
    const nowMs = Date.now();
    for (const t of snapshot?.turns ?? []) {
      if (!t.proposal || t.proposal.acceptedAt || t.proposal.dismissed) continue;
      // 建议 7 天没处理就默认过期：队列要是只进不出，人就不看了
      if (nowMs - (t.createdAt || 0) > WEEK) continue;
      const title = t.proposal.title || (t.proposal.desc || "").split("\n")[0] || (t.reply || "").slice(0, 40) || "（无标题建议）";
      rows.push({ id: `pr-${t.id}`, kind: "建议", title, turnId: t.id, action: "accept", actionLabel: bot?.capability === "work" ? "开跑" : "起任务" });
    }
    for (const p of state?.missionPlans ?? []) {
      if (p.status !== "draft") continue;
      const mission = state?.todos?.find((x) => x.id === p.missionId);
      rows.push({ id: `pl-${p.id}`, kind: "计划", title: mission?.title || "Mission 计划待批", hint: `rev ${p.revision} · 批准在终端`, action: "terminal", actionLabel: "去终端" });
    }
    for (const t of state?.todos ?? []) {
      if (t.status !== "in_review") continue;
      rows.push({ id: `rv-${t.id}`, kind: "验收", title: `${t.key} ${t.title}`, action: "terminal", actionLabel: "看任务" });
    }
    for (const a of snapshot?.asks ?? []) {
      if (nowMs - (a.createdAt || 0) > WEEK) continue;
      rows.push({ id: `ak-${a.turnId}`, kind: "提问", title: a.text, hint: "直接在下面回一句" });
    }
    return rows;
  }, [state?.approvals, state?.missionPlans, state?.todos, snapshot?.turns, snapshot?.asks, bot?.capability]);

  /** 未读/待办点：提问 + 待定建议 + 到点日程（机器人列表上的小圆点） */
  const attentionOf = (id: string) => {
    const asks = (snapshot?.asks || []).filter((a) => a.botId === id).length;
    const props = (snapshot?.turns || []).filter((t) => t.botId === id && t.proposal && !t.proposal.acceptedAt && !t.proposal.dismissed).length;
    const due = (snapshot?.routineStatus || []).filter((r) => r.botId === id && r.due).length;
    return asks + props + due;
  };

  const myRoutines = useMemo(
    () => (snapshot?.routineStatus || snapshot?.routines || []).filter((r) => r.botId === bot?.id),
    [snapshot, bot?.id],
  );

  /** 新建日程：开一张行内表单（Electron 不实现 window.prompt，之前点了没反应） */
  const startRoutine = (kind: "daily" | "every" | "once" | "watch") => {
    if (!bot) return;
    setRoutineDraft({
      kind,
      name: kind === "daily" ? "早报" : kind === "every" ? "定时汇报" : kind === "once" ? "提醒" : "盯住变化",
      prompt: "",
      atHour: 9,
      minutes: 60,
      onceAt: "",
      path: "",
    });
  };

  const saveRoutineDraft = () => {
    if (!bot || !routineDraft) return;
    const name = routineDraft.name.trim();
    if (!name) { notify("先在表单里写个名字"); return; }
    if (routineDraft.kind === "watch" && !routineDraft.path.trim()) { notify("要盯哪个文件？填绝对路径"); return; }
    const patch: Record<string, unknown> = { botId: bot.id, name, kind: routineDraft.kind, prompt: routineDraft.prompt.trim() };
    if (routineDraft.kind === "daily") patch.atHour = routineDraft.atHour;
    if (routineDraft.kind === "every") patch.everyMs = Math.max(1, routineDraft.minutes) * 60_000;
    if (routineDraft.kind === "once") {
      const at = new Date(routineDraft.onceAt).getTime();
      if (!Number.isFinite(at) || at <= Date.now()) { notify("选一个未来的时间"); return; }
      patch.onceAt = at;
    }
    if (routineDraft.kind === "watch") patch.watch = { kind: "file", path: routineDraft.path.trim() };
    void run("routine", async () => {
      await act("botRoutineSave", patch);
      setRoutineDraft(null);
      notify("日程已添加");
      await load();
    });
  };

  const migrateThreads = () => void run("migrate", async () => {
    const dry = (await act("botThreadMigrate", { dryRun: true })) as { turns?: number; messages?: number } | null;
    if (!dry?.turns) { notify("没有需要迁移的历史回合"); return; }
    if (!(await confirmDialog(`将把 ${dry.turns} 条回合补成 ${dry.messages} 条会话消息，继续？`))) return;
    const done = (await act("botThreadMigrate", {})) as { messages?: number } | null;
    notify(`已迁移 ${done?.messages ?? 0} 条消息`);
    await load();
  });

  const toggleRoutine = async (routine: Routine) => {
    void run("routine", async () => {
      await act("botRoutineSave", { id: routine.id, botId: routine.botId, enabled: !routine.enabled });
      notify(routine.enabled ? "已停用" : "已启用");
    });
  };

  const removeRoutine = async (routine: Routine) => {
    if (!(await confirmDialog(`删除日程「${routine.name || routine.when}」？`))) return;
    void run("routine", async () => {
      await act("botRoutineRemove", { id: routine.id });
      notify("已删除");
    });
  };

  const clearTurns = async (decision: "silent" | "all") => {
    if (!bot) return;
    try {
      const res = (await act("botTurnsClear", { botId: bot.id, decision })) as { removed?: number } | null;
      notify(`已清理 ${res?.removed ?? 0} 条记录`);
      await load();
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  };

  const cancel = async () => {
    try {
      if (isGroup && (groupStream.length || busy === "group")) {
        // 还没吐字时 groupStream 是空的，但仍可能有成员在跑：按成员逐个 abort
        const ids = groupStream.length ? groupStream.map((s) => s.botId) : groupMembers.map((m) => m.id);
        await Promise.all(ids.map((id) => act("botCancel", { botId: id })));
        notify("已取消这次回复");
        return;
      }
      await act("botCancel", { botId: bot?.id });
      notify("已取消这次回复");
    }
    catch (err) { notify(String((err as Error)?.message || err)); }
  };

  /** 重试一轮：后端复用原话重跑，前端只负责刷新 */
  const retryTurn = async (turnId: string) => {
    setBusy("retry");
    setError("");
    try { await act("botRetry", { turnId }); await load(); }
    catch (err) { setError(String((err as Error)?.message || err)); }
    finally { setBusy(""); }
  };

  // Esc = 停止当前生成（聊天面里最常按的那个键）
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!streaming && !groupStream.length) return;
      event.preventDefault();
      void cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streaming, groupStream.length, cancel]);

  const acceptProposal = (turn: Turn) => run("proposal", async () => {
    const res = (await act("botAcceptProposal", { turnId: turn.id })) as { ok?: boolean; key?: string } | null;
    if (res?.ok) notify(`已建任务 ${res.key}（待你在桌面确认后才会起 run）`);
  });

  const dismissProposal = (turn: Turn) => run("proposal", () => act("botDismissProposal", { turnId: turn.id }));

  const acceptRoutine = (turn: Turn) => run("routine", async () => {
    const res = (await act("botAcceptRoutineProposal", { turnId: turn.id })) as { ok?: boolean; routine?: { name?: string; when?: string } } | null;
    if (res?.ok) notify(`已建日程「${res.routine?.name || "日程"}」${res.routine?.when ? ` · ${res.routine.when}` : ""}`);
  });

  const dismissRoutine = (turn: Turn) => run("routine", () => act("botDismissRoutineProposal", { turnId: turn.id }));

  const restoreRevision = (rev: { id: string; at: number }) => run("revision", async () => {
    await act("botRestoreRevision", { botId: bot?.id, revisionId: rev.id });
    notify(`已恢复到 ${relTime(rev.at)} 的版本`);
    setRevisionDiff(null);
    await load();
  });

  const showRevisionDiff = (rev: { id: string; at: number }) => run("revision", async () => {
    const rows = (await act("botRevisionDiff", { botId: bot?.id, revisionId: rev.id })) as { label: string; from: unknown; to: unknown }[] | null;
    setRevisionDiff({ id: rev.id, rows: Array.isArray(rows) ? rows : [] });
  });

  const applyTidy = () => run("tidy", async () => {
    if (!tidy?.picks?.length) return;
    const res = (await act("botMemoryTidyApply", { botId: bot?.id, ids: tidy.picks.map((p) => p.id) })) as { ok?: boolean; archived?: number; freed?: number; error?: string } | null;
    if (!res?.ok) { notify(res?.error || "没有可归档的条目"); return; }
    notify(`已归档 ${res.archived ?? 0} 条，释放约 ${res.freed ?? 0} 字符（记忆页可恢复）`);
    await load();
    await refreshTidy();
  });

  const tick = () => run("tick", async () => {
    const out = (await act("botTick", { botId: bot?.id, force: false })) as Turn[] | null;
    const created = out?.length ? out[out.length - 1] : null;
    if (!created) notify("这一轮没有记录：距上一次决策不足 5 分钟");
    else if (created.decision === "answered") notify(`${bot?.name} 说了一句`);
    else notify(`${bot?.name} 保持沉默：${created.reason || "无话可说"}`);
  });

  const togglePause = () => run("status", () => act("botStatus", { id: bot?.id, status: bot?.status === "active" ? "paused" : "active" }));
  const mute = () => run("mute", () => act("botStatus", { id: bot?.id, mutedUntil: Date.now() + 60 * 60 * 1000 }));
  const unmute = () => run("mute", () => act("botStatus", { id: bot?.id, mutedUntil: 0 }));
  /**
   * 新建 bot：**不弹 window.prompt** —— Electron 不实现它（点了不会有任何反应，Notes 也踩过这个坑）。
   * 直接建一个占位名、切到人格卡、把「名字」输入框聚焦，改完失焦即保存。
   */
  const create = () => {
    const index = (snapshot?.bots.length || 0) + 1;
    const name = `新 bot ${index}`;
    void run("create", async () => {
      const created = (await act("botSave", { name, avatar: "B" })) as Bot | null;
      if (created?.id) {
        setBotId(created.id);
        setTab("persona");
        setRenameFocus((n) => n + 1);
        notify(`已建「${name}」：在右侧改个名字和职责`);
      }
    });
  };
  const remove = async () => {
    if (!bot) return;
    const ok = await confirmDialog({ danger: true, title: `删除 bot「${bot.name}」？`, desc: "回合、会话、日程与群成员会一起删除。删除后 6 秒内可以撤销。" });
    if (!ok) return;
    void run("remove", async () => {
      await act("botRemove", { id: bot.id });
      setBotId("");
      setUndo({ label: `已删除「${bot.name}」`, run: () => act("botUndoRemove") });
    });
  };

  if (!snapshot) {
    return (
      <div className="page bot-page">
        <PageHeader title={t("page.bots")} actions={onBackToBots ? <button className="btn ghost" onClick={onBackToBots} title="回到机器人配置页" aria-label="回到机器人配置页"><ChevronLeftIcon size={14} /></button> : undefined} />
        <div className="bot-loading"><EmptyState compact title="正在读取机器人…" desc={error || "稍等一下"} /></div>
      </div>
    );
  }

  if (!snapshot.bots.length) {
    return (
      <div className="page bot-page">
        <PageHeader title={t("page.bots")} actions={onBackToBots ? <button className="btn ghost" onClick={onBackToBots} title="回到机器人配置页" aria-label="回到机器人配置页"><ChevronLeftIcon size={14} /></button> : undefined} />
        <EmptyState mark="◇" title="还没有机器人" desc="建一个机器人需要人格卡、出场策略和配额；先给个名字，其余用默认值。" action={<button className="btn primary" onClick={create}>新建机器人</button>} />
      </div>
    );
  }

  /** 配置面板本体：控制台右栏「设置」；tab 切换，不一次铺开 */
  const asideContent = (
    <>
      <div className="bot-tabs">
        {([["persona", "身份"], ["capability", "能力"], ["memory", "记忆"], ["routines", "自动化"], ["rules", "规则"]] as const).map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="bot-aside-body">
            {tab === "persona" && (
              <>
                <div className="bot-label">身份（结构化，失焦保存）</div>
                <div className="bot-field">
                  <span>角色</span>
                  <div className="bot-seg">
                    {(["supervisor", "worker"] as const).map((r) => (
                      <button key={r} className={bot?.role === r ? "on" : ""} disabled={Boolean(busy)} onClick={() => void run("role", () => act("botSave", { id: bot?.id, role: r, expectedUpdatedAt: bot?.updatedAt }))}>
                        {r === "supervisor" ? "主管" : "员工"}
                      </button>
                    ))}
                  </div>
                </div>
                <BotField
                  key={`name-${renameFocus}`}
                  label="名字"
                  value={bot?.name || ""}
                  autoFocus={renameFocus > 0}
                  onCommit={(value) => void savePatch({ name: value })}
                />
                <BotField label="团队" value={bot?.team || ""} onCommit={(value) => void savePatch({ team: value })} />
                <div className="bot-field">
                  <span>头像</span>
                  <div className="bot-avatars">
                    {["🤖", "🧭", "🛠", "📊", "🧪", "🦉", "🐝", "🧩"].map((face) => (
                      <button
                        key={face}
                        className={`bot-avatar ${bot?.avatarClass || "a"} ${bot?.avatar === face ? "on" : ""}`}
                        title={`换成 ${face}`}
                        aria-label={`头像 ${face}`}
                        aria-pressed={bot?.avatar === face}
                        onClick={() => void savePatch({ avatar: face })}
                      >
                        {face}
                      </button>
                    ))}
                  </div>
                </div>
                <BotField label="职责" value={bot?.persona?.mission || ""} onCommit={(value) => void savePersona("mission", value)} />
                {!bot?.persona?.mission && <p className="bot-note">还没告诉它要做什么。在下面输入框说一句「你负责…」，这将成为它的职责。</p>}
                <div className="bot-label" style={{ marginTop: 14 }}>职责卡</div>
                <BotField label="目标" value={bot?.persona?.duty?.goal || ""} onCommit={(value) => void saveDuty("goal", value)} />
                <BotField label="范围" value={bot?.persona?.duty?.scope || ""} onCommit={(value) => void saveDuty("scope", value)} />
                <BotField label="交付物" value={bot?.persona?.duty?.deliverable || ""} onCommit={(value) => void saveDuty("deliverable", value)} />
                <BotField label="不做什么" value={bot?.persona?.duty?.forbidden || ""} onCommit={(value) => void saveDuty("forbidden", value)} />
                <BotField label="汇报口径" value={bot?.persona?.duty?.report || ""} onCommit={(value) => void saveDuty("report", value)} />
                <BotField label="语气" value={bot?.persona?.tone || ""} onCommit={(value) => void savePersona("tone", value)} />
                <BotField label="称呼" value={bot?.persona?.address || ""} onCommit={(value) => void savePersona("address", value)} />
                <BotField label="长短" value={bot?.persona?.length || ""} onCommit={(value) => void savePersona("length", value)} />
                <BotField label="边界" value={bot?.persona?.boundary || ""} onCommit={(value) => void savePersona("boundary", value)} />
                <BotField label="习惯" value={bot?.persona?.habit || ""} onCommit={(value) => void savePersona("habit", value)} />
                <div className="bot-label" style={{ marginTop: 14 }}>历史（改坏了可恢复）</div>
                {revisions.length ? revisions.slice(0, 6).map((r) => (
                  <div className="bot-mem-row" key={r.id}>
                    <span className="mono">{relTime(r.at)}</span>
                    <span>
                      {r.name || "（未命名）"}
                      <em className="faint"> · {r.mission || "没有职责"}</em>
                    </span>
                    <button className="btn tiny" disabled={Boolean(busy)} onClick={() => void showRevisionDiff(r)}>对比</button>
                    <button className="btn tiny" disabled={Boolean(busy)} onClick={() => void restoreRevision(r)}>恢复</button>
                  </div>
                )) : <p className="bot-note">还没有历史。改名字 / 职责 / 配额时，上一版会自动存下来。</p>}
                {revisionDiff && (
                  revisionDiff.rows.length ? revisionDiff.rows.map((r) => (
                    <div className="bot-mem-row" key={`${revisionDiff.id}-${r.label}`}>
                      <span className="mono">{r.label}</span>
                      <span className="ellipsis" title={`${String(r.from || "（空）")} → ${String(r.to || "（空）")}`}>
                        {String(r.from || "（空）")} → {String(r.to || "（空）")}
                      </span>
                    </div>
                  )) : <p className="bot-note">这一版与现在没有可见差异。</p>
                )}
                <div className="row gap8" style={{ marginTop: 8 }}>
                  <button
                    className="btn tiny"
                    disabled={Boolean(busy)}
                    onClick={() => void run("botHome", async () => {
                      const res = (await act("botHomeOpen", { botId: bot?.id })) as { ok?: boolean; path?: string; error?: string } | null;
                      notify(res?.ok ? `已打开主目录：${res.path}` : (res?.error || "打不开主目录"));
                    })}
                  >
                    主目录
                  </button>
                  <span className="tiny faint">SOUL.md / MEMORY.md 都是只读镜像，手改不回写</span>
                </div>
              </>
            )}
            {tab === "memory" && (
              <>
                <div className="bot-label">可读四层（真实计数）</div>
                {(["L4", "L3", "L2", "L1"] as const).map((layer) => (
                  <div className="bot-mem-row" key={layer}>
                    <span className="mono">{layer}</span>
                    <span>
                      {{ L4: "结论", L3: "项目", L2: "事实", L1: "原始" }[layer]}
                      <em className="faint"> · {layer === "L1" ? "只回查，不注入" : "可注入"}</em>
                      <b className="mono" style={{ float: "right" }}>{memoryOverview?.byLayer?.[layer] ?? 0}</b>
                    </span>
                  </div>
                ))}
                <p className="bot-note">注入按预算裁剪；被裁掉的条目在记忆页能看到原因。可注入字符数：{memoryOverview?.injectable ?? 0}。</p>
                <div className="bot-kv">
                  <span>本轮注入</span><b>{lastInjected.length} 条</b>
                  <span>上下文</span><b>{lastContext ? `${lastContext.chars ?? 0} 字符 · 记忆 ${lastContext.memory ?? 0}${lastContext.digest ? " · 含摘要" : ""}` : "还没有记录"}</b>
                  <span>预算</span><b>{bot?.budget?.tokensPerTurn ?? 2048} tokens / 轮</b>
                </div>
                <div className="bot-label" style={{ marginTop: 14 }}>整理</div>
                {tidy?.ready ? (
                  <>
                    <p className="bot-note">
                      已用 {Math.round((tidy.ratio || 0) * 100)}%（{tidy.used}/{tidy.budget} 字符）。归档这 {tidy.picks.length} 条可释放约 {tidy.freed} 字符
                      {tidy.short ? "（候选不够，仍可能高于目标）" : ""}；归档后可在记忆页恢复。
                    </p>
                    {tidy.picks.slice(0, 5).map((p) => (
                      <div className="bot-mem-row" key={p.id}>
                        <span className="mono">{p.layer}</span>
                        <span className="ellipsis" title={p.title}>{p.title}</span>
                        <em className="faint">{p.chars} 字符</em>
                      </div>
                    ))}
                    <button className="btn tiny" disabled={Boolean(busy)} onClick={() => void applyTidy()}>归档这 {tidy.picks.length} 条</button>
                  </>
                ) : (
                  <p className="bot-note">
                    {tidy ? `占用 ${Math.round((tidy.ratio || 0) * 100)}% · ${tidy.reason || "不需要整理"}` : "正在算占用…"}
                    （到 80% 才给候选；只归档，不删除）
                  </p>
                )}
                <div className="row gap8" style={{ marginTop: 8 }}>
                  <button
                    className="btn tiny"
                    disabled={Boolean(busy)}
                    onClick={() => void run("memoryFile", async () => {
                      const res = (await act("botMemoryOpenFile", { botId: bot?.id })) as { ok?: boolean; path?: string; error?: string } | null;
                      notify(res?.ok ? `已打开 MEMORY.md` : (res?.error || res?.path || "打不开 MEMORY.md"));
                    })}
                  >
                    MEMORY.md
                  </button>
                  <span className="tiny faint">只读镜像；手改不回写，编辑在记忆页做</span>
                </div>
                <div className="bot-label" style={{ marginTop: 14 }}>最近一次注入</div>
                {lastInjected.length ? lastInjected.map((m) => (
                  <div className="bot-mem-row" key={`${m.layer}-${m.id}`}>
                    <span className="mono">{m.layer}</span>
                    <span>{m.title}</span>
                  </div>
                )) : <p className="bot-note">还没有注入记录。跑一次决策后，这里会列出真正进上下文的条目。</p>}
              </>
            )}
            {tab === "routines" && (
              <>
                <div className="bot-label">自动化（到点 / 到间隔 / 变化才跑）</div>
                {myRoutines.length
                  ? myRoutines.map((r) => (
                    <div className="bot-auto" key={r.id}>
                      <div className="bot-auto-main">
                        <b className="ellipsis">{r.name || r.when}</b>
                        <span className="tiny faint">
                          {r.when}
                          {r.mode === "in-chat" ? " · 等它空下来再跑" : " · 到点就跑"}
                          {r.due ? " · 到点了" : r.nextAt ? ` · 下次 ${hm(r.nextAt)}` : ""}
                          {r.lastFiredAt ? ` · 上次 ${hm(r.lastFiredAt)}` : " · 还没跑过"}
                        </span>
                        {r.prompt && <span className="tiny faint ellipsis" title={r.prompt}>要它做：{r.prompt}</span>}
                        {r.lastError && <span className="tiny faint">上次失败：{r.lastError}</span>}
                      </div>
                      <span className={`tag ${r.enabled ? "ok" : ""}`}>{r.enabled ? "启用" : "停用"}</span>
                      <button className="btn tiny" disabled={Boolean(busy)} onClick={() => void toggleRoutine(r)}>{r.enabled ? "停用" : "启用"}</button>
                      <button
                        className="btn tiny"
                        disabled={Boolean(busy)}
                        title="到点就跑 vs 等这个 bot 空下来再跑"
                        onClick={() => void run("routine", async () => {
                          await act("botRoutineSave", { id: r.id, botId: r.botId, mode: r.mode === "in-chat" ? "alongside" : "in-chat" });
                          notify(r.mode === "in-chat" ? "改成到点就跑" : "改成等这一轮");
                        })}
                      >
                        {r.mode === "in-chat" ? "到点就跑" : "等这一轮"}
                      </button>
                      <RowMenu title="自动化操作">
                        <button className="danger" onClick={() => void removeRoutine(r)}>删除</button>
                      </RowMenu>
                    </div>
                  ))
                  : <p className="bot-note">还没有自动化。加一条：它会在到点时自己开口，跑过的每一次都记在会话里。</p>}
                <div className="row" style={{ marginTop: 10, gap: 8 }}>
                  <button className="btn tiny" disabled={Boolean(busy)} onClick={() => startRoutine("daily")}>＋ 每天</button>
                  <button className="btn tiny" disabled={Boolean(busy)} onClick={() => startRoutine("every")}>＋ 每隔</button>
                  <button className="btn tiny" disabled={Boolean(busy)} onClick={() => startRoutine("once")}>＋ 一次</button>
                  <button className="btn tiny" disabled={Boolean(busy)} onClick={() => startRoutine("watch")}>＋ 变化才跑</button>
                </div>
                {routineDraft && (
                  <div className="bot-routine-form">
                    <label className="bot-num">
                      <span>名字</span>
                      <input
                        autoFocus
                        value={routineDraft.name}
                        onChange={(e) => setRoutineDraft({ ...routineDraft, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") saveRoutineDraft(); }}
                      />
                    </label>
                    {routineDraft.kind === "daily" && (
                      <label className="bot-num">
                        <span>每天几点</span>
                        <input
                          type="number" min={0} max={23}
                          value={routineDraft.atHour}
                          onChange={(e) => setRoutineDraft({ ...routineDraft, atHour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })}
                        />
                      </label>
                    )}
                    {routineDraft.kind === "every" && (
                      <label className="bot-num">
                        <span>每隔（分钟）</span>
                        <input
                          type="number" min={1} max={10080}
                          value={routineDraft.minutes}
                          onChange={(e) => setRoutineDraft({ ...routineDraft, minutes: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      </label>
                    )}
                    {routineDraft.kind === "once" && (
                      <label className="bot-num">
                        <span>什么时候</span>
                        <input
                          type="datetime-local"
                          value={routineDraft.onceAt}
                          onChange={(e) => setRoutineDraft({ ...routineDraft, onceAt: e.target.value })}
                        />
                      </label>
                    )}
                    {routineDraft.kind === "watch" && (
                      <label className="bot-num">
                        <span>看哪个文件（绝对路径）</span>
                        <input
                          value={routineDraft.path}
                          placeholder="~/project/dist（也可以是绝对路径）"
                          onChange={(e) => setRoutineDraft({ ...routineDraft, path: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") saveRoutineDraft(); }}
                        />
                      </label>
                    )}
                    <label className="bot-num">
                      <span>到点要它做什么</span>
                      <input
                        value={routineDraft.prompt}
                        placeholder="例如：汇总今天的待确认任务和失败运行，先结论再风险"
                        onChange={(e) => setRoutineDraft({ ...routineDraft, prompt: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") saveRoutineDraft(); }}
                      />
                    </label>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn tiny primary" disabled={Boolean(busy)} onClick={saveRoutineDraft}>保存</button>
                      <button className="btn tiny" onClick={() => setRoutineDraft(null)}>取消</button>
                    </div>
                  </div>
                )}
                <p className="bot-note">日程只决定「什么时候开口」，不会自己起 Agent 任务；要动手仍然走 Chat 派活或 dispatch 建议。</p>
                {bot?.policy?.escalate && <p className="bot-note">必须转人工：{bot.policy.escalate}</p>}
              </>
            )}
            {tab === "capability" && (
              <>
                <div className="bot-label">能力档位</div>
                <div className="bot-seg">
                  {(["read", "dispatch", "work"] as const).map((cap) => (
                    <button
                      key={cap}
                      className={bot?.capability === cap ? "on" : ""}
                      disabled={Boolean(busy)}
                      onClick={() => void run("cap", async () => {
                        await act("botSave", { id: bot?.id, capability: cap, expectedUpdatedAt: bot?.updatedAt });
                        notify(cap === "work" ? "已开启：可以直接起 run（点「开跑」即授权）" : cap === "dispatch" ? "已开启：可以提议建任务（仍需你确认）" : "已切回只读");
                      })}
                    >
                      {CAP_LABEL[cap]}
                    </button>
                  ))}
                </div>
                <div className="bot-grid2">
                  <label className="bot-num">
                    <span>默认项目</span>
                    <select className="project-filter" value={bot?.projectId || ""} onChange={(e) => void savePatch({ projectId: e.target.value })}>
                      <option value="">跟随当前项目</option>
                      {(state?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="bot-num">
                    <span>默认主机</span>
                    <select className="project-filter" value={bot?.hostId || ""} onChange={(e) => void savePatch({ hostId: e.target.value })}>
                      <option value="">执行体所在主机</option>
                      {(state?.hosts || []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="bot-field edu" style={{ marginTop: 8 }}>
                  <span>执行体（work 档位起 run 用的 Agent）</span>
                  <select
                    className="bot-exec"
                    value={bot?.executorAgentId || ""}
                    onChange={(event) => void run("exec", () => act("botSave", { id: bot?.id, executorAgentId: event.target.value, expectedUpdatedAt: bot?.updatedAt }))}
                  >
                    <option value="">未绑定</option>
                    {(snapshot.agents || [])
                      .filter((a) => a.role !== "supervisor")
                      .filter((a) => !bot?.hostId || a.hostId === bot.hostId)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}{a.alias ? ` · ${a.alias}` : ""}{a.cli ? ` · ${a.cli}` : ""}{a.hostId ? ` · ${(state?.hosts || []).find((h) => h.id === a.hostId)?.name || a.hostId}` : ""}
                        </option>
                      ))}
                  </select>
                </div>
                <p className="bot-note">
                  {bot?.capability === "work"
                    ? `能执行：执行体是 ${(snapshot.agents || []).find((a) => a.id === bot?.executorAgentId)?.name || "未绑定的 Agent"}（CLI Agent）；点「开跑」会起它能跑的 run，跑完回流一条汇报。`
                    : "可起任务 ≠ 自己动手：bot 只能提议建 todo，起 run 仍要你在桌面确认。"}
                </p>
                {(() => {
                  const execAgent = (state?.agents || []).find((a) => a.id === bot?.executorAgentId);
                  if (!execAgent) return null;
                  const botProject = (state?.projects || []).find((p) => p.id === bot?.projectId);
                  const execProject = (state?.projects || []).find((p) => p.id === execAgent.projectId);
                  const projectMismatch = botProject && execProject && botProject.id !== execProject.id;
                  const hostMismatch = Boolean(bot?.hostId && execAgent.hostId && bot.hostId !== execAgent.hostId);
                  if (!projectMismatch && !hostMismatch) return null;
                  return (
                    <div className="bot-banner fail" role="alert">
                      <i />
                      <span>
                        执行体和这个 bot 的绑定对不上：
                        {projectMismatch ? ` 执行体属于「${execProject.name}」，bot 绑的是「${botProject.name}」。` : ""}
                        {hostMismatch ? " 执行体不在 bot 绑定的主机上。" : ""}
                        工作区工具会用 bot 绑的项目根，起 run 用任务自己的 cwd。
                      </span>
                    </div>
                  );
                })()}
                <label className="bot-num" style={{ marginTop: 6 }}>
                  <span>模型</span>
                  <select className="project-filter" value={bot?.model || ""} onChange={(e) => void savePatch({ model: e.target.value })}>
                    <option value="">跟随默认（DeepSeek V4 Flash）</option>
                    {modelCatalog.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <div className="bot-field">
                  <span>思考档</span>
                  <div className="bot-seg">
                    {([["quick", "快速"], ["", "标准"], ["deep", "深入"]] as const).map(([id, label]) => (
                      <button
                        key={label}
                        className={(bot?.effort || "") === id ? "on" : ""}
                        disabled={Boolean(busy)}
                        title={id === "quick" ? "最多 4 轮工具" : id === "deep" ? "最多 12 轮工具，工具轮更低温" : "默认 8 轮工具"}
                        onClick={() => void savePatch({ effort: id })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="bot-note">思考档只改「最多查几轮 / 工具轮温度」，不改单轮 token 上限。</p>
                {/* 工具清单由主进程下发（BOT_TOOL_META），这里不再手写；档位不够的工具标出来 */}
                <div className="bot-label">工具（{bot?.capability === "read" ? "只读档" : bot?.capability === "dispatch" ? "可起任务" : "能执行"}）</div>
                {(snapshot.toolCatalog || []).map((tool) => {
                  const allowed = !tool.requiresCapability || tool.requiresCapability.includes(bot?.capability || "read");
                  const risk = tool.risk === "read" ? "只读" : tool.risk === "self" ? "只写自己的" : "写任务";
                  return (
                    <div className="bot-mem-row" key={tool.name}>
                      <span className="mono">{tool.name}</span>
                      <span>
                        {tool.label}
                        <em className="faint"> · {allowed ? risk : `${risk} · 当前档位不可用`}</em>
                      </span>
                    </div>
                  );
                })}
                <div className="bot-label" style={{ marginTop: 12 }}>通道</div>
                <div className="bot-mem-row"><span className="mono">local</span><span>桌面 Chat / Bot 页<em className="faint"> · 已连接</em></span></div>
                <div className="bot-mem-row"><span className="mono">group</span><span>群聊<em className="faint"> · {groups.length} 个群</em></span></div>
                <div className="bot-mem-row"><span className="mono">feishu</span><span>飞书<em className="faint"> · 未接入（P2，见 ARCH-im-gateway）</em></span></div>
                <div className="bot-mem-row"><span className="mono">mobile</span><span>手机端<em className="faint"> · 不适用：本仓库只有桌面端</em></span></div>
                <div className="bot-label" style={{ marginTop: 12 }}>插件</div>
                {(state?.plugins || []).length ? (state?.plugins || []).slice(0, 8).map((p) => (
                  <div className="bot-mem-row" key={p.id}>
                    <span className="mono">{p.id}</span>
                    <span>{p.manifest?.name || p.id}<em className="faint"> · v{p.version}{p.enabled ? "" : " · 已停用"}</em></span>
                  </div>
                )) : <p className="bot-note">没有已安装的插件。</p>}
                <div className="bot-label" style={{ marginTop: 12 }}>技能</div>
                {skillCatalog.length ? skillCatalog.map((sk) => {
                  const on = (bot?.skills || []).includes(sk.id);
                  return (
                    <div className="bot-mem-row" key={sk.id}>
                      <span className="mono">{sk.name}</span>
                      <span className="ellipsis" title={sk.description}>{sk.description}</span>
                      <button
                        className={`btn tiny ${on ? "primary" : ""}`}
                        role="switch"
                        aria-checked={on}
                        aria-label={`${sk.name}技能`}
                        onClick={() => toggleSkill(sk.id)}
                      >
                        {on ? "开" : "关"}
                      </button>
                    </div>
                  );
                }) : <p className="bot-note">还没有内置技能。</p>}
                <p className="bot-note">技能会进 system prompt（最多 2400 字符）；连接器只说明「它能碰到什么」：写操作一律走「提议 → 人确认」。</p>
              </>
            )}
            {tab === "rules" && (
              <>
                <div className="bot-label">谁能找它</div>
                <div className="bot-seg">
                  {([["owner", "只有我"], ["group", "群里 @ 它"], ["anyone", "群里任何人"]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      className={(bot?.policy?.whoCanAsk || "group") === key ? "on" : ""}
                      disabled={Boolean(busy)}
                      onClick={() => void savePolicy({ whoCanAsk: key })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="bot-note">
                  {(bot?.policy?.whoCanAsk || "group") === "owner"
                    ? "只在 1:1 里回应：群聊 @ 它也不回，适合私人助理。"
                    : (bot?.policy?.whoCanAsk || "group") === "anyone"
                      ? "群里没 @ 也可能开口（仍受频控和静音约束）。"
                      : "群里只有被 @ 到才回；1:1 随时能聊。"}
                </p>
                <div className="bot-kv">
                  <span>群聊</span><b>{{ owner: "不参与", group: "只回 @", anyone: "按回复模式" }[bot?.policy?.whoCanAsk || "group"]}</b>
                  <span>每小时上限</span><b>{bot?.policy?.maxTurnsPerHour ?? 6}</b>
                  <span>最小间隔</span><b>{Math.round((bot?.policy?.minGapMs ?? 120000) / 1000)}s</b>
                  <span>静音时段</span><b>{bot?.policy?.quietHours?.join("–") || "23–8"}</b>
                </div>
                <div className="bot-grid2">
                  <label className="bot-num"><span>每小时上限</span><input type="number" min={1} max={60} defaultValue={bot?.policy?.maxTurnsPerHour ?? 6} onBlur={(e) => void savePolicy({ maxTurnsPerHour: Math.max(1, Math.min(60, Number(e.target.value) || 6)) })} /></label>
                  <label className="bot-num"><span>最小间隔（秒）</span><input type="number" min={0} max={3600} defaultValue={Math.round((bot?.policy?.minGapMs ?? 120000) / 1000)} onBlur={(e) => void savePolicy({ minGapMs: Math.max(0, Math.min(3600, Number(e.target.value) || 0)) * 1000 })} /></label>
                  <label className="bot-num"><span>静音开始</span><input type="number" min={0} max={23} defaultValue={bot?.policy?.quietHours?.[0] ?? 23} onBlur={(e) => void savePolicy({ quietHours: [Math.max(0, Math.min(23, Number(e.target.value) || 0)), bot?.policy?.quietHours?.[1] ?? 8] })} /></label>
                  <label className="bot-num"><span>静音结束</span><input type="number" min={0} max={23} defaultValue={bot?.policy?.quietHours?.[1] ?? 8} onBlur={(e) => void savePolicy({ quietHours: [bot?.policy?.quietHours?.[0] ?? 23, Math.max(0, Math.min(23, Number(e.target.value) || 0))] })} /></label>
                </div>
                <BotField label="必须转桌面" value={bot?.policy?.escalate || ""} onCommit={(value) => void savePolicy({ escalate: value })} />
                <div className="bot-label" style={{ marginTop: 14 }}>沉默优先</div>
                <p className="bot-note">默认动作是不说。三条闸：打分 → 静音/频控 → 敏感过滤。任何一条不过都会记一条回合（决策 = 沉默 / 被拦），并出现在左侧流里。</p>
                <div className="bot-kv" style={{ marginTop: 8 }}>
                  <span>本小时沉默</span><b>{snapshot.recent?.silentHour ?? 0}</b>
                  <span>本小时被拦</span><b>{snapshot.recent?.blockedHour ?? 0}</b>
                </div>
                <div className="bot-label" style={{ marginTop: 14 }}>外部事件</div>
                <div className="bot-mem-row">
                  <span className="mono">GitHub PR / CI</span>
                  <span className="ellipsis">用本机 gh 只读拉；需要绑定项目并已 gh auth login</span>
                  <button
                    className={`btn tiny ${bot?.policy?.github?.enabled ? "primary" : ""}`}
                    role="switch"
                    aria-checked={Boolean(bot?.policy?.github?.enabled)}
                    aria-label="GitHub 事件"
                    onClick={() => void savePolicy({ github: { enabled: !bot?.policy?.github?.enabled } })}
                  >
                    {bot?.policy?.github?.enabled ? "开" : "关"}
                  </button>
                </div>
                <div className="bot-mem-row">
                  <span className="mono">Webhook 入站</span>
                  <span className="ellipsis">本机 127.0.0.1；外部服务 POST 一条事件</span>
                  <button
                    className={`btn tiny ${bot?.policy?.webhook?.enabled ? "primary" : ""}`}
                    role="switch"
                    aria-checked={Boolean(bot?.policy?.webhook?.enabled)}
                    aria-label="Webhook 入站"
                    onClick={() => void run("webhook", async () => {
                      const res = (await act("botWebhookEnable", { botId: bot?.id, enabled: !bot?.policy?.webhook?.enabled })) as { url?: string; error?: string } | null;
                      notify(res?.url ? `Webhook：${res.url}` : (res?.error || "Webhook 已关闭"));
                    })}
                  >
                    {bot?.policy?.webhook?.enabled ? "开" : "关"}
                  </button>
                </div>
                {bot?.policy?.webhook?.enabled && bot?.policy?.webhook?.token && (
                  <div className="bot-mem-row">
                    <span className="mono">URL</span>
                    <span className="ellipsis mono" title={`http://127.0.0.1:${webhook?.port || "…"}/hook/${bot.policy.webhook.token}`}>
                      {`http://127.0.0.1:${webhook?.port || "…"}/hook/${bot.policy.webhook.token}`}
                    </span>
                    <button
                      className="btn tiny"
                      onClick={() => void window.harness.clipboardWrite(`http://127.0.0.1:${webhook?.port || ""}/hook/${bot.policy?.webhook?.token || ""}`)}
                    >
                      复制
                    </button>
                  </div>
                )}
                <div className="bot-label" style={{ marginTop: 14 }}>无人值守</div>
                <div className="bot-mem-row">
                  <span className="mono">自己起 run</span>
                  <span className="ellipsis">work 档 + 绑定项目 + 每小时上限；越界会拒绝</span>
                  <button
                    className={`btn tiny ${standingCfg.enabled ? "primary" : ""}`}
                    role="switch"
                    aria-checked={Boolean(standingCfg.enabled)}
                    aria-label="无人值守"
                    onClick={() => void savePolicy({ standing: { ...standingCfg, enabled: !standingCfg.enabled } })}
                  >
                    {standingCfg.enabled ? "开" : "关"}
                  </button>
                </div>
                <label className="bot-num">
                  <span>每小时最多起几次</span>
                  <input
                    type="number" min={1} max={20}
                    defaultValue={standingCfg.maxRunsPerHour}
                    onBlur={(e) => void savePolicy({ standing: { ...standingCfg, maxRunsPerHour: Math.max(1, Math.min(20, Number(e.target.value) || 1)) } })}
                  />
                </label>
                <p className="bot-note">只允许启动「已建好、属于绑定项目」的任务；不开就是全部要人点「开跑」。</p>
                <div className="bot-label" style={{ marginTop: 14 }}>通知</div>
                {NOTIFY_ROWS.map(([key, label, hint]) => {
                  const on = notifyCfg[key] !== false;
                  return (
                    <div className="bot-mem-row" key={key}>
                      <span className="mono">{label}</span>
                      <span className="ellipsis">{hint}</span>
                      <button
                        className={`btn tiny ${on ? "primary" : ""}`}
                        role="switch"
                        aria-checked={on}
                        aria-label={`${label}通知`}
                        onClick={() => toggleNotify(key)}
                      >
                        {on ? "开" : "关"}
                      </button>
                    </div>
                  );
                })}
                <p className="bot-note">全局节流仍在：每小时最多 3 条、单条 180 字；未读 ≥5 时只放行「需要你决定」的类别。</p>
              </>
            )}
      </div>
    </>
  );

  return (
    <div className="page bot-page">
      <UndoBar action={undo} onDone={() => setUndo(null)} />

      {error && <div className="bot-banner fail"><i /><span>{error}</span></div>}

      <div className={`bot-grid${chatView === "trajectory" && !isGroup && openThreadId ? " trajectory-open" : ""}`}>
        <aside className="bot-side">
          <div className="bot-label">机器人</div>
          <div className="bot-search">
            <SearchIcon size={14} className="search-ico" />
            <input
              value={botQuery}
              onChange={(e) => setBotQuery(e.target.value)}
              placeholder="搜索机器人"
              aria-label="搜索机器人"
            />
            {botQuery && (
              <button className="icon-btn" title="清除" aria-label="清除搜索" onClick={() => setBotQuery("")}><XIcon size={11} /></button>
            )}
          </div>
          <div className="bot-list">
            {botMatched.empty && <div className="inline-empty">没有匹配的机器人</div>}
            {botMatched.groups.map((g) => {
              const unreadCount = groupUnreadCount[g.id] || 0;
              const unread = g.id !== botId && unreadCount > 0;
              return (
                <button key={g.id} className={`bot-item ${botId === g.id ? "on" : ""}`} onClick={() => setBotId(g.id)} title="群聊：一句话发给谁由回复模式决定">
                  <span className="bot-avatar group">群</span>
                  <span className="bot-item-main">
                    <b>{g.name}</b>
                    <span>{g.memberIds.length} 个成员 · {g.replyMode.kind === "all" ? "全体回复" : g.replyMode.kind === "bot" ? "固定成员回复" : "@ 谁谁回"}{g.replyMode.pace === "serial" ? " · 依次" : ""}</span>
                  </span>
                  {unread && <span className="bot-dot attention" title={`${unreadCount} 条新消息`} />}
                </button>
              );
            })}
            {botMatched.bots.map((item) => {
              const on = item.id === bot?.id;
              const itemMuted = Boolean(item.mutedUntil && item.mutedUntil > Date.now());
              const dot = item.status !== "active" ? "paused" : itemMuted ? "quiet" : "";
              const count = (snapshot.turns || []).filter((t) => t.botId === item.id && t.decision === "answered").length;
              const attention = attentionOf(item.id);
              return (
                <button key={item.id} className={`bot-item ${on ? "on" : ""}`} onClick={() => setBotId(item.id)}>
                  <span className={`bot-avatar ${item.avatarClass || "a"}`}>{item.avatar || item.name.slice(0, 1)}</span>
                  <span className="bot-item-main">
                    <b>{item.name}</b>
                    <span>{CAP_LABEL[item.capability || "read"]} · {count} 条已说</span>
                  </span>
                  <span className={`bot-dot ${dot} ${attention ? "attention" : ""}`} title={attention ? `${attention} 件待处理` : dot === "paused" ? "已暂停" : dot === "quiet" ? "静音中" : "运行中"} />
                </button>
              );
            })}
          </div>
          <RowMenu
            title="新建：机器人或群聊"
            className="bot-new-menu"
            triggerClassName="bot-new"
            trigger={<><PlusIcon size={13} /> 新建</>}
            align="left"
            openOnHover
          >
            <button onClick={create}>
              <span className="row-menu-title">新建机器人</span>
              <span className="row-menu-hint">人格卡 · 出场策略</span>
            </button>
            <button onClick={() => setGroupDraft({ name: `群聊 ${groups.length + 1}`, ids: members.map((b) => b.id) })}>
              <span className="row-menu-title">新建群聊</span>
              <span className="row-menu-hint">起名字、选成员</span>
            </button>
          </RowMenu>
        </aside>

        {!isGroup && chatView === "chat" && railTab === "messages" && (
          /* 消息：照搬 ORCA 的会话列表（搜索 + 新会话 + 一条会话一行） */
          <section className="bot-msg-col">
            <BotRailTabs tab={railTab} onTab={setRailTab} />
            <div className="bot-chats">
              <div className="bot-chats-head">
                <span className={`bot-avatar ${bot?.avatarClass || "a"}`}>{bot?.avatar || bot?.name.slice(0, 1)}</span>
                <div className="bot-chats-who">
                  <b>{bot?.name}</b>
                  <span>
                    {chats.length} 个会话
                    {needs.length ? ` · ${needs.length} 件待处理` : ""}
                    {muted ? " · 静音中" : bot?.status === "active" ? "" : " · 已暂停"}
                  </span>
                </div>
                <span className="spacer" />
                <RowMenu title="机器人操作">
                  <button onClick={() => setRailTab("settings")}>机器人设置</button>
                  {!isGroup && <button disabled={Boolean(busy)} onClick={togglePause}>{bot?.status === "active" ? t("bot.pause", "暂停") : t("bot.resume", "恢复")}</button>}
                  {!isGroup && <button disabled={Boolean(busy)} onClick={() => void (muted ? unmute() : mute())}>{muted ? t("bot.unmute", "取消静音") : t("bot.mute1h", "静音 1h")}</button>}
                  {!isGroup && <button disabled={Boolean(busy)} onClick={() => void tick()}>{t("bot.tick", "跑一次决策")}</button>}
                  <button onClick={() => void run("thread", async () => {
                    const res = (await act("botThread", { botId: bot?.id })) as { threadId?: string } | null;
                    if (res?.threadId) onOpenThread(res.threadId);
                    else notify("没能打开会话");
                  })}>打开默认会话</button>
                  <button onClick={create}>新建机器人</button>
                  <button onClick={() => { setTab("persona"); setRenameFocus((n) => n + 1); }}>重命名</button>
                  <button onClick={migrateThreads}>迁移历史到会话</button>
                  <button onClick={() => void clearTurns("silent")}>清空沉默 / 被拦记录</button>
                  <button className="danger" onClick={async () => { if (await confirmDialog("清空这个机器人的全部回合记录？")) void clearTurns("all"); }}>清空全部回合</button>
                  <button className="danger" onClick={remove}>删除当前机器人</button>
                  {onBackToBots && <button onClick={onBackToBots}>回到机器人配置</button>}
                </RowMenu>
                <button className="btn tiny primary" disabled={Boolean(busy)} onClick={() => void tick()} title="跑一次决策">{busy === "tick" ? "…" : "决策"}</button>
              </div>
              <div className="bot-chats-tools">
                <input
                  className="bot-chat-search"
                  value={chatQuery}
                  placeholder="搜会话或消息…"
                  onChange={(event) => setChatQuery(event.target.value)}
                  aria-label="搜索会话"
                />
                <button className="btn tiny primary" onClick={newChat} disabled={Boolean(busy)}>＋ {t("bot.newChat", "新会话")}</button>
              </div>
              {!chats.length && (
                <div className="bot-empty">
                  <EmptyState
                    compact
                    mark="◇"
                    title={chatQuery.trim() ? "没有命中" : "还没有会话"}
                    desc={chatQuery.trim() ? "换个词试试；标题和消息正文都会搜。" : "新开一个话题，或者在 Chat 里直接跟它聊——默认会话就是它的家。"}
                  />
                </div>
              )}
              <div className="bot-upnext">
                  <div className="bot-label">工作</div>
                  {needs.length === 0 && !myRoutines.some((r) => r.due) && assigned.rows.length === 0 && pendingMails.length === 0 && (
                    <p className="bot-note">没有需要你处理的。任务在任务面板，日程在「自动化」。</p>
                  )}
                  {needs.slice(0, 4).map((n) => (
                    <div className="bot-need" key={n.id}>
                      <span className="tag">{n.kind}</span>
                      <span className="bot-need-main">
                        <b className="ellipsis" title={n.title}>{n.title}</b>
                        {n.hint && <span className="tiny faint">{n.hint}</span>}
                      </span>
                      {n.action === "accept" && n.actionLabel && (
                        <button className="btn tiny" onClick={() => {
                          const t = (snapshot?.turns ?? []).find((x) => x.id === n.turnId);
                          if (t) void acceptProposal(t);
                        }}>{n.actionLabel}</button>
                      )}
                      {n.action === "terminal" && n.actionLabel && (
                        <button className="btn tiny" onClick={() => window.dispatchEvent(new CustomEvent("harness:view", { detail: "terminal" }))}>{n.actionLabel}</button>
                      )}
                    </div>
                  ))}
                  {myRoutines.filter((r) => r.due).map((r) => (
                    <button className="bot-upnext-row" key={r.id} onClick={() => composerRef.current?.focus()} title={r.prompt || r.when}>
                      <span className="tag">到点</span>
                      <b className="ellipsis">{r.name || r.when || "日程"}</b>
                      <span className="tiny faint">{r.prompt ? "看日程" : "等它开口"}</span>
                    </button>
                  ))}
                  {pendingMails.slice(0, 3).map((m) => {
                    const from = (state?.bots ?? []).find((b) => b.id === m.fromBotId)?.name || "同事";
                    return (
                      <div className="bot-mem-row" key={m.id}>
                        <span className="mono">同事</span>
                        <span className="ellipsis">
                          {from} {m.kind === "question" ? "问" : m.kind === "handoff" ? "交接" : "说"}：{m.body}
                          <span className="tiny faint"> · 等它下一轮</span>
                        </span>
                      </div>
                    );
                  })}
                  {assigned.rows.slice(0, 3).map((a) => (
                    <button className="bot-upnext-row" key={a.todo.id} onClick={() => onOpenTodo?.(a.todo.id)} title={a.todo.title}>
                      <span className="tag">任务</span>
                      <b className="ellipsis">{a.todo.key} {a.todo.title}</b>
                      <span className="tiny faint">{a.stageLabel}</span>
                    </button>
                  ))}
                </div>
              {bot?.plan?.steps?.length ? (
                <div className="bot-upnext">
                  <div className="bot-label">计划 · {bot.plan.goal || "未命名"}</div>
                  {bot.plan.steps.map((step, index) => (
                    <div className="bot-mem-row" key={`${index}-${step.text}`}>
                      <span className="mono">{step.status === "done" ? "✓" : step.status === "doing" ? "→" : step.status === "blocked" ? "!" : index + 1}</span>
                      <span className={step.status === "done" ? "faint" : ""}>{step.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="bot-upnext">
                <div className="bot-label">监视任务</div>
                <input
                  className="bot-exec"
                  value={watchQuery}
                  placeholder="搜任务编号 / 标题，选中就监视"
                  aria-label="搜索任务交给它监视"
                  onChange={(event) => setWatchQuery(event.target.value)}
                />
                {watchQuery.trim() && (() => {
                  const q = watchQuery.trim().toLowerCase();
                  const hits = (snapshot.recentTodos || [])
                    .filter((t) => `${t.key} ${t.title}`.toLowerCase().includes(q))
                    .slice(0, 6);
                  if (!hits.length) return <p className="bot-note">没有匹配的任务</p>;
                  return (
                    <div className="row gap6 wrap" style={{ margin: "6px 0" }}>
                      {hits.map((t) => (
                        <button
                          key={t.id}
                          className="btn tiny"
                          onClick={() => { void run("watch", () => act("botWatchTask", { todoId: t.id, botId: bot?.id })); setWatchQuery(""); }}
                        >
                          {t.key} · {t.title.slice(0, 24)}
                        </button>
                      ))}
                    </div>
                  );
                })()}
                {(snapshot.turns || []).filter((t) => t.botId === bot?.id && t.decision === "watching").map((t) => {
                  const todo = (snapshot.recentTodos || []).find((x) => x.id === t.todoId);
                  return (
                    <div className="bot-mem-row" key={t.id}>
                      <span className="mono">{todo?.key || "—"}</span>
                      <span>
                        {todo?.title || t.reply}
                        <button className="bot-link" onClick={() => void run("unwatch", () => act("botUnwatchTask", { todoId: t.todoId, botId: bot?.id }))}>取消监视</button>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="bot-upnext">
                <div className="bot-label">工作区</div>
                {(() => {
                  const all = (state?.botWorkspaces || []).filter((w) => w.botId === bot?.id);
                  const mine = all.filter((w) => w.status !== "released");
                  const released = all.filter((w) => w.status === "released");
                  if (!mine.length && !released.length) return <p className="bot-note">还没有交到你手上的工作区。项目右键 / 终端右键可「交给机器人」。</p>;
                  return [
                    ...(mine.length ? mine.map((w) => (
                    <div key={w.id}>
                    {wsGoalEdit?.id === w.id && (
                      <input
                        className="bot-exec"
                        autoFocus
                        value={wsGoalEdit.goal}
                        placeholder="一句话目标（可空）"
                        aria-label={`${w.title} 的目标`}
                        onChange={(e) => setWsGoalEdit({ id: w.id, goal: e.target.value })}
                        onBlur={() => {
                          const next = wsGoalEdit;
                          setWsGoalEdit(null);
                          if (next && next.goal !== (w.goal || "")) void run("ws-goal", () => act("botWorkspaceGoal", { id: w.id, goal: next.goal }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setWsGoalEdit(null);
                        }}
                      />
                    )}
                    <div className="bot-mem-row" title={`${w.path}${w.branch ? ` · ${w.branch}` : ""}`}>
                      <span className="mono">{w.kind === "project" ? "项目" : w.kind === "terminal" ? "终端" : "树"}</span>
                      <span className="ellipsis">
                        {w.title}{w.goal ? <span className="faint"> · {w.goal}</span> : null}
                        <button
                          className="bot-link"
                          onClick={() => {
                            if (w.terminalId) requestTerminalAdopt({ terminalId: w.terminalId, cwd: w.path, title: w.title });
                            else requestTerminalAt(w.path);
                            window.dispatchEvent(new CustomEvent("harness:view", { detail: "terminal" }));
                          }}
                        >打开终端</button>
                        <button className="bot-link" onClick={() => setWsGoalEdit({ id: w.id, goal: w.goal || "" })}>目标</button>
                        <button className="bot-link" onClick={() => void run("release-ws", () => act("botWorkspaceRelease", { id: w.id }))}>交回</button>
                      </span>
                    </div>
                    </div>
                  )) : []),
                    ...(released.length ? [(
                      <button key="ws-released-toggle" className="bot-upnext-row" onClick={() => setShowReleasedWs((v) => !v)} title="交回的工作区只是折叠，不删除">
                        <span className="tag">交回</span>
                        <b>{showReleasedWs ? "收起已交回" : `已交回 ${released.length}`}</b>
                        <span className="tiny faint">{showReleasedWs ? "" : "看历史"}</span>
                      </button>
                    )] : []),
                    ...(showReleasedWs ? released.map((w) => (
                      <div className="bot-mem-row" key={`rel-${w.id}`} title={w.path}>
                        <span className="mono">交回</span>
                        <span className="ellipsis faint">
                          {w.title}
                          <button
                            className="bot-link"
                            onClick={() => {
                              if (w.terminalId) requestTerminalAdopt({ terminalId: w.terminalId, cwd: w.path, title: w.title });
                              else requestTerminalAt(w.path);
                              window.dispatchEvent(new CustomEvent("harness:view", { detail: "terminal" }));
                            }}
                          >打开终端</button>
                          <button
                            className="bot-link"
                            onClick={() => void run("rehandoff-ws", () => act("botHandOffWorkspace", {
                              botId: bot?.id, projectId: w.projectId, path: w.path, title: w.title,
                              branch: w.branch, kind: w.kind, projectRoot: w.kind === "project", goal: w.goal,
                            }))}
                          >再交给它</button>
                        </span>
                      </div>
                    )) : []),
                  ];
                })()}
              </div>
              <ul className="bot-chat-list">
                {chats.map((chat) => (
                  <li key={chat.id}>
                    {renamingChat?.id === chat.id ? (
                      <div className="bot-chat-row on">
                        <input
                          className="bot-chat-search"
                          autoFocus
                          value={renamingChat.title}
                          onChange={(event) => setRenamingChat({ id: chat.id, title: event.target.value })}
                          onBlur={commitChatRename}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") { event.preventDefault(); commitChatRename(); }
                            if (event.key === "Escape") setRenamingChat(null);
                          }}
                          aria-label="会话名"
                        />
                      </div>
                    ) : (
                      <>
                      <div className={`bot-chat-row ${openThreadId === chat.id ? "on" : ""}`}>
                        {workersOf(chat.id).length > 0 ? (
                          <button
                            className="bot-twist"
                            title={expandedChat === chat.id ? "收起执行" : `展开 ${workersOf(chat.id).length} 条执行`}
                            aria-label={expandedChat === chat.id ? "收起执行" : "展开执行"}
                            aria-expanded={expandedChat === chat.id}
                            onClick={() => setExpandedChat((prev) => (prev === chat.id ? null : chat.id))}
                          >
                            <ChevronRightIcon size={14} className={expandedChat === chat.id ? "rot-90" : ""} />
                          </button>
                        ) : <span className="bot-twist" />}
                        <button className="bot-chat-row-main" onClick={() => openChat(chat.id)} title={chat.title}>
                          <b className="ellipsis">{chat.title}</b>
                          <span className="ellipsis">{snippetOf(chat.id) || chat.last || "还没有消息"}</span>
                        </button>
                        {workersOf(chat.id).length > 0 && <span className="tiny faint">{workersOf(chat.id).length} 条执行</span>}
                        <span className="tiny faint mono">{hm(chat.lastAt || chat.updatedAt)}</span>
                        <RowMenu title="会话操作">
                          <button onClick={() => setRenamingChat({ id: chat.id, title: chat.title })}>重命名</button>
                          <button onClick={() => forkChat(chat.id)}>从这里分支</button>
                          <button onClick={() => void clearChat(chat)}>清空消息</button>
                          <button className="danger" onClick={() => removeChat(chat)}>删除会话</button>
                        </RowMenu>
                      </div>
                      {expandedChat === chat.id && workersOf(chat.id).map((w) => (
                        <button key={`${chat.id}-${w.id}`} className="bot-chat-worker" onClick={() => openWorker(w.id)} title={w.title}>
                          <span className="mono tiny faint">{w.key}</span>
                          <span className="ellipsis">{w.title}</span>
                          <span className="tiny faint">{w.missionState || w.status}</span>
                        </button>
                      ))}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
        <main className="bot-main">
          {!isGroup && chatView === "chat" && railTurns.length > 1 && (
            <nav className="ds-turn-rail" aria-label="回合导航">
              {railTurns.map((t) => (
                <button
                  key={t.id}
                  className={`ds-turn-mark ${t.id === activeTurnId ? "on" : ""}${busy && t === railTurns[railTurns.length - 1] ? " running" : ""}`}
                  onClick={() => jumpToTurn(t.id)}
                  onMouseEnter={(event) => showPeek(t.id, event.currentTarget)}
                  onFocus={(event) => showPeek(t.id, event.currentTarget)}
                  onMouseLeave={() => setPeek(null)}
                  onBlur={() => setPeek(null)}
                  title={`第 ${t.index} 轮`}
                  aria-label={`跳到第 ${t.index} 轮`}
                  aria-current={t.id === activeTurnId ? "true" : undefined}
                />
              ))}
            </nav>
          )}
          {!isGroup && chatView === "chat" && peek && (() => {
            const hit = railTurns.find((t) => t.id === peek.id);
            if (!hit) return null;
            const turn = hit.turn;
            const sender = turn.decision === "replied" ? "你" : (snapshot.bots.find((b) => b.id === turn.botId)?.name || "机器人");
            const text = (turn.reply || turn.input || turn.reason || "").trim();
            return (
              <div className="ds-turn-peek" style={{ top: peek.top }} role="presentation">
                <div className="ds-turn-peek-head">
                  <b>{sender}</b>
                  <span>第 {hit.index} 轮</span>
                  <span className="spacer" />
                  <span className="mono">{hm(turn.createdAt)}</span>
                </div>
                <p className="ds-turn-peek-text">{text || "这一轮没有说话"}</p>
              </div>
            );
          })()}
          {!isGroup && !openThreadId && (
            <div className="bot-chat-tabs">
              <button className={chatView === "chat" ? "on" : ""} onClick={() => setChatView("chat")}>{t("bot.chat", "对话")}</button>
              <button className={chatView === "trajectory" ? "on" : ""} onClick={() => setChatView("trajectory")}>{t("bot.trajectory", "轨迹")}</button>
            </div>
          )}
          {(isGroup || openThreadId) ? (
          <>
          {isGroup && (
            <div className="bot-chat-bar">
              <b className="ellipsis">{groups.find((g) => g.id === botId)?.name || "群聊"}</b>
              <span className="tiny faint">{members.length} 个成员</span>
              <span className="spacer" />
            </div>
          )}
          {!isGroup && openThreadId && (
            <div className="bot-chat-bar">
              <button className="btn tiny" onClick={() => setOpenThreadId(null)} title="返回会话列表" aria-label="返回会话列表">
                <ChevronLeftIcon size={14} />
              </button>
              <b className="ellipsis">{chats.find((c) => c.id === openThreadId)?.title || "会话"}</b>
              <span className="spacer" />
              <button className="btn tiny" onClick={newChat} disabled={Boolean(busy)}>＋ {t("bot.newChat", "新会话")}</button>
              <RowMenu title="会话操作">
                <button onClick={() => { const c = chats.find((x) => x.id === openThreadId); setRenamingChat({ id: openThreadId, title: c?.title || "会话" }); setOpenThreadId(null); }}>重命名</button>
                <button onClick={() => forkChat(openThreadId)}>从这里分支</button>
                <button onClick={() => { const c = chats.find((x) => x.id === openThreadId); if (c) void clearChat(c); }}>清空消息</button>
                <button className="danger" onClick={() => { const c = chats.find((x) => x.id === openThreadId); if (c) removeChat(c); }}>删除会话</button>
              </RowMenu>
            </div>
          )}
          <div className="bot-chat-tabs">
            <button className={chatView === "chat" ? "on" : ""} onClick={() => setChatView("chat")}>{t("bot.chat", "对话")}</button>
            <button className={chatView === "trajectory" ? "on" : ""} onClick={() => setChatView("trajectory")}>{t("bot.trajectory", "轨迹")}</button>
          </div>
          {chatView === "trajectory" ? (
            <TrajectoryView records={trajectoryRecords(turns, state)} focusTurnId={trajectoryTurn} onJump={(id) => { setChatView("chat"); setTimeout(() => jumpToTurn(id), 30); }} />
          ) : (
          <>
          <div
            className="bot-stream"
            ref={streamRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label={isGroup ? "群聊记录" : "对话记录"}
            tabIndex={-1}
            onScroll={(event) => {
              const el = event.currentTarget;
              const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
              stickRef.current = gap <= FOLLOW_PX;
              if (stickRef.current && pendingCountRef.current) setPending(0);
              syncActiveTurn();
              const now = Date.now();
              if (now - lastScrollSaveRef.current > 500) { lastScrollSaveRef.current = now; saveScroll(); }
            }}
            onWheel={(event) => { if (event.deltaY < 0) stickRef.current = false; }}
            onTouchStart={() => { stickRef.current = false; }}
            onKeyDown={(event) => {
              // 键盘上翻也算读者意图：PgUp / ↑ / Home 立刻退出跟随
              if (["PageUp", "ArrowUp", "Home"].includes(event.key)) stickRef.current = false;
            }}
          >
            {!isGroup && !turns.length && (
              <div className="bot-empty">
                <EmptyState
                  compact
                  mark="◇"
                  title={openThreadId && openThreadId !== defaultThreadId ? "这个话题还没开始" : "还没有回合"}
                  desc={openThreadId && openThreadId !== defaultThreadId
                    ? "在下面说一句：它只把这段对话记在这个话题里，默认会话仍然干净。"
                    : "点右上「跑一次决策」：有值得说的事件才会开口，没有就记一条沉默。"}
                />
              </div>
            )}
            {isGroup && !groupMessages.length && !pendingOwner && (
              <div className="bot-empty">
                <EmptyState
                  compact
                  mark="◇"
                  title="群里还没人说话"
                  desc="说一句试试：@名字 只叫那个人，@everyone 让全体回；「@ 谁谁回」模式下不 @ 就没人回，只记下你的话。"
                />
              </div>
            )}
            {isGroup && hiddenGroup > 0 && (
              <button className="ds-load-earlier" onClick={loadEarlier}>
                加载更早的 {Math.min(40, hiddenGroup)} 条
              </button>
            )}
            {isGroup && visibleGroup.map((m) => (
              <GroupMessageRow
                key={m.id}
                m={m}
                senderName={botOf(m.botId ?? undefined)?.name}
                state={state}
              />
            ))}
            {/* 群聊：自己刚发的那句 + 每个正在回的成员一块（逐字长出来） */}
            {pendingCount > 0 && !stickRef.current && (
              <button className="ds-new-msg" onClick={() => { stickRef.current = true; setPending(0); const el = streamRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "instant" }); }}>
                {pendingCount} 条新消息 ↓
              </button>
            )}
            {isGroup && awaitingOwnerEcho && (
              <div className="ds-user ds-pending">
                <div className="ds-bubble">{pendingOwner?.text}</div>
                <div className="ds-actions ds-actions-user"><span className="ds-time">发送中…</span></div>
              </div>
            )}
            {isGroup && groupStream.map((s) => (
              <div className="ds-assistant ds-streaming" key={`gs-${s.botId}`} aria-live="polite">
                <div className="ds-bot-attr">
                  <b>{s.name || botOf(s.botId)?.name || "机器人"}</b>
                  <span className="ds-tag">回你</span>
                  <button className="ds-action-text" onClick={() => void cancel()}>停止</button>
                </div>
                <div className="ds-assistant-body">{s.text || "\u00a0"}<span className="ds-caret" /></div>
              </div>
            ))}
            {/* 群聊：还没吐字但已经在想的成员；每人一行，不再用「等成员回…」一个大空窗 */}
            {isGroup && Object.entries(groupPhases)
              .filter(([botId]) => !groupStream.some((s) => s.botId === botId))
              .map(([botId, p]) => (
                <div className="ds-typing" key={`gp-${botId}`} aria-live="polite">
                  <span className="ds-caret" />
                  <span>{p.name || botOf(botId)?.name || "成员"} · {p.phase === "tool" ? toolLabel(p.tool, toolMeta[p.tool || ""]) : "正在想…"}</span>
                </div>
              ))}
            {isGroup && busy === "group" && !groupStream.length && !groupPhaseCount && (
              <div className="ds-typing" aria-live="polite">
                <span className="ds-caret" />
                <span>等成员回…</span>
              </div>
            )}
            {!isGroup && hiddenRows > 0 && (
              <button className="ds-load-earlier" onClick={loadEarlier}>
                加载更早的 {Math.min(40, hiddenRows)} 个回合
              </button>
            )}
            {!isGroup && visibleRows.map((row) => {
              if (row.kind === "day") {
                return (
                  <div className="ds-divider" key={row.key}>
                    <span className="ds-divider-line" aria-hidden />
                    <span className="ds-divider-text">{row.label}</span>
                    <span className="ds-divider-line" aria-hidden />
                  </div>
                );
              }
              if (row.kind === "quiet") {
                const allSilent = row.turns.every((t) => (t.decision || "silent") === "silent");
                const noun = allSilent ? "沉默" : "没开口";
                const label = row.turns.length === 1 ? noun : `${noun} ${row.turns.length} 次`;
                const first = row.turns[0];
                const last = row.turns[row.turns.length - 1];
                const span = row.turns.length === 1 ? hm(first.createdAt) : `${hm(first.createdAt)}–${hm(last.createdAt)}`;
                return (
                  <details className="ds-process ds-quiet" key={row.key}>
                    <summary className="ds-process-head">
                      <ChevronDownIcon size={14} className="ds-process-chev" />
                      <span className="ds-process-label">{label}</span>
                      <span className="ds-sep" aria-hidden />
                      <span className="ds-process-summary mono">{span}</span>
                      <span className="ds-process-count">{row.turns.length}</span>
                    </summary>
                    <div className="ds-process-body">
                      {row.turns.map((t) => (
                        <div className="ds-quiet-row" key={t.id}>
                          <span className="ds-row-icon" aria-hidden>{GLYPH[t.decision || "silent"] || "·"}</span>
                          <span className="ds-quiet-main">
                            <b>{DECISION_LABEL[t.decision || "silent"] || t.decision}</b>
                            <span>{t.reason || "—"}</span>
                            {t.decision === "interrupted" && t.reply && <span className="ds-quiet-partial">「{t.reply}」</span>}
                            <details className="bot-why">
                              <summary>为什么</summary>
                              <div className="bot-why-body">
                                <div><span>触发源</span><b className="mono">{t.trigger?.kind || "tick"}{t.trigger?.ref ? ` · ${t.trigger.ref}` : ""}</b></div>
                                <div><span>注入记忆</span><b>{t.injected?.length ? t.injected.map((m) => `[${m.layer}] ${m.title}`).join("；") : "没有注入（沉默/被拦不组装上下文）"}</b></div>
                                <div><span>成本</span><b className="mono">{t.cost?.tokens ? `${t.cost.tokens} tokens` : "没调用模型"}</b></div>
                              </div>
                            </details>
                          </span>
                          <span className="ds-tool-time">{hm(t.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              }

              const turn = row.turn;
              // 只传决策词；摘要与耗时由 BotTrace 按结构化步骤拼（不再写死「，用时 N 秒」）
              const headLabel = turn.decision === "reported" ? "已汇报"
                : turn.decision === "asked" ? "已提问"
                  : turn.decision === "interrupted" ? "已中断"
                    : "已完成";
              const turnHeadText = headLabel;
              const bubble = (
                <>
                  <BotTrace turn={turn} state={state} label={turnHeadText} />
                  <div className="ds-assistant-body"><RichText text={turn.reply || ""} /></div>
                  {turn.decision === "asked" && (
                    <div className="ds-system-note">你回一句就会成为它的职责（人格卡 → 职责），以后随时能改。</div>
                  )}
                  {turn.proposal && !turn.proposal.dismissed && (bot?.capability === "dispatch" || bot?.capability === "work") && (
                    turn.todoId
                      ? <div className="ds-note-card">已建任务{snapshot.tasks?.find((t) => t.id === turn.todoId)?.key ? ` ${snapshot.tasks.find((t) => t.id === turn.todoId)!.key}` : ""} · 等你在桌面确认后才会起 run</div>
                      : (
                        <div className="ds-note-card">
                          <b>{turn.proposal.title}</b>
                          <p>{turn.proposal.desc.split("\n")[0]}</p>
                          <div className="ds-note-actions">
                            <button className="ds-action-text primary" disabled={Boolean(busy)} onClick={() => void acceptProposal(turn)}>{bot?.capability === "work" ? "开跑" : "起任务"}</button>
                            <button className="ds-action-text" disabled={Boolean(busy)} onClick={() => void dismissProposal(turn)}>先别</button>
                            <span>{bot?.capability === "work" ? "会立即起一次 run（点这个就是授权）" : "只建 todo，不起 run；审批仍在你手里"}</span>
                          </div>
                        </div>
                      )
                  )}
                  {turn.proposal?.dismissed && <div className="ds-system-note">建议已忽略（留在回合记录里）</div>}
                  {turn.routineProposal && !turn.routineProposal.dismissed && (
                    turn.routineId
                      ? <div className="ds-note-card">已建日程「{turn.routineProposal.name || "日程"}」· 到点只开口，不会自己起 Agent</div>
                      : (
                        <div className="ds-note-card">
                          <b>{turn.routineProposal.name}</b>
                          <p>{turn.routineProposal.when}{turn.routineProposal.prompt ? ` · ${turn.routineProposal.prompt}` : ""}</p>
                          <div className="ds-note-actions">
                            <button className="ds-action-text primary" disabled={Boolean(busy)} onClick={() => void acceptRoutine(turn)}>建日程</button>
                            <button className="ds-action-text" disabled={Boolean(busy)} onClick={() => void dismissRoutine(turn)}>先别</button>
                            <span>到点只开口；起任务仍要你确认</span>
                          </div>
                        </div>
                      )
                  )}
                  {turn.routineProposal?.dismissed && <div className="ds-system-note">日程建议已忽略</div>}
                  {turn.decision === "reported" && turn.runId && (state?.artifacts || []).filter((a) => a.runId === turn.runId).length > 0 && (
                    <div className="ds-artifacts">
                      {(state?.artifacts || []).filter((a) => a.runId === turn.runId).slice(0, 4).map((a) => (
                        <div className="ds-artifact" key={a.id} title={a.ref || a.title}>
                          <span className="ds-tag">{a.kind}</span>
                          <span className="ellipsis">{a.title || a.ref}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="ds-actions">
                    <button className="ds-action" title="复制这条回复" aria-label="复制这条回复" onClick={() => void window.harness.clipboardWrite(turn.reply || "")}><CopyIcon size={14} /></button>
                    {/* 轨迹入口放在这一轮的动作里：不是只能从页签进，且进来就定位到这一轮 */}
                    <button className="ds-action" title="看这一轮的轨迹" aria-label="看这一轮的轨迹" onClick={() => { setTrajectoryTurn(turn.id); setChatView("trajectory"); }}>
                      <ListIcon size={14} />
                    </button>
                    {turn.input && (
                      <button className="ds-action" title="重试这一轮（复用原话）" aria-label="重试这一轮" disabled={Boolean(busy)} onClick={() => void retryTurn(turn.id)}><RefreshIcon size={14} /></button>
                    )}
                    <button className="ds-action" title="引用这条继续问" aria-label="引用这条继续问" onClick={() => quote(turn.reply || "")}><QuoteIcon size={14} /></button>
                    {openThreadId && <button className="ds-action" title="复制到新会话，换个说法重开" aria-label="分支到新会话" onClick={() => forkChat(openThreadId)}><GitIcon size={14} /></button>}
                    <span className="ds-time">{hm(turn.createdAt)}</span>
                    {typeof turn.cost?.tokens === "number" && turn.cost.tokens > 0 && (
                      <span className="ds-usage">
                        {turn.cost.tokens >= 1000 ? `${(turn.cost.tokens / 1000).toFixed(1)}k` : turn.cost.tokens} tokens
                        {typeof turn.cost.ttftMs === "number" && turn.cost.ttftMs > 0 ? ` · 首字 ${(turn.cost.ttftMs / 1000).toFixed(1)}s` : ""}
                      </span>
                    )}
                  </div>
                  <details className="bot-why">
                    <summary>为什么说</summary>
                    <div className="bot-why-body">
                      <div><span>触发源</span><b className="mono">{turn.trigger?.kind || "—"}{turn.trigger?.ref ? ` · ${turn.trigger.ref}` : ""}</b></div>
                      <div>
                        <span>注入记忆</span>
                        <b>
                          {(turn.injected || []).length
                            ? (turn.injected || []).map((m) => <span className="bot-mem-chip" key={`${m.layer}-${m.id}`}><em>{m.layer}</em>{m.title}</span>)
                            : "这一轮没有注入"}
                        </b>
                      </div>
                      <div><span>成本</span><b className="mono">{turn.cost?.tokens ? `${turn.cost.tokens} tokens` : "—"}{turn.cost?.ms ? ` · ${(turn.cost.ms / 1000).toFixed(1)}s` : ""}</b></div>
                      {turn.stopReason && <div><span>停止</span><b>{turn.stopReason}</b></div>}
                      {turn.context && (
                        <div>
                          <span>上下文</span>
                          <b className="mono">
                            {turn.context.chars ?? 0} 字符 · 记忆 {turn.context.memory ?? 0}
                            {turn.context.digest ? " · 含摘要" : ""}
                            {turn.cost?.rounds ? ` · ${turn.cost.rounds} 轮` : ""}
                          </b>
                        </div>
                      )}
                    </div>
                  </details>
                </>
              );

              if (turn.decision === "replied") {
                return (
                  <div className="ds-turn" role="article" aria-label={`${bot?.name || "助手"} · ${hm(turn.createdAt)}`} data-turn-id={turn.id} key={row.key}>
                    <div className="ds-user">
                      <div className="ds-bubble">{turn.input}</div>
                      <div className="ds-actions ds-actions-user">
                        <span className="ds-time">{hm(turn.createdAt)}</span>
                        <button className="ds-action" title="复制这条消息" aria-label="复制这条消息" onClick={() => void window.harness.clipboardWrite(turn.input || "")}><CopyIcon size={14} /></button>
                      </div>
                    </div>
                    <div className="ds-assistant">
                      {bubble}
                    </div>
                  </div>
                );
              }

              return (
                <div className="ds-assistant" role="article" aria-label={`${bot?.name || "助手"} · ${hm(turn.createdAt)}`} data-turn-id={turn.id} key={row.key}>
                  {bubble}
                </div>
              );
            })}
            {!isGroup && awaitingUserEcho && (
              <div className="ds-user ds-pending">
                <div className="ds-bubble">{pendingUser?.text}</div>
                <div className="ds-actions ds-actions-user"><span className="ds-time">发送中…</span></div>
              </div>
            )}
            {!isGroup && streaming && (botOf(streaming.botId) || bot) && (
              <div className="ds-assistant ds-streaming" aria-live="polite">
                <div className="ds-bot-attr">
                  <b>{(botOf(streaming.botId) || bot)?.name}</b>
                  <span className="ds-tag">回你</span>
                  <button className="ds-action-text" onClick={() => void act("botCancel", { botId: streaming.botId })}>停止</button>
                </div>
                <div className="ds-assistant-body">
                  {streaming.text
                    ? <>{streaming.text}<span className="ds-caret" /></>
                    : <span className="ds-thinking">{streaming.phase === "tool" ? toolLabel(streaming.tool, toolMeta[streaming.tool || ""]) : "正在想…"}</span>}
                </div>
              </div>
            )}
          </div>

          {(() => {
            const asks = (snapshot.asks || []).filter((a) => a.botId === bot?.id);
            if (!asks.length) return null;
            return (
              <div className="bot-ask">
                {asks.slice(0, 2).map((a) => (
                  <div className="bot-ask-row" key={a.turnId}>
                    <span className="bot-ask-mark">?</span>
                    <span className="bot-ask-text">{a.text}</span>
                    <button className="btn tiny" onClick={() => composerRef.current?.focus()}>回答</button>
                    <button
                      className="btn tiny"
                      onClick={() => void run("ask", async () => { await act("botAskDismiss", { turnId: a.turnId }); notify("已划掉这张卡片"); })}
                    >
                      先不管
                    </button>
                  </div>
                ))}
                <span className="bot-ask-hint">直接回一句就算答了；卡片不挡聊天，挂着也能继续说别的。</span>
              </div>
            );
          })()}

          {isGroup && mentionAt && (() => {
            const q = mentionAt.query.toLowerCase();
            const hits = groupMembers.filter((m) => !q || m.name.toLowerCase().includes(q) || String(m.name).split("·")[0].trim().toLowerCase().includes(q)).slice(0, 6);
            const insert = (name: string) => {
              const handle = String(name).split("·")[0].trim();
              const head = draft.slice(0, mentionAt.at);
              const tail = draft.slice(mentionAt.at + 1 + mentionAt.query.length);
              setDraft(`${head}@${handle} ${tail}`);
              setMentionAt(null);
            };
            return (
              <div className="im-mentions">
                {hits.map((m) => (
                  <button key={m.id} className="im-mention" onClick={() => insert(m.name)} title={`${m.name}${m.persona?.mission ? ` · ${m.persona.mission}` : ""}`}>
                    <span className={`bot-avatar ${m.avatarClass || "a"}`}>{m.avatar || m.name.slice(0, 1)}</span>
                    <b>{String(m.name).split("·")[0].trim()}</b>
                    <span className="tiny faint ellipsis">
                      {m.persona?.mission || "还没写职责"}
                      {m.status !== "active" ? " · 已暂停" : m.mutedUntil && m.mutedUntil > Date.now() ? " · 静音中" : ""}
                    </span>
                  </button>
                ))}
                <button className="im-mention" onClick={() => { const head = draft.slice(0, mentionAt.at); const tail = draft.slice(mentionAt.at + 1 + mentionAt.query.length); setDraft(`${head}@everyone ${tail}`); setMentionAt(null); }}>
                  <span className="bot-avatar group">@</span><b>everyone</b><span className="tiny faint">全体成员</span>
                </button>
              </div>
            );
          })()}
          {isGroup && (
            <div className="im-target">
              <span className="im-target-k">谁回</span>
              <div className="seg">
                <button className={replyMode.kind === "mentions" ? "on" : ""} onClick={() => setReplyMode({ kind: "mentions" })} title="只有被 @ 到的成员回复；没 @ 就没人回，只记你的话">@ 谁谁回</button>
                <button className={replyMode.kind === "all" ? "on" : ""} onClick={() => setReplyMode({ kind: "all" })} title="每个成员都回一句">全体</button>
                <button className={replyMode.kind === "bot" ? "on" : ""} onClick={() => setReplyMode({ kind: "bot" })} title="固定由一个成员回复">固定</button>
              </div>
              {replyMode.kind === "bot" && (
                <select className="dispatch-agent" value={replyMode.botId} onChange={(e) => setReplyMode({ kind: "bot", botId: e.target.value })}>
                  {groupMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="bot-attach-row">
              {attachments.map((a) => (
                <span className="bot-attach" key={a.path} title={a.path}>
                  <span className="ellipsis">{a.name}</span>
                  <button
                    className="bot-attach-x"
                    title="移除附件"
                    aria-label={`移除附件 ${a.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
                  >
                    <XIcon size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="ds-composer">
            <textarea
              className="ds-composer-input"
              ref={composerRef}
              aria-label={isGroup ? "在群里说一句" : "说点什么"}
              value={draft}
              rows={1}
              placeholder={isGroup
                ? "在群里说一句；@名字 指定谁回，@everyone 全体"
                : bot?.persona?.mission
                  ? `跟 ${bot?.name || "bot"} 说点什么`
                  : `告诉 ${bot?.name || "bot"}：你负责…（第一句话会成为职责）`}
              onChange={(event) => {
                setDraft(event.target.value);
                // 群里输入 @ 时打开选择器：@ 前面必须是行首或空白，避免邮箱地址误触
                if (isGroup) {
                  const caret = event.target.selectionStart ?? event.target.value.length;
                  const before = event.target.value.slice(0, caret);
                  const at = before.lastIndexOf("@");
                  const touch = at >= 0 && (at === 0 || /\s/.test(before[at - 1]));
                  setMentionAt(touch ? { at, query: before.slice(at + 1) } : null);
                }
                const el = event.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(120, el.scrollHeight)}px`;
              }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onKeyDown={(event) => {
                // 中文输入法：候选态的回车只上屏（Chromium 会同时给 keyCode 229 与 isComposing）
                if (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key !== "Enter" || event.shiftKey) return;
                const mod = event.metaKey || event.ctrlKey;
                const enterToSend = state?.settings?.enterToSend ?? true;
                if (!enterToSend && !mod) return;
                event.preventDefault();
                void send();
              }}
            />
            <div className="ds-composer-bar">
              <div className="ds-composer-tools">
                <button className="ds-add" onClick={() => void pickAttachments()} disabled={attachments.length >= 3} title="把文本文件带进上下文" aria-label="附件"><PlusIcon size={14} /></button>
                {isGroup && <span className="ds-chip static" title="输入 @名字 指定谁回">@ 谁回</span>}
                <span className="ds-chip static">{isGroup ? "群聊" : bot?.role === "supervisor" ? "主管" : "员工"}</span>
              </div>
              <div className="ds-composer-trailing">
                {!isGroup && (
                  <button
                    className="ds-model"
                    title="这个机器人的模型"
                    aria-label="选择模型"
                    aria-haspopup="menu"
                    aria-expanded={Boolean(modelMenu)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setModelMenu((open) => (open ? null : { x: Math.max(8, r.right - 240), y: r.top - 10 }));
                    }}
                  >
                    {currentModelName}
                    <ChevronDownIcon size={11} />
                  </button>
                )}
                {streaming || groupStream.length || (isGroup && busy === "group")
                  ? <button className="ds-action-text" onClick={() => void cancel()}>停止</button>
                  : <button className="ds-send" disabled={!draft.trim() && !attachments.length} onClick={() => void send()} title="发送" aria-label="发送"><SendIcon size={16} /></button>}
              </div>
            </div>
          </div>

          {modelMenu && createPortal(
            <div
              className="ds-model-pop"
              style={{ left: modelMenu.x, top: modelMenu.y }}
              role="menu"
              aria-label="选择模型"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {modelCatalog.length === 0 && <button className="ds-model-item" disabled>没有可用模型</button>}
              {modelCatalog.map((m) => (
                <button
                  key={m.id}
                  className={`ds-model-item ${String(bot?.model || "") === m.id ? "on" : ""}`}
                  role="menuitemradio"
                  aria-checked={String(bot?.model || "") === m.id}
                  onClick={() => { setModelMenu(null); void savePatch({ model: m.id }); }}
                >
                  <b>{m.name}</b>
                  {m.hint && <span>{m.hint}</span>}
                </button>
              ))}
              <button
                className={`ds-model-item ${!bot?.model ? "on" : ""}`}
                role="menuitemradio"
                aria-checked={!bot?.model}
                onClick={() => { setModelMenu(null); void savePatch({ model: "" }); }}
              >
                <b>默认模型</b><span>跟随全局设置（当前 deepseek-v4-flash）</span>
              </button>
            </div>,
            document.body,
          )}

          </>
          )}
            </>
          ) : chatView === "trajectory" ? (
            <TrajectoryView records={[]} onJump={() => {}} />
          ) : (
            <div className="bot-chat-choose"><span>从右侧选一条消息开始</span></div>
          )}
        </main>

        {isGroup && group && (
        <aside className="bot-aside">
          <div className="bot-aside-body">
            <div className="bot-label">{t("bot.groupName", "群名")}</div>
            <input
              className="bot-exec"
              value={groupNameDraft}
              aria-label="群名"
              onChange={(e) => setGroupNameDraft(e.target.value)}
              onBlur={() => void renameGroup()}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void renameGroup(); } }}
            />
            <div className="bot-label" style={{ marginTop: 10 }}>群共识</div>
            <input
              className="bot-exec"
              value={groupMemoDraft}
              aria-label="群共识"
              placeholder="目标 / 约束 / 已定结论；所有成员都会看到"
              onChange={(e) => setGroupMemoDraft(e.target.value)}
              onBlur={() => {
                if (!group || groupMemoDraft === (group.memo || "")) return;
                void run("memo", () => act("botGroupSave", { id: group.id, memo: groupMemoDraft }));
              }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
            />
            <div className="bot-label" style={{ marginTop: 10 }}>话题</div>
            <button className={`bot-upnext-row ${groupThreadId === "" ? "on" : ""}`} onClick={() => setGroupThreadId("")} title="默认话题：这个群最早的一串消息">
              <span className="tag">默认</span>
              <b className="ellipsis">主话题</b>
              <span className="tiny faint">{groupThreadId === "" ? "当前" : (groupNews[`${group.id}:main`]?.count ? `${groupNews[`${group.id}:main`].count} 新` : "")}</span>
            </button>
            {groupThreads.map((th) => (
              threadRenaming?.id === th.id ? (
                <input
                  key={th.id}
                  className="bot-exec"
                  autoFocus
                  value={threadRenaming.title}
                  aria-label="话题名"
                  onChange={(e) => setThreadRenaming({ id: th.id, title: e.target.value })}
                  onBlur={() => void renameGroupThread()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void renameGroupThread(); }
                    if (e.key === "Escape") setThreadRenaming(null);
                  }}
                />
              ) : (
                <div className="bot-upnext-row" key={th.id}>
                  <button className="bot-chat-row-main" onClick={() => setGroupThreadId(th.id)} title={th.title}>
                    <b className="ellipsis">{th.title}</b>
                  </button>
                  <span className="tiny faint">{groupThreadId === th.id ? "当前" : (groupNews[`${group.id}:${th.id}`]?.count ? `${groupNews[`${group.id}:${th.id}`].count} 新` : "")}</span>
                  <RowMenu title="话题操作">
                    <button onClick={() => setThreadRenaming({ id: th.id, title: th.title })}>重命名</button>
                    <button className="danger" onClick={() => void removeGroupThread(th)}>删除话题</button>
                  </RowMenu>
                </div>
              )
            ))}
            <button className="btn tiny" style={{ marginTop: 6 }} disabled={Boolean(busy)} onClick={() => void newGroupThread()}>＋ 新话题</button>
            <div className="bot-label" style={{ marginTop: 10 }}>{t("bot.groupMembers", "群成员")} <em>{groupMembers.length}</em></div>
            {groupMembers.map((m) => (
              <div className="bot-group-member" key={m.id}>
                <span className={`bot-avatar ${m.avatarClass || "a"}`}>{m.avatar || m.name.slice(0, 1)}</span>
                <span className="bot-item-main">
                  <b>{m.name}</b>
                  <span>{m.persona?.mission || "还没写职责"}</span>
                </span>
                <span className="row gap4">
                  <button className="link tiny" onClick={() => setReplyMode({ kind: "bot", botId: m.id })}>只它回</button>
                  <button className="link tiny" disabled={groupMembers.length <= 1} onClick={() => void toggleGroupMember(m.id)}>移出</button>
                </span>
              </div>
            ))}
            {members.some((m) => !group.memberIds.includes(m.id)) && (
              <>
                <div className="bot-label" style={{ marginTop: 10 }}>{t("bot.groupAdd", "加成员")}</div>
                {members.filter((m) => !group.memberIds.includes(m.id)).map((m) => (
                  <div className="bot-group-member" key={m.id}>
                    <span className={`bot-avatar ${m.avatarClass || "a"}`}>{m.avatar || m.name.slice(0, 1)}</span>
                    <span className="bot-item-main"><b>{m.name}</b><span>{m.persona?.mission || "还没写职责"}</span></span>
                    <button className="link tiny" onClick={() => void toggleGroupMember(m.id)}>加入</button>
                  </div>
                ))}
              </>
            )}
            <div className="bot-label" style={{ marginTop: 10 }}>回复节奏</div>
            <div className="row gap4">
              <button className={`btn tiny ${replyMode.pace !== "serial" ? "primary" : ""}`} onClick={() => setGroupPace("parallel")} title="成员并行回复，快；同轮互相看不见">并行</button>
              <button className={`btn tiny ${replyMode.pace === "serial" ? "primary" : ""}`} onClick={() => setGroupPace("serial")} title="依次回复，后说的能看到前面刚说的，慢一些">依次</button>
            </div>
            <p className="bot-note">群聊里能看到上一轮和本轮其他人已经说的；会话与记忆仍各自独立。成员回复里 @ 到别人会唤醒对方（只跟一跳）。</p>
            <div className="row gap8" style={{ marginTop: 8 }}>
              <button
                className="btn tiny"
                disabled={Boolean(busy)}
                onClick={() => void run("groupHome", async () => {
                  const res = (await act("botGroupHomeOpen", { id: group.id })) as { ok?: boolean; path?: string; error?: string } | null;
                  notify(res?.ok ? `已打开群主目录：${res.path}` : (res?.error || "打不开群主目录"));
                })}
              >主目录</button>
              <button className="btn tiny danger" onClick={() => void deleteGroup()}>{t("bot.groupDelete", "删除群聊")}</button>
            </div>
          </div>
        </aside>
        )}
        {!isGroup && chatView === "chat" && railTab === "schedule" && (
          <aside className="bot-aside">
            <BotRailTabs tab={railTab} onTab={setRailTab} />
            <SchedulePanel state={state} act={act} onOpenThread={onOpenThread} />
          </aside>
        )}
        {!isGroup && chatView === "chat" && railTab === "settings" && (
          <aside className="bot-aside">
            <BotRailTabs tab={railTab} onTab={setRailTab} />
            {asideContent}
          </aside>
        )}
      </div>

      {groupDraft && (
        <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) setGroupDraft(null); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="新建群聊">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>新建群聊</h3>
              <button className="icon-btn" title="关闭" aria-label="关闭新建群聊" onClick={() => setGroupDraft(null)}><XIcon size={14} /></button>
            </div>
            <label>
              群名
              <input
                value={groupDraft.name}
                autoFocus
                aria-label="群名"
                placeholder="群名"
                onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") void createGroupWith(); if (e.key === "Escape") setGroupDraft(null); }}
              />
            </label>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span className="tiny faint">成员 · 已选 {groupDraft.ids.length}/{members.length}</span>
              <div className="row gap6">
                <button className="btn tiny" disabled={groupDraft.ids.length === members.length}
                  onClick={() => setGroupDraft({ ...groupDraft, ids: members.map((b) => b.id) })}>全选</button>
                <button className="btn tiny" disabled={!groupDraft.ids.length}
                  onClick={() => setGroupDraft({ ...groupDraft, ids: [] })}>清空</button>
              </div>
            </div>
            <div className="bot-list bot-group-members">
              {members.map((m) => {
                const on = groupDraft.ids.includes(m.id);
                return (
                  <button key={m.id} className={`bot-item ${on ? "on" : ""}`} aria-pressed={on} title={on ? "移出群聊" : "加入群聊"}
                    onClick={() => setGroupDraft({ ...groupDraft, ids: on ? groupDraft.ids.filter((x) => x !== m.id) : [...groupDraft.ids, m.id] })}>
                    <span className={`bot-avatar ${m.avatarClass || "a"}`}>{m.avatar || m.name.slice(0, 1)}</span>
                    <span className="bot-item-main"><b>{m.name}</b><span>{CAP_LABEL[m.capability || "read"]}</span></span>
                    {on ? <CheckSquareIcon size={14} /> : null}
                  </button>
                );
              })}
            </div>
            <div className="row gap6" style={{ justifyContent: "flex-end" }}>
              <button className="btn tiny" onClick={() => setGroupDraft(null)}>取消</button>
              <button className="btn tiny primary" disabled={!groupDraft.ids.length} onClick={() => void createGroupWith()}>建群</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/** 行内可编辑字段：失焦 / Enter 保存，避免每按一个键就写库 */
function BotField({ label, value, onCommit, autoFocus = false }: { label: string; value: string; onCommit: (value: string) => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft.trim() !== value) onCommit(draft.trim()); };
  return (
    <label className="bot-field edu">
      <span>{label}</span>
      <input
        value={draft}
        autoFocus={autoFocus}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") { event.currentTarget.blur(); } }}
      />
    </label>
  );
}
