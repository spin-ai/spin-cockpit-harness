import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { RowMenu } from "./RowMenu";
import { CopyIcon, FileTextIcon, GitIcon, LinkIcon, PencilIcon, PlusIcon, QuoteIcon, SearchIcon, SendIcon, SparkleIcon, TerminalIcon, WrenchIcon, XIcon } from "./Icons";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "./Icons";
import { useT } from "../i18n";
import { RichText } from "./TaskChat";
import { assignmentsForBot } from "../selectors/assignments";
import { requestTerminalAdopt } from "../terminal-events";
import type { State } from "../types";

type Act = (type: string, payload?: unknown) => Promise<any>;

type Persona = { mission?: string; tone?: string; address?: string; length?: string; boundary?: string; habit?: string;
  /** 职责卡：目标 / 范围 / 交付物 / 不做 / 汇报口径（进 system prompt，见 buildSystemPrompt） */
  duty?: { goal?: string; scope?: string; deliverable?: string; forbidden?: string; report?: string } };
type Routine = {
  id: string; botId: string; name?: string; kind?: "daily" | "every" | "watch";
  atHour?: number; everyMs?: number; enabled?: boolean;
  /** alongside = 到点就跑；in-chat = 等这个 bot 空下来（最多等 5 分钟） */
  mode?: "alongside" | "in-chat"; waitingSince?: number;
  watch?: { kind?: "file" | "cmd"; path?: string; cmd?: string };
  lastFiredAt?: number; lastError?: string; when?: string; nextAt?: number | null;
  due?: boolean; why?: string;
};
type Policy = { maxTurnsPerHour?: number; minGapMs?: number; quietHours?: [number, number]; escalate?: string; whoCanAsk?: "owner" | "group" | "anyone" };
type Bot = {
  id: string; name: string; avatar?: string; avatarClass?: string;
  persona?: Persona; capability?: "read" | "dispatch" | "work"; role?: "supervisor" | "worker";
  executorAgentId?: string | null; channels?: string[];
  policy?: Policy; budget?: { tokensPerTurn?: number; tokensPerHour?: number };
  status?: "active" | "paused"; mutedUntil?: number;
};
type Turn = {
  id: string; botId: string; channel?: string;
  trigger?: { kind?: string; ref?: string }; input?: string;
  injected?: { layer: string; id: string; title: string }[];
  reply?: string; decision?: "answered" | "replied" | "reported" | "silent" | "blocked" | "escalated" | "asked" | "streaming" | "interrupted" | "watching";
  todoId?: string | null;
  runId?: string | null;
  proposal?: { title: string; desc: string; dismissed?: boolean; acceptedAt?: number } | null;
  reason?: string; cost?: { tokens?: number | null; ms?: number };
  /** 这一轮用过的工具（只读）：name / args / ms / ok / preview */
  tools?: { name: string; args?: string; argsRaw?: string; result?: string; at?: number; ms?: number; ok?: boolean; rejected?: boolean; preview?: string }[];
  /** 结构化轨迹：每次模型请求（usage / TTFT 可算）+ 每次工具调用（原始参数 / 完整输出） */
  trace?: TraceEvent[];
  /** 这一轮落在哪个会话（ORCA 的 Chats）；老回合为空 = 默认会话 */
  threadId?: string | null;
  createdAt: number;
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
};

type RailTab = "messages" | "settings";

function BotRailTabs({ tab, onTab }: { tab: RailTab; onTab: (t: RailTab) => void }) {
  return (
    <div className="bot-rail-tabs">
      <button className={tab === "messages" ? "on" : ""} onClick={() => onTab("messages")}>消息</button>
      <button className={tab === "settings" ? "on" : ""} onClick={() => onTab("settings")}>设置</button>
    </div>
  );
}

type TraceRecord = {
  id: string;
  turn: number;
  turnId: string;
  kind: "user" | "assistant" | "thought" | "tool" | "terminal" | "context";
  at: number;
  ms: number;
  title: string;
  args?: string;
  result?: string;
  text?: string;
  usage?: string;
};

/** 把一轮轮回合拆成轨迹记录：输入 / 思考 / 工具 / 回复 / 终端 */
function trajectoryRecords(turns: Turn[], state?: State | null): TraceRecord[] {
  const out: TraceRecord[] = [];
  turns.forEach((turn, index) => {
    const n = index + 1;
    const base = turn.createdAt || Date.now();
    const push = (rec: Omit<TraceRecord, "turn" | "turnId">) => out.push({ ...rec, turn: n, turnId: turn.id });
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

function BotTrajectoryView({ turns, state, onJump }: { turns: Turn[]; state?: State | null; onJump: (turnId: string) => void }) {
  const [foldDuration, setFoldDuration] = useState(true);
  const [foldTurns, setFoldTurns] = useState(true);
  const [foldCalls, setFoldCalls] = useState(true);
  const [query, setQuery] = useState("");
  const records = useMemo(() => trajectoryRecords(turns, state), [turns, state]);
  const needle = query.trim().toLowerCase();
  const visible = records.filter((r) => {
    if (!needle) return true;
    return `${r.title} ${r.args || ""} ${r.result || ""} ${r.text || ""}`.toLowerCase().includes(needle);
  });
  const domain = useMemo(() => {
    if (!records.length) return { from: 0, to: 1 };
    const from = Math.min(...records.map((r) => r.at));
    const to = Math.max(...records.map((r) => r.at + Math.max(1, r.ms)));
    return { from, to: Math.max(to, from + 1) };
  }, [records]);
  const lanes: { key: string; label: string; kinds: TraceRecord["kind"][] }[] = [
    { key: "input", label: "输入", kinds: ["user"] },
    { key: "model", label: "模型", kinds: ["assistant", "thought"] },
    { key: "tools", label: "工具", kinds: ["tool", "terminal"] },
  ];
  const laneOf = (kind: TraceRecord["kind"]) => (kind === "user" || kind === "context" ? "input" : kind === "tool" || kind === "terminal" ? "tools" : "model");
  const pct = (value: number) => ((value - domain.from) / (domain.to - domain.from)) * 100;
  const currentTurn = visible[0]?.turn ?? 0;
  return (
    <div className="ds-trajectory">
      <div className="ds-tr-toolbar">
        <button className={foldDuration ? "on" : ""} onClick={() => setFoldDuration((v) => !v)} aria-pressed={foldDuration}>时长</button>
        <button className={foldTurns ? "on" : ""} onClick={() => setFoldTurns((v) => !v)} aria-pressed={foldTurns}>轮次</button>
        <button className={foldCalls ? "on" : ""} onClick={() => setFoldCalls((v) => !v)} aria-pressed={foldCalls}>调用</button>
        <button disabled title="这一版还没有子调用数据">子调用</button>
        <span className="ds-tr-spacer" />
        <input className="ds-tr-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索轨迹" aria-label="搜索轨迹" />
      </div>

      {foldDuration && (
        <div className="ds-tr-overview" aria-label="时间轴">
          <div className="ds-tr-ruler">
            <span style={{ left: "0%" }}>{hm(domain.from)}</span>
            <span style={{ left: "50%" }}>{hm((domain.from + domain.to) / 2)}</span>
            <span style={{ right: "0%" }}>{hm(domain.to)}</span>
          </div>
          {lanes.map((lane) => (
            <div className="ds-tr-lane" key={lane.key}>
              <span className="ds-tr-lane-label">{lane.label}</span>
              <div className="ds-tr-track">
                {visible.filter((r) => laneOf(r.kind) === lane.key).map((r) => (
                  <button
                    key={r.id}
                    className={`ds-tr-block k-${r.kind}`}
                    style={{ left: `${pct(r.at)}%`, width: `${Math.max(0.6, (Math.max(1, r.ms) / (domain.to - domain.from)) * 100)}%` }}
                    title={`${hm(r.at)} · ${r.title}${r.ms > 1 ? ` · ${(r.ms / 1000).toFixed(1)}s` : ""}`}
                    aria-label={`跳到第 ${r.turn} 轮`}
                    onClick={() => onJump(r.turnId)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="ds-tr-ledger">
        {visible.length === 0 && <div className="ds-tr-empty">{needle ? "没有命中" : "这个会话还没有轨迹"}</div>}
        {visible.map((r, index) => {
          const showTurn = foldTurns && (index === 0 || visible[index - 1].turn !== r.turn);
          const folded = !foldCalls && (r.kind === "tool" || r.kind === "terminal");
          if (folded) return null;
          return (
            <Fragment key={r.id}>
              {showTurn && <div className={`ds-tr-turn ${r.turn === currentTurn ? "on" : ""}`}>第 {r.turn} 轮</div>}
              <details className="ds-tr-row">
                <summary className="ds-tr-row-head">
                  <span className={`ds-tr-chip k-${r.kind}`}>{r.kind === "user" ? "用户" : r.kind === "assistant" ? "助手" : r.kind === "thought" ? "思考" : r.kind === "terminal" ? "终端" : r.kind === "context" ? "注入" : "工具"}</span>
                  <b className="ds-tr-title">{r.title}</b>
                  {r.args && <span className="ds-tr-args">{r.args}</span>}
                  {r.result && <><span className="ds-tr-arrow" aria-hidden>→</span><span className="ds-tr-result">{r.result}</span></>}
                  {!r.args && !r.result && r.text && <span className="ds-tr-result">{r.text}</span>}
                  <span className="ds-tr-meta">{hm(r.at)}{r.ms > 1 ? ` · ${(r.ms / 1000).toFixed(1)}s` : ""}{r.usage ? ` · ${r.usage}` : ""}</span>
                </summary>
                <div className="ds-tr-detail">
                  {r.text && <pre>{r.text}</pre>}
                  {r.args && <div><span>原始参数</span><pre>{r.args}</pre></div>}
                  {r.result && <div><span>输出</span><pre>{r.result}</pre></div>}
                  {r.usage && <div><span>用量</span><pre>{r.usage}</pre></div>}
                  <button className="ds-action-text" onClick={() => onJump(r.turnId)}>跳到这一轮</button>
                </div>
              </details>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
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
      return { id: m.id, kind: "thought", title: "思考", summary: head, output: String(m.content || "").trim(), at: m.createdAt };
    }
    const [title, ...tail] = head.split(/\s*·\s*|:\s*/);
    return {
      id: m.id,
      kind: "tool",
      title: m.meta?.title || title || "工具",
      summary: m.meta?.input || tail.join(" · ") || head,
      output: m.meta?.output || rest || undefined,
      at: m.createdAt,
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
      });
    }
  }
  const run = turn.runId ? state?.runs?.find((r) => r.id === turn.runId) : undefined;
  if (run?.terminalId) {
    steps.push({ id: `${run.id}-terminal`, kind: "terminal", title: "终端", summary: run.status, at: turn.createdAt });
  }
  return steps;
}

function ToolCard({ step }: { step: TraceStep }) {
  const name = `${step.title} ${step.summary || ""}`.toLowerCase();
  const out = step.output || "";
  const body = (inner: React.ReactNode) => <div className="ds-card-body">{inner}</div>;
  const head = (icon: React.ReactNode, title: string, summary?: string, extra?: React.ReactNode) => (
    <>
      <span className="ds-row-icon" aria-hidden>{icon}</span>
      <span className="ds-tool-title">{title}</span>
      {summary && <><span className="ds-sep" aria-hidden /><span className="ds-tool-summary">{summary}</span></>}
      {extra}
      <ChevronDownIcon size={14} className="ds-tool-chev" />
    </>
  );

  if (/bash|shell|terminal|exec|run|command/.test(name)) {
    return (
      <details className="ds-tool-card">
        <summary className="ds-tool-main">{head(<TerminalIcon size={14} />, "终端", step.summary || "命令")}</summary>
        {body(
          <>
            <div className="ds-term-cmd">$ {step.summary || ""}</div>
            {out && <pre className="ds-term-out">{out}</pre>}
          </>,
        )}
      </details>
    );
  }
  if (/edit|write|patch|replace|apply|create/.test(name)) {
    const lines = out.split("\n");
    const added = lines.filter((x) => x.startsWith("+") && !x.startsWith("+++")).length;
    const removed = lines.filter((x) => x.startsWith("-") && !x.startsWith("---")).length;
    return (
      <details className="ds-tool-card">
        <summary className="ds-tool-main">{head(<PencilIcon size={14} />, "编辑", step.summary, <span className="ds-stat"><em>+{added}</em> <i>-{removed}</i></span>)}</summary>
        {body(
          <pre className="ds-diff">{lines.map((line, i) => (
            <span key={i} className={line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : ""}>{line}{"\n"}</span>
          ))}</pre>,
        )}
      </details>
    );
  }
  if (/read|cat|open|file|view/.test(name)) {
    const lineCount = out ? out.split("\n").length : 0;
    return (
      <details className="ds-tool-card">
        <summary className="ds-tool-main">{head(<FileTextIcon size={14} />, "读取", step.summary, lineCount ? <span className="ds-stat">{lineCount} 行</span> : null)}</summary>
        {body(<pre className="ds-card-pre">{out || "（没有内容）"}</pre>)}
      </details>
    );
  }
  if (/search|grep|glob|find|query/.test(name)) {
    const hits = out ? out.split("\n").filter(Boolean).length : 0;
    return (
      <details className="ds-tool-card">
        <summary className="ds-tool-main">{head(<SearchIcon size={14} />, "搜索", step.summary, hits ? <span className="ds-stat">{hits} 处</span> : null)}</summary>
        {body(<pre className="ds-card-pre">{out || "没有命中"}</pre>)}
      </details>
    );
  }
  if (/web|fetch|http|url|browse/.test(name)) {
    return (
      <details className="ds-tool-card">
        <summary className="ds-tool-main">{head(<LinkIcon size={14} />, "网页", step.summary)}</summary>
        {body(<pre className="ds-card-pre">{out || "没有返回内容"}</pre>)}
      </details>
    );
  }
  return (
    <details className="ds-tool-card">
      <summary className="ds-tool-main">{head(<WrenchIcon size={14} />, step.title, step.summary)}</summary>
      {body(
        <div className="ds-io-card">
          {step.summary && <div className="ds-io-row"><span>输入</span><pre>{step.summary}</pre></div>}
          {out && <div className="ds-io-row"><span>输出</span><pre>{out}</pre></div>}
        </div>,
      )}
    </details>
  );
}

function BotTrace({ turn, state, label }: { turn: Turn; state?: State | null; label: string }) {
  const steps = traceStepsOf(turn, state);
  const run = turn.runId ? state?.runs?.find((r) => r.id === turn.runId) : undefined;
  if (!steps.length) return <div className="ds-turn-head"><span>{label}</span></div>;
  return (
    <details className="ds-process ds-trace">
      <summary className="ds-process-head">
        <span className="ds-process-label">{label}</span>
        <ChevronDownIcon size={14} className="ds-process-chev" />
      </summary>
      <div className="ds-process-body">
        {steps.map((step) => {
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
          return <ToolCard step={step} key={step.id} />;
        })}
      </div>
    </details>
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
        轨迹 <em>{trace.length}</em>
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
  agents?: { id: string; name: string; alias: string; cli: string; role: string }[];
  tasks?: { id: string; key: string; title: string; status: string; missionState: string | null; agentId: string | null }[];
  recentTodos?: { id: string; key: string; title: string; status: string; missionState: string | null }[];
};

const DECISION_LABEL: Record<string, string> = { answered: "主动", reported: "汇报", watching: "监视中", asked: "先问一句", streaming: "生成中", interrupted: "被打断", silent: "沉默", blocked: "被拦", escalated: "转人工" };
const GLYPH: Record<string, string> = { asked: "?", streaming: "…", interrupted: "⏸", silent: "·", blocked: "✕", escalated: "↗" };
const CAP_LABEL: Record<string, string> = { read: "只读", dispatch: "可起任务", work: "能执行" };
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
 * 人格 bot 控制台（P0）
 *
 * 左：bot 列表（人格 / 状态 / 本小时条数）——不是会话列表。
 * 中：回合流。说过的话是气泡；沉默 / 被拦 / 转人工是细行，且都能展开「为什么」。
 * 右：人格卡 / 记忆注入 / 出场策略。
 *
 * P0 只读能力：tick 只回答与记录，不建 todo、不起 run；dispatch 见 ARCH-bot §9。
 */
export function BotConsole({ act, notify, onOpenMemory, onOpenThread, state, initialBotId = null, onBackToBots, settingsOnly = false, onClose }: {
  act: Act;
  notify: (message: string) => void;
  onOpenMemory: () => void;
  onOpenThread: (threadId: string) => void;
  /** 任务投影需要它；缺省时「分配到的任务」区块只显示未绑定提示 */
  state?: State | null;
  /** 从机器人配置页「打开会话」进来时直接选它 */
  initialBotId?: string | null;
  /** 回机器人配置页 */
  onBackToBots?: () => void;
  /** 只渲染配置面板（工作区右侧抽屉），不渲染页面头 / bot 列表 / 会话 */
  settingsOnly?: boolean;
  onClose?: () => void;
}) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [memoryOverview, setMemoryOverview] = useState<{ byLayer?: Record<string, number>; notes?: number; injectable?: number } | null>(null);
  const [botId, setBotId] = useState("");
  const [tab, setTab] = useState<"persona" | "memory" | "tasks" | "routines" | "policy" | "needs" | "connectors">("persona");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // 「分配到的任务」：Bot.executorAgentId → Agent，任务来自 state.todos（与场景同一投影）
  const botEntity = snapshot?.bots.find((b) => b.id === botId);
  const assigned = useMemo(
    () => assignmentsForBot(state?.todos ?? [], state?.delegations, { executorAgentId: botEntity?.executorAgentId ?? null }),
    [state?.todos, state?.delegations, botEntity?.executorAgentId],
  );
  const [draft, setDraft] = useState("");
  /** 会话（ORCA 的 Chats）：null = 看列表，有值 = 在那条会话里 */
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  /** 右栏：消息（会话列表）或设置（人格 / 日程 / 配额） */
  const [railTab, setRailTab] = useState<"messages" | "settings">("messages");
  /** 中栏：对话 / 轨迹 */
  const [chatView, setChatView] = useState<"chat" | "trajectory">("chat");
  const [chatQuery, setChatQuery] = useState("");
  const [chatHits, setChatHits] = useState<{ threadId: string; snippet: string }[]>([]);
  /** 行内重命名会话（Electron 不实现 window.prompt） */
  const [renamingChat, setRenamingChat] = useState<{ id: string; title: string } | null>(null);
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
    kind: "daily" | "every" | "watch"; name: string; atHour: number; minutes: number; path: string;
  } | null>(null);
  const [streaming, setStreaming] = useState<{ botId: string; text: string } | null>(null);
  /** 回合流自己滚：贴底时跟着新内容走，用户主动往上翻就不抢 */
  const streamRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  const turnCount = snapshot?.turns?.length ?? 0;
  const streamText = streaming?.text?.length ?? 0;
  // 换 bot = 换一条时间线：重新贴底
  /** 「交给机器人」从别的页面指过来：跟着 initialBotId 切人，而不是只在首次挂载时生效 */
  useEffect(() => {
    if (initialBotId) setBotId(initialBotId);
  }, [initialBotId]);

  useEffect(() => { stickRef.current = true; setOpenThreadId(null); setRailTab("messages"); setChatQuery(""); setChatHits([]); }, [botId]);
  useEffect(() => {
    const el = streamRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [turnCount, streamText, botId, openThreadId]);

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

  // 流式增量：主进程推 delta，这里只做追加；结束时用 botChat 的返回值落库并刷新
  useEffect(() => {
    const off = window.harness.onBotDelta((payload) => {
      if (!payload?.delta) return;
      setStreaming((prev) => (prev && prev.botId === payload.botId
        ? { botId: payload.botId, text: prev.text + payload.delta }
        : { botId: payload.botId, text: payload.delta }));
    });
    return off;
  }, []);

  const groups = state?.botGroups ?? [];
  const group = groups.find((g) => g.id === botId) ?? null;
  const isGroup = Boolean(group);
  const groupMessages = useMemo(
    () => (state?.botGroupMessages ?? []).filter((m) => m.groupId === group?.id).sort((a, b) => a.seq - b.seq),
    [state?.botGroupMessages, group?.id],
  );
  const bot = useMemo(() => (isGroup ? null : snapshot?.bots.find((b) => b.id === botId) ?? snapshot?.bots[0] ?? null), [snapshot, botId, isGroup]);
  const members = snapshot?.bots ?? [];
  const botOf = useCallback((id?: string) => members.find((b) => b.id === id) ?? null, [members]);
  /** 默认会话 = 老回合与主动开口的落点；新开的会话只装自己的回合 */
  const defaultThreadId = (bot?.id ? snapshot?.botThreads?.[bot.id] : null) || null;
  const turns = useMemo(() => {
    const all = [...(snapshot?.turns || [])].sort((a, b) => a.createdAt - b.createdAt);
    if (isGroup) return all;
    const mine = all.filter((t) => t.botId === bot?.id);
    if (!openThreadId) return mine;
    return mine.filter((t) => (t.threadId ?? defaultThreadId) === openThreadId);
  }, [snapshot, bot?.id, isGroup, openThreadId, defaultThreadId]);
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
  const syncActiveTurn = useCallback(() => {
    const root = streamRef.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-turn-id]"));
    if (!nodes.length) { setActiveTurnId(""); return; }
    const rootTop = root.getBoundingClientRect().top;
    let currentId = nodes[0].dataset.turnId || "";
    for (const node of nodes) {
      if (node.getBoundingClientRect().top - rootTop <= 32) currentId = node.dataset.turnId || currentId;
    }
    setActiveTurnId(currentId);
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
  const setReplyMode = (mode: { kind: "bot" | "all" | "mentions"; botId?: string }) => {
    if (!group) return;
    void act("botGroupSave", { id: group.id, replyMode: mode.kind === "bot" ? { kind: "bot", botId: mode.botId || groupMembers[0]?.id || "" } : { kind: mode.kind } });
  };
  const createGroup = async () => {
    const res = (await act("botGroupSave", { name: "项目群", memberIds: members.map((m) => m.id), replyMode: { kind: "mentions" } })) as { id?: string } | null;
    if (res?.id) setBotId(res.id);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    if (isGroup && group) {
      setDraft("");
      setError("");
      setBusy("group");
      try {
        const res = await act("botGroupSend", { id: group.id, text }) as { messages?: unknown[] } | null;
        if (!res) { setDraft(text); return; }
        await load();
      } catch (err) {
        setError(String((err as Error)?.message || err));
        setDraft(text);
      } finally {
        setBusy("");
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
    setStreaming({ botId: sendTo, text: "" });
    try {
      const res = await window.harness.action("botChat", { botId: sendTo, text: withFiles, threadId: openThreadId ?? undefined }) as { ok?: boolean; result?: unknown; error?: string } | null;
      if (!res?.ok) throw new Error(String(res?.error || "没有返回结果"));
      await load();
    } catch (err) {
      const message = String((err as Error)?.message || err);
      if (/abort/i.test(message)) notify("已取消这次回复");
      else { setError(message); setDraft(text); }
    } finally {
      setStreaming(null);
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
  const openChat = (id: string) => { setOpenThreadId(id); setRailTab("messages"); setChatView("chat"); setChatQuery(""); setChatHits([]); };

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

  const removeChat = (chat: Chat) => {
    if (!window.confirm(`删除会话「${chat.title}」？里面的消息会一起删掉。`)) return;
    void run("chat", async () => {
      await act("botChatRemove", { threadId: chat.id });
      if (openThreadId === chat.id) setOpenThreadId(null);
    });
  };

  const savePatch = async (patch: Record<string, unknown>) => {
    if (!bot) return;
    try { await act("botSave", { id: bot.id, ...patch }); await load(); }
    catch (err) { notify(String((err as Error)?.message || err)); }
  };
  const savePersona = (key: keyof Persona, value: string) => savePatch({ persona: { ...(bot?.persona || {}), [key]: value } });
  const saveDuty = (key: "goal" | "scope" | "deliverable" | "forbidden" | "report", value: string) =>
    savePatch({ persona: { ...(bot?.persona || {}), duty: { ...(bot?.persona?.duty || {}), [key]: value } } });
  const savePolicy = (patch: Record<string, unknown>) => savePatch({ policy: { ...(bot?.policy || {}), ...patch } });

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

  /** 已处理（接受 / 忽略）的条数：让队列知道自己在清空 */
  const needsDone = useMemo(
    () => (snapshot?.turns ?? []).filter((t) => t.proposal && (t.proposal.acceptedAt || t.proposal.dismissed)
      && Date.now() - (t.createdAt || 0) <= 7 * 86400000).length,
    [snapshot?.turns],
  );

  const myRoutines = useMemo(
    () => (snapshot?.routineStatus || snapshot?.routines || []).filter((r) => r.botId === bot?.id),
    [snapshot, bot?.id],
  );
  /** 接下来（ORCA 的 Up next）：提问 / 待定建议 / 到点的日程，进页面就能看见 */
  const upNext = useMemo(() => {
    const rows: { id: string; label: string; title: string; hint?: string; threadId?: string | null }[] = [];
    for (const a of snapshot?.asks || []) {
      if (a.botId !== bot?.id) continue;
      const turn = (snapshot?.turns || []).find((t) => t.id === a.turnId);
      rows.push({ id: `ask-${a.turnId}`, label: "提问", title: a.text, hint: "回一句就算答了", threadId: turn ? (turn.threadId || defaultThreadId) : null });
    }
    for (const t of snapshot?.turns || []) {
      if (t.botId !== bot?.id || !t.proposal || t.proposal.acceptedAt || t.proposal.dismissed) continue;
      rows.push({ id: `pr-${t.id}`, label: "建议", title: t.proposal.title || "待确认的建议", hint: "起任务 / 先别", threadId: t.threadId || defaultThreadId });
    }
    for (const r of myRoutines.filter((x) => x.due)) {
      rows.push({ id: `rt-${r.id}`, label: "到点", title: r.name || r.when || "日程", hint: r.mode === "in-chat" ? "等它空下来再跑" : "到点就跑" });
    }
    return rows;
  }, [snapshot?.asks, snapshot?.turns, myRoutines, bot?.id, defaultThreadId]);

  /** 新建日程：开一张行内表单（Electron 不实现 window.prompt，之前点了没反应） */
  const startRoutine = (kind: "daily" | "every" | "watch") => {
    if (!bot) return;
    setRoutineDraft({
      kind,
      name: kind === "daily" ? "早报" : kind === "every" ? "定时汇报" : "盯住变化",
      atHour: 9,
      minutes: 60,
      path: "",
    });
  };

  const saveRoutineDraft = () => {
    if (!bot || !routineDraft) return;
    const name = routineDraft.name.trim();
    if (!name) { notify("先在表单里写个名字"); return; }
    if (routineDraft.kind === "watch" && !routineDraft.path.trim()) { notify("要盯哪个文件？填绝对路径"); return; }
    const patch: Record<string, unknown> = { botId: bot.id, name, kind: routineDraft.kind };
    if (routineDraft.kind === "daily") patch.atHour = routineDraft.atHour;
    if (routineDraft.kind === "every") patch.everyMs = Math.max(1, routineDraft.minutes) * 60_000;
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
    if (!window.confirm(`将把 ${dry.turns} 条回合补成 ${dry.messages} 条会话消息，继续？`)) return;
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
    if (!window.confirm(`删除日程「${routine.name || routine.when}」？`)) return;
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
    try { await act("botCancel", { botId: bot?.id }); notify("已取消这次回复"); }
    catch (err) { notify(String((err as Error)?.message || err)); }
  };

  const acceptProposal = (turn: Turn) => run("proposal", async () => {
    const res = (await act("botAcceptProposal", { turnId: turn.id })) as { ok?: boolean; key?: string } | null;
    if (res?.ok) notify(`已建任务 ${res.key}（待你在桌面确认后才会起 run）`);
  });

  const dismissProposal = (turn: Turn) => run("proposal", () => act("botDismissProposal", { turnId: turn.id }));

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
  const remove = () => {
    if (!bot) return;
    if (!window.confirm(`删除 bot「${bot.name}」？它的回合记录会一起删掉。`)) return;
    void run("remove", async () => { await act("botRemove", { id: bot.id }); setBotId(""); });
  };

  if (!snapshot) {
    if (settingsOnly) return <div className="bot-settings"><div className="bot-settings-loading">读取中…</div></div>;
    return (
      <div className="page bot-page">
        <PageHeader title={t("page.bots")} actions={onBackToBots ? <button className="btn ghost" onClick={onBackToBots} title="回到机器人配置页" aria-label="回到机器人配置页"><ChevronLeftIcon size={13} /></button> : undefined} />
        <div className="bot-loading"><EmptyState compact title="正在读取机器人…" desc={error || "稍等一下"} /></div>
      </div>
    );
  }

  if (!snapshot.bots.length) {
    if (settingsOnly) return <div className="bot-settings"><div className="bot-settings-loading">还没有机器人</div></div>;
    return (
      <div className="page bot-page">
        <PageHeader title={t("page.bots")} actions={onBackToBots ? <button className="btn ghost" onClick={onBackToBots} title="回到机器人配置页" aria-label="回到机器人配置页"><ChevronLeftIcon size={13} /></button> : undefined} />
        <EmptyState mark="◇" title="还没有机器人" desc="建一个机器人需要人格卡、出场策略和配额；先给个名字，其余用默认值。" action={<button className="btn primary" onClick={create}>新建机器人</button>} />
      </div>
    );
  }

  /** 配置面板本体：控制台右栏与工作区右侧抽屉共用 */
  const asideContent = (
    <>
          <div className="bot-tabs">
            {([["needs", "待处理"], ["persona", "人格卡"], ["memory", "记忆"], ["tasks", "任务"], ["routines", "自动化"], ["connectors", "工具与通道"], ["policy", "出场规则"]] as const).map(([id, label]) => (
              <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {/* 分配到的任务：与场景、任务面板同一投影（src/selectors/assignments.ts）。
              P0 只读——点行只做定位提示，真正派活仍走 Chat + 人工审批。 */}
          <div className="bot-assign">
            <div className="bot-label">
              分配到的任务
              {assigned.rows.length > 0 && <span className="bot-assign-count">{assigned.rows.length}</span>}
            </div>
            {!botEntity?.executorAgentId ? (
              <p className="bot-note">
                这个机器人还没绑定执行体（<code>executorAgentId</code>）。Mission 派给 Agent 的任务，
                只有绑定了执行体才会出现在这里和场景里。
              </p>
            ) : assigned.rows.length === 0 ? (
              <p className="bot-note">当前没有分给它的未完成任务。</p>
            ) : (
              <ul className="bot-assign-list">
                {assigned.rows.slice(0, 6).map((a) => (
                  <li key={a.todo.id} className={`bot-assign-row st-${a.stage}`} title={a.todo.title}>
                    <span className="k mono">{a.todo.key}</span>
                    <span className="t ellipsis">{a.todo.title}</span>
                    <span className="s">{a.stageLabel}</span>
                  </li>
                ))}
              </ul>
            )}
            {assigned.rows.length > 6 && (
              <p className="bot-note">还有 {assigned.rows.length - 6} 条，去任务面板看全部。</p>
            )}
            {botEntity?.executorAgentId && assigned.rows.some((a) => a.mission) && (
              <p className="bot-note">
                来自 Mission：{Array.from(new Set(assigned.rows.filter((a) => a.mission).map((a) => a.mission!.key))).join("、")}
              </p>
            )}
          </div>
          <div className="bot-aside-body">
            {tab === "needs" && (
              <div className="bot-assign">
                <div className="bot-label">待处理 <em>{needs.length}</em></div>
                {needs.length === 0 && <p className="bot-note">没有需要你点头的事。审批、建议、待验收的都会出现在这里。</p>}
                {needs.length > 0 && (
                  <div className="bot-note" style={{ marginBottom: 6 }}>
                    超过 7 天没处理的建议会自动离开队列{needsDone ? ` · 近 7 天已处理 ${needsDone} 条` : ""}
                  </div>
                )}
                {needs.map((n) => (
                  <div className="bot-need" key={n.id}>
                    <span className="tag">{n.kind}</span>
                    <span className="bot-need-main">
                      <b className="ellipsis" title={n.title}>{n.title}</b>
                      {n.hint && <span className="tiny faint">{n.hint}</span>}
                    </span>
                    {n.action === "accept" && n.actionLabel && (
                      <button className="btn tiny-btn" onClick={() => { const t = (snapshot?.turns ?? []).find((x) => x.id === n.turnId); if (t) void acceptProposal(t); }}>{n.actionLabel}</button>
                    )}
                    {n.action === "terminal" && n.actionLabel && (
                      <button className="btn tiny-btn" onClick={() => window.dispatchEvent(new CustomEvent("harness:view", { detail: "terminal" }))}>{n.actionLabel}</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab === "persona" && (
              <>
                <div className="bot-label">人格卡（结构化，失焦保存）</div>
                <div className="bot-field">
                  <span>角色</span>
                  <div className="bot-seg">
                    {(["supervisor", "worker"] as const).map((r) => (
                      <button key={r} className={bot?.role === r ? "on" : ""} disabled={Boolean(busy)} onClick={() => void run("role", () => act("botSave", { id: bot?.id, role: r }))}>
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
                <div className="bot-label" style={{ marginTop: 14 }}>配额</div>
                <div className="bot-kv">
                  <span>本小时已说</span><b>{answered.filter((t) => Date.now() - t.createdAt < 3600_000).length} / {bot?.policy?.maxTurnsPerHour ?? 6}</b>
                  <span>最小间隔</span><b>{Math.round((bot?.policy?.minGapMs ?? 120000) / 1000)}s</b>
                  <span>能力</span><b>{CAP_LABEL[bot?.capability || "read"]}</b>
                  <span>频道</span><b>{(bot?.channels || ["local"]).join(" · ")}</b>
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
                  <span>预算</span><b>{bot?.budget?.tokensPerTurn ?? 700} tokens / 轮</b>
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
            {tab === "connectors" && (
              <>
                <div className="bot-label">只读工具（{bot?.capability === "read" ? "只读档未开启" : "已连接"}）</div>
                {([["memory_search", "记忆"], ["knowledge_search", "资料库"], ["todo_list", "任务"], ["run_status", "运行"]] as const).map(([id, label]) => (
                  <div className="bot-mem-row" key={id}>
                    <span className="mono">{id}</span>
                    <span>
                      {label}
                      <em className="faint"> · {bot?.capability === "read" ? "要 dispatch / work 档才能用" : "已连接"}</em>
                    </span>
                  </div>
                ))}
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
                <p className="bot-note">连接器只说明「它能碰到什么」：写操作一律走「提议 → 人确认」，不在这里。</p>
              </>
            )}
            {tab === "tasks" && (
              <>
                <div className="bot-label">监视任务</div>
                <div className="bot-watch">
                  <select
                    className="bot-exec"
                    value=""
                    onChange={(event) => { if (event.target.value) void run("watch", () => act("botWatchTask", { todoId: event.target.value, botId: bot?.id })); }}
                  >
                    <option value="">选择一个任务交给它监视…</option>
                    {(snapshot.recentTodos || []).map((t) => (
                      <option key={t.id} value={t.id}>{t.key} · {t.title.slice(0, 24)} · {t.missionState || t.status}</option>
                    ))}
                  </select>
                </div>
                {(snapshot.turns || []).filter((t) => t.botId === bot?.id && t.decision === "watching").map((t) => {
                  const todo = (snapshot.recentTodos || []).find((x) => x.id === t.todoId);
                  return (
                    <div className="bot-mem-row" key={t.id}>
                      <span className="mono">{todo?.key || "—"}</span>
                      <span>
                        {todo?.title || t.reply}
                        <em className="faint"> · {todo?.missionState || todo?.status || "未知"}</em>
                        <button className="bot-link" onClick={() => void run("unwatch", () => act("botUnwatchTask", { todoId: t.todoId, botId: bot?.id }))}>取消监视</button>
                      </span>
                    </div>
                  );
                })}
                <div className="bot-label" style={{ marginTop: 12 }}>bot 经手的任务</div>
                <p className="bot-note">这里只列「bot 提议后建的 / bot 起过 run 的」任务；别人（或主管）建的任务不会出现在这里。</p>
                {(snapshot.tasks || []).filter((t) => (snapshot.turns || []).some((x) => x.todoId === t.id && x.botId === bot?.id && x.decision !== "watching")).length === 0 && (
                  <p className="bot-note">还没有。等它主动提议、你点「开跑」之后，这里会出现对应的任务与状态。</p>
                )}
                {(snapshot.tasks || [])
                  .filter((t) => (snapshot.turns || []).some((x) => x.todoId === t.id && x.botId === bot?.id && x.decision !== "watching"))
                  .map((t) => (
                    <div className="bot-mem-row" key={t.id}>
                      <span className="mono">{t.key}</span>
                      <span>
                        {t.title}
                        <em className="faint"> · {t.missionState || t.status}</em>
                      </span>
                    </div>
                  ))}
              </>
            )}
            {tab === "policy" && (
              <>
                <div className="bot-label">能力档位</div>
                <div className="bot-seg">
                  {(["read", "dispatch", "work"] as const).map((cap) => (
                    <button
                      key={cap}
                      className={bot?.capability === cap ? "on" : ""}
                      disabled={Boolean(busy)}
                      onClick={() => void run("cap", async () => {
                        await act("botSave", { id: bot?.id, capability: cap });
                        notify(cap === "work" ? "已开启：可以直接起 run（点「开跑」即授权）" : cap === "dispatch" ? "已开启：可以提议建任务（仍需你确认）" : "已切回只读");
                      })}
                    >
                      {CAP_LABEL[cap]}
                    </button>
                  ))}
                </div>
                <div className="bot-field edu" style={{ marginTop: 8 }}>
                  <span>执行体（work 档位起 run 用的 Agent）</span>
                  <select
                    className="bot-exec"
                    value={bot?.executorAgentId || ""}
                    onChange={(event) => void run("exec", () => act("botSave", { id: bot?.id, executorAgentId: event.target.value }))}
                  >
                    <option value="">未绑定</option>
                    {(snapshot.agents || []).filter((a) => a.role !== "supervisor").map((a) => (
                      <option key={a.id} value={a.id}>{a.name}{a.alias ? ` · ${a.alias}` : ""}</option>
                    ))}
                  </select>
                </div>
                <p className="bot-note">
                  {bot?.capability === "work"
                    ? `能执行：点「开跑」会建任务并用 ${(snapshot.agents || []).find((a) => a.id === bot?.executorAgentId)?.name || "未绑定的 Agent"} 起一次 run；跑完回流一条汇报。`
                    : "可起任务 ≠ 自己动手：bot 只能提议建 todo，起 run 仍要你在桌面确认。"}
                </p>
                <div className="bot-label" style={{ marginTop: 14 }}>出场规则</div>
                <div className="bot-label" style={{ marginTop: 14 }}>谁能找它</div>
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
              </>
            )}
          </div>
    </>
  );

  if (settingsOnly) {
    return (
      <div className="bot-settings">
        <div className="bot-settings-head">
          <span className={`bot-avatar ${bot?.avatarClass || "a"}`}>{bot?.avatar || bot?.name.slice(0, 1)}</span>
          <div className="bot-settings-title">
            <b>{bot?.name || "机器人"}</b>
            <span>{bot?.role === "supervisor" ? "主管" : "员工"} · {CAP_LABEL[bot?.capability || "read"]}</span>
          </div>
          <span className="spacer" />
          <button className="btn tiny" disabled={Boolean(busy)} onClick={() => void tick()}>{busy === "tick" ? "…" : t("action.tick")}</button>
          {onClose && <button className="icon-btn" title="关闭" aria-label="关闭机器人配置" onClick={onClose}><XIcon size={13} /></button>}
        </div>
        <div className="bot-settings-body">
          <aside className="bot-aside">
            {isGroup ? (
              <div className="bot-aside-body">
                <div className="bot-label">群成员 <em>{members.length}</em></div>
                {members.map((m) => (
                  <div className="bot-group-member" key={m.id}>
                    <span className={`bot-avatar ${m.avatarClass || "a"}`}>{m.avatar || m.name.slice(0, 1)}</span>
                    <span className="bot-item-main">
                      <b>{m.name}</b>
                      <span>{m.role === "supervisor" ? "主管" : "员工"} · {CAP_LABEL[m.capability || "read"]}</span>
                    </span>
                    <button className="link tiny" onClick={() => setReplyMode({ kind: "bot", botId: m.id })} title="固定由它回复">只它回</button>
                  </div>
                ))}
                <p className="bot-note">成员各自有自己的会话与记忆，群里只是同一个房间。默认由被 @ 的人回；没 @ 就主管回；「全体」让每个人都回。</p>
              </div>
            ) : asideContent}
          </aside>
        </div>
      </div>
    );
  }


  return (
    <div className="page bot-page">

      {error && <div className="bot-banner fail"><i /><span>{error}</span></div>}

      <div className={`bot-grid${chatView === "trajectory" && !isGroup && openThreadId ? " trajectory-open" : ""}`}>
        <aside className="bot-side">
          <div className="bot-label">机器人</div>
          <div className="bot-list">
            {groups.map((g) => (
              <button key={g.id} className={`bot-item ${botId === g.id ? "on" : ""}`} onClick={() => setBotId(g.id)} title="群聊：一句话发给谁由回复模式决定">
                <span className="bot-avatar group">群</span>
                <span className="bot-item-main">
                  <b>{g.name}</b>
                  <span>{g.memberIds.length} 个成员 · {g.replyMode.kind === "all" ? "全体回复" : g.replyMode.kind === "bot" ? "固定成员回复" : "@ 谁谁回"}</span>
                </span>
              </button>
            ))}
            {!groups.length && (
              <button className="bot-item" onClick={() => void createGroup()} title="把现在的机器人拉一个群">
                <span className="bot-avatar group">群</span>
                <span className="bot-item-main"><b>新建群聊</b><span>把 {members.length} 个机器人拉进来</span></span>
              </button>
            )}
            {snapshot.bots.map((item) => {
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
          <button className="bot-new" onClick={create}>＋ 新建机器人</button>
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
                  {!isGroup && <button disabled={Boolean(busy)} onClick={togglePause}>{bot?.status === "active" ? "暂停" : "恢复"}</button>}
                  {!isGroup && <button disabled={Boolean(busy)} onClick={() => void (muted ? unmute() : mute())}>{muted ? "取消静音" : "静音 1h"}</button>}
                  {!isGroup && <button disabled={Boolean(busy)} onClick={() => void tick()}>跑一次决策</button>}
                  <button onClick={() => void run("thread", async () => {
                    const res = (await act("botThread", { botId: bot?.id })) as { threadId?: string } | null;
                    if (res?.threadId) onOpenThread(res.threadId);
                    else notify("没能打开会话");
                  })}>打开默认会话</button>
                  <button onClick={create}>新建机器人</button>
                  <button onClick={() => { setTab("persona"); setRenameFocus((n) => n + 1); }}>重命名</button>
                  <button onClick={migrateThreads}>迁移历史到会话</button>
                  <button onClick={() => void clearTurns("silent")}>清空沉默 / 被拦记录</button>
                  <button className="danger" onClick={() => { if (window.confirm("清空这个机器人的全部回合记录？")) void clearTurns("all"); }}>清空全部回合</button>
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
                <button className="btn tiny primary" onClick={newChat} disabled={Boolean(busy)}>＋ 新会话</button>
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
              {upNext.length > 0 && (
                <div className="bot-upnext">
                  <div className="bot-label">接下来 <em>{upNext.length}</em></div>
                  {upNext.slice(0, 4).map((n) => (
                    <button
                      key={n.id}
                      className="bot-upnext-row"
                      onClick={() => { if (n.threadId) openChat(n.threadId); else composerRef.current?.focus(); }}
                      title={n.title}
                    >
                      <span className="tag">{n.label}</span>
                      <b className="ellipsis">{n.title}</b>
                      {n.hint && <span className="tiny faint">{n.hint}</span>}
                    </button>
                  ))}
                </div>
              )}
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
                            <ChevronRightIcon size={12} className={expandedChat === chat.id ? "rot-90" : ""} />
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
                  className={`ds-turn-mark ${t.id === activeTurnId ? "on" : ""}`}
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
              <button className={chatView === "chat" ? "on" : ""} onClick={() => setChatView("chat")}>对话</button>
              <button className={chatView === "trajectory" ? "on" : ""} onClick={() => setChatView("trajectory")}>轨迹</button>
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
                <ChevronLeftIcon size={13} />
              </button>
              <b className="ellipsis">{chats.find((c) => c.id === openThreadId)?.title || "会话"}</b>
              <span className="tiny faint">{turns.filter((t) => ["answered", "replied", "reported", "asked"].includes(t.decision || "answered")).length} 条</span>
              <span className="spacer" />
              <button className="btn tiny" onClick={newChat} disabled={Boolean(busy)}>＋ 新会话</button>
              <RowMenu title="会话操作">
                <button onClick={() => { const c = chats.find((x) => x.id === openThreadId); setRenamingChat({ id: openThreadId, title: c?.title || "会话" }); setOpenThreadId(null); }}>重命名</button>
                <button onClick={() => forkChat(openThreadId)}>从这里分支</button>
                <button className="danger" onClick={() => { const c = chats.find((x) => x.id === openThreadId); if (c) removeChat(c); }}>删除会话</button>
              </RowMenu>
            </div>
          )}
          <div className="bot-chat-tabs">
            <button className={chatView === "chat" ? "on" : ""} onClick={() => setChatView("chat")}>对话</button>
            <button className={chatView === "trajectory" ? "on" : ""} onClick={() => setChatView("trajectory")}>轨迹</button>
          </div>
          {chatView === "trajectory" ? (
            <BotTrajectoryView turns={turns} state={state} onJump={(id) => { setChatView("chat"); setTimeout(() => jumpToTurn(id), 30); }} />
          ) : (
          <>
          <div
            className="bot-stream"
            ref={streamRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              syncActiveTurn();
            }}
          >
            {!turns.length && (
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
            {isGroup && groupMessages.map((m) => {
              if (m.author === "owner") {
                return (
                  <div className="ds-user" key={m.id}>
                    <div className="ds-bubble">{m.text}</div>
                    <div className="ds-actions ds-actions-user"><span className="ds-time">{hm(m.createdAt)}</span></div>
                  </div>
                );
              }
              const sender = botOf(m.botId ?? undefined);
              const spoke = ["answered", "replied", "reported", "asked"].includes(m.decision);
              return (
                <div className="ds-assistant" key={m.id}>
                  <div className="ds-bot-attr">
                    <b>{m.botName || sender?.name}</b>
                    <span className="ds-time">{hm(m.createdAt)}</span>
                    <span className={`ds-tag ${spoke ? "ai" : ""}`}>{DECISION_LABEL[m.decision] || (spoke ? "回复" : "沉默")}</span>
                  </div>
                  {spoke
                    ? <div className="ds-assistant-body"><RichText text={m.text} /></div>
                    : <div className="ds-system-note">{m.text || "没有开口"}<span> · 沉默也留痕</span></div>}
                  <TraceDetails runId={m.meta?.runId} botName={m.botName} state={state} />
                </div>
              );
            })}
            {!isGroup && rows.map((row) => {
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
              const secs = turn.cost?.ms ? Math.max(1, Math.round(turn.cost.ms / 1000)) : null;
              const headLabel = turn.decision === "reported" ? "已汇报"
                : turn.decision === "asked" ? "已提问"
                  : turn.decision === "interrupted" ? "已中断"
                    : "已完成";
              const turnHeadText = secs === null ? headLabel : `${headLabel}，用时 ${secs}秒`;
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
                    <button className="ds-action" title="复制这条回复" aria-label="复制这条回复" onClick={() => void window.harness.clipboardWrite(turn.reply || "")}><CopyIcon size={15} /></button>
                    <button className="ds-action" title="引用这条继续问" aria-label="引用这条继续问" onClick={() => quote(turn.reply || "")}><QuoteIcon size={15} /></button>
                    {openThreadId && <button className="ds-action" title="复制到新会话，换个说法重开" aria-label="分支到新会话" onClick={() => forkChat(openThreadId)}><GitIcon size={15} /></button>}
                    <span className="ds-time">{hm(turn.createdAt)}</span>
                    {typeof turn.cost?.tokens === "number" && turn.cost.tokens > 0 && (
                      <span className="ds-usage">{turn.cost.tokens >= 1000 ? `${(turn.cost.tokens / 1000).toFixed(1)}k` : turn.cost.tokens} tokens</span>
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
                    </div>
                  </details>
                </>
              );

              if (turn.decision === "replied") {
                return (
                  <div className="ds-turn" data-turn-id={turn.id} key={row.key}>
                    <div className="ds-user">
                      <div className="ds-bubble">{turn.input}</div>
                      <div className="ds-actions ds-actions-user">
                        <span className="ds-time">{hm(turn.createdAt)}</span>
                        <button className="ds-action" title="复制这条消息" aria-label="复制这条消息" onClick={() => void window.harness.clipboardWrite(turn.input || "")}><CopyIcon size={15} /></button>
                      </div>
                    </div>
                    <div className="ds-assistant">
                      {bubble}
                    </div>
                  </div>
                );
              }

              return (
                <div className="ds-assistant" data-turn-id={turn.id} key={row.key}>
                  {bubble}
                </div>
              );
            })}
          </div>
          {streaming && (botOf(streaming.botId) || bot) && (isGroup || streaming.botId === bot?.id) && (
            <div className="ds-assistant ds-streaming" aria-live="polite">
              <div className="ds-bot-attr">
                <b>{(botOf(streaming.botId) || bot)?.name}</b>
                <span className="ds-tag">回你</span>
                <button className="ds-action-text" onClick={() => void act("botCancel", { botId: streaming.botId })}>停止</button>
              </div>
              <div className="ds-assistant-body">{streaming.text || "\u00a0"}<span className="ds-caret" /></div>
            </div>
          )}

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
                  <button key={m.id} className="im-mention" onClick={() => insert(m.name)}>
                    <span className={`bot-avatar ${m.avatarClass || "a"}`}>{m.avatar || m.name.slice(0, 1)}</span>
                    <b>{String(m.name).split("·")[0].trim()}</b>
                    <span className="tiny faint ellipsis">{m.name}</span>
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
                <button className={replyMode.kind === "mentions" ? "on" : ""} onClick={() => setReplyMode({ kind: "mentions" })} title="只有被 @ 到的成员回复；没 @ 就默认主管">@ 谁谁回</button>
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
              onKeyDown={(event) => {
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
                <button className="ds-add" onClick={() => void pickAttachments()} disabled={attachments.length >= 3} title="把文本文件带进上下文" aria-label="附件"><PlusIcon size={13} /></button>
                {isGroup && <span className="ds-chip static" title="输入 @名字 指定谁回">@ 谁回</span>}
                <span className="ds-chip static">{isGroup ? "群聊" : bot?.role === "supervisor" ? "主管" : "员工"}</span>
              </div>
              <div className="ds-composer-trailing">
                {streaming
                  ? <button className="ds-action-text" onClick={() => void cancel()}>停止</button>
                  : <button className="ds-send" disabled={!draft.trim() && !attachments.length} onClick={() => void send()} title="发送" aria-label="发送"><SendIcon size={16} /></button>}
              </div>
            </div>
          </div>

          <div className="bot-foot">
            <span>
              {isGroup
                ? "群聊：每条发言按「谁回」投递；没开口的成员也会留一条沉默记录。"
                : bot?.capability === "work"
                  ? `能执行：点「开跑」会用 ${(snapshot.agents || []).find((a) => a.id === bot?.executorAgentId)?.name || "未绑定的 Agent"} 起一次 run，跑完回流一条汇报。`
                  : bot?.capability === "dispatch"
                    ? "可起任务：只建 todo，不起 run；跑不跑由你在桌面决定。"
                    : "只读：不会建任务、不会起 run；要在 Chat 里派活。"}
            </span>
            <button className="btn tiny" onClick={onOpenMemory}>打开记忆</button>
          </div>
          </>
          )}
            </>
          ) : (
            <div className="bot-chat-choose"><span>从右侧选一条消息开始</span></div>
          )}
        </main>

        {isGroup && (
        <aside className="bot-aside">
          {isGroup ? (
            <div className="bot-aside-body">
              <div className="bot-label">群成员 <em>{members.length}</em></div>
              {members.map((m) => (
                <div className="bot-group-member" key={m.id}>
                  <span className={`bot-avatar ${m.avatarClass || "a"}`}>{m.avatar || m.name.slice(0, 1)}</span>
                  <span className="bot-item-main">
                    <b>{m.name}</b>
                    <span>{m.role === "supervisor" ? "主管" : "员工"} · {CAP_LABEL[m.capability || "read"]}</span>
                  </span>
                  <button className="link tiny" onClick={() => setReplyMode({ kind: "bot", botId: m.id })}>只它回</button>
                </div>
              ))}
              <p className="bot-note">群聊是聚合视图：每个成员仍然是自己的会话与记忆，不会互相看到。要谁回应就「发给」谁。</p>
            </div>
          ) : asideContent}
        </aside>
        )}
        {!isGroup && chatView === "chat" && railTab === "settings" && (
          <aside className="bot-aside">
            <BotRailTabs tab={railTab} onTab={setRailTab} />
            {asideContent}
          </aside>
        )}
      </div>
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
