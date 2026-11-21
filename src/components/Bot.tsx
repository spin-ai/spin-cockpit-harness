import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { RowMenu } from "./RowMenu";
import { assignmentsForBot } from "../selectors/assignments";
import type { State } from "../types";

type Act = (type: string, payload?: unknown) => Promise<any>;

type Persona = { mission?: string; tone?: string; address?: string; length?: string; boundary?: string; habit?: string };
type Routine = {
  id: string; botId: string; name?: string; kind?: "daily" | "every" | "watch";
  atHour?: number; everyMs?: number; enabled?: boolean;
  /** alongside = 到点就跑；in-chat = 等这个 bot 空下来（最多等 5 分钟） */
  mode?: "alongside" | "in-chat"; waitingSince?: number;
  watch?: { kind?: "file" | "cmd"; path?: string; cmd?: string };
  lastFiredAt?: number; lastError?: string; when?: string; nextAt?: number | null;
  due?: boolean; why?: string;
};
type Policy = { maxTurnsPerHour?: number; minGapMs?: number; quietHours?: [number, number]; escalate?: string };
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
  reason?: string; cost?: { tokens?: number | null; ms?: number }; createdAt: number;
};
type Ask = { turnId: string; botId: string; text: string; createdAt: number };
type Snapshot = {
  bots: Bot[]; turns: Turn[]; routines?: Routine[]; routineStatus?: Routine[];
  asks?: Ask[];
  botThreads?: Record<string, string>;
  recent?: { answeredHour?: number; blockedHour?: number; silentHour?: number };
  agents?: { id: string; name: string; alias: string; cli: string; role: string }[];
  tasks?: { id: string; key: string; title: string; status: string; missionState: string | null; agentId: string | null }[];
  recentTodos?: { id: string; key: string; title: string; status: string; missionState: string | null }[];
};

const DECISION_LABEL: Record<string, string> = { answered: "主动", reported: "汇报", watching: "监视中", asked: "先问一句", streaming: "生成中", interrupted: "被打断", silent: "沉默", blocked: "被拦", escalated: "转人工" };
const GLYPH: Record<string, string> = { asked: "?", streaming: "…", interrupted: "⏸", silent: "·", blocked: "✕", escalated: "↗" };
const CAP_LABEL: Record<string, string> = { read: "只读", dispatch: "可起任务", work: "能执行" };

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
export function BotConsole({ act, notify, onOpenMemory, onOpenThread, state }: {
  act: Act;
  notify: (message: string) => void;
  onOpenMemory: () => void;
  onOpenThread: (threadId: string) => void;
  /** 任务投影需要它；缺省时「分配到的任务」区块只显示未绑定提示 */
  state?: State | null;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [memoryOverview, setMemoryOverview] = useState<{ byLayer?: Record<string, number>; notes?: number; injectable?: number } | null>(null);
  const [botId, setBotId] = useState("");
  const [tab, setTab] = useState<"persona" | "memory" | "tasks" | "routines" | "policy">("persona");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // 「分配到的任务」：Bot.executorAgentId → Agent，任务来自 state.todos（与场景同一投影）
  const botEntity = snapshot?.bots.find((b) => b.id === botId);
  const assigned = useMemo(
    () => assignmentsForBot(state?.todos ?? [], state?.delegations, { executorAgentId: botEntity?.executorAgentId ?? null }),
    [state?.todos, state?.delegations, botEntity?.executorAgentId],
  );
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  /** 递增就重挂「名字」输入框并聚焦（新建 bot 后立刻改名，不用再找入口） */
  const [renameFocus, setRenameFocus] = useState(0);
  /** 日程的新建表单（不再用 window.prompt 连环弹窗） */
  const [routineDraft, setRoutineDraft] = useState<{
    kind: "daily" | "every" | "watch"; name: string; atHour: number; minutes: number; path: string;
  } | null>(null);
  const [streaming, setStreaming] = useState<{ botId: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = (await act("botSnapshot", {})) as Snapshot | null;
      if (next) {
        setSnapshot(next);
        setBotId((current) => current || next.bots[0]?.id || "");
      }
      const ov = (await act("memoryOverview", {})) as { byLayer?: Record<string, number>; notes?: number; injectable?: number } | null;
      if (ov) setMemoryOverview(ov);
    } catch (err) {
      setError(String((err as Error)?.message || err));
    }
  }, [act]);

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

  const bot = useMemo(() => snapshot?.bots.find((b) => b.id === botId) ?? snapshot?.bots[0] ?? null, [snapshot, botId]);
  const turns = useMemo(() => (snapshot?.turns || []).filter((t) => t.botId === bot?.id), [snapshot, bot?.id]);
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

  const send = async () => {
    const text = draft.trim();
    if (!text || !bot) return;
    setDraft("");
    setError("");
    setStreaming({ botId: bot.id, text: "" });
    try {
      const res = await window.harness.action("botChat", { botId: bot.id, text }) as { ok?: boolean; result?: unknown; error?: string } | null;
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

  const savePatch = async (patch: Record<string, unknown>) => {
    if (!bot) return;
    try { await act("botSave", { id: bot.id, ...patch }); await load(); }
    catch (err) { notify(String((err as Error)?.message || err)); }
  };
  const savePersona = (key: keyof Persona, value: string) => savePatch({ persona: { ...(bot?.persona || {}), [key]: value } });
  const savePolicy = (patch: Record<string, unknown>) => savePatch({ policy: { ...(bot?.policy || {}), ...patch } });

  const myRoutines = useMemo(
    () => (snapshot?.routineStatus || snapshot?.routines || []).filter((r) => r.botId === bot?.id),
    [snapshot, bot?.id],
  );

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
    return (
      <div className="page bot-page">
        <PageHeader kicker="机器人" title="机器人" />
        <div className="bot-loading"><EmptyState compact title="正在读取 bot…" desc={error || "稍等一下"} /></div>
      </div>
    );
  }

  if (!snapshot.bots.length) {
    return (
      <div className="page bot-page">
        <PageHeader kicker="机器人" title="机器人" />
        <EmptyState mark="◇" title="还没有机器人" desc="建一个机器人需要人格卡、出场策略和配额；先给个名字，其余用默认值。" action={<button className="btn primary" onClick={create}>新建机器人</button>} />
      </div>
    );
  }

  return (
    <div className="page bot-page">
      <PageHeader
        kicker="机器人"
        title={bot?.name || "机器人"}
        subtitle={(
          <>
            <span className={`tag ${bot?.status === "active" ? "ok" : ""}`}>{bot?.status === "active" ? "主动" : "已暂停"}</span>
            <span>{bot?.role === "supervisor" ? "主管" : "员工"}</span>
            <span className="faint">·</span>
            <span>{CAP_LABEL[bot?.capability || "read"]}</span>
            <span className="faint">·</span>
            <span className="faint">本小时 {snapshot.recent?.answeredHour ?? 0} 条已说 / {snapshot.recent?.blockedHour ?? 0} 条被拦</span>
            {muted && <><span className="faint">·</span><span className="tag warn">静音中</span></>}
          </>
        )}
        actions={(
          <>
            <button className="btn" disabled={Boolean(busy)} onClick={togglePause}>{bot?.status === "active" ? "暂停" : "恢复"}</button>
            <button className="btn" disabled={Boolean(busy)} onClick={() => void (muted ? unmute() : mute())}>{muted ? "取消静音" : "静音 1h"}</button>
            <button
              className="btn"
              title="这个机器人的持续会话与 Chat 共用一条 thread"
              onClick={() => void run("thread", async () => {
                const res = (await act("botThread", { botId: bot?.id })) as { threadId?: string } | null;
                if (res?.threadId) onOpenThread(res.threadId);
                else notify("没能打开会话");
              })}
            >
              打开会话
            </button>
            <RowMenu title="机器人操作">
              <button onClick={create}>新建机器人</button>
              <button onClick={() => { setTab("persona"); setRenameFocus((n) => n + 1); }}>重命名</button>
              <button onClick={migrateThreads}>迁移历史到会话</button>
              <button onClick={() => void clearTurns("silent")}>清空沉默/被拦记录</button>
              <button className="danger" onClick={() => { if (window.confirm("清空这个机器人的全部回合记录？")) void clearTurns("all"); }}>清空全部回合</button>
              <button className="danger" onClick={remove}>删除当前机器人</button>
            </RowMenu>
            <button className="btn primary" disabled={Boolean(busy)} onClick={() => void tick()}>{busy === "tick" ? "决策中…" : "跑一次决策"}</button>
          </>
        )}
      />

      {error && <div className="bot-banner fail"><i /><span>{error}</span></div>}

      <div className="bot-grid">
        <aside className="bot-side">
          <div className="bot-label">机器人</div>
          <div className="bot-list">
            {snapshot.bots.map((item) => {
              const on = item.id === bot?.id;
              const itemMuted = Boolean(item.mutedUntil && item.mutedUntil > Date.now());
              const dot = item.status !== "active" ? "paused" : itemMuted ? "quiet" : "";
              const count = (snapshot.turns || []).filter((t) => t.botId === item.id && t.decision === "answered").length;
              return (
                <button key={item.id} className={`bot-item ${on ? "on" : ""}`} onClick={() => setBotId(item.id)}>
                  <span className={`bot-avatar ${item.avatarClass || "a"}`}>{item.avatar || item.name.slice(0, 1)}</span>
                  <span className="bot-item-main">
                    <b>{item.name}</b>
                    <span>{CAP_LABEL[item.capability || "read"]} · {count} 条已说</span>
                  </span>
                  <span className={`bot-dot ${dot}`} title={dot === "paused" ? "已暂停" : dot === "quiet" ? "静音中" : "运行中"} />
                </button>
              );
            })}
          </div>
          <button className="bot-new" onClick={create}>＋ 新建 bot</button>
        </aside>

        <main className="bot-main">
          <div className="bot-stream">
            {!turns.length && (
              <div className="bot-empty">
                <EmptyState compact mark="◇" title="还没有回合" desc="点右上「跑一次决策」：有值得说的事件才会开口，没有就记一条沉默。" />
              </div>
            )}
            {turns.map((turn) => {
              if (turn.decision === "watching") return null; // 监视记录只在「任务」页签展示，不占回合流
              if (turn.decision === "reported") {
                return (
                  <div className="bot-turn" key={turn.id}>
                    <span className={`bot-avatar ${bot?.avatarClass || "a"}`}>{bot?.avatar || bot?.name.slice(0, 1)}</span>
                    <div className="bot-turn-body">
                      <div className="bot-turn-meta">
                        <b>{bot?.name}</b>
                        <span>{hm(turn.createdAt)}</span>
                        <span className="tag ok">汇报</span>
                        {turn.runId && <span className="mono tiny faint">run {String(turn.runId).slice(0, 6)}</span>}
                      </div>
                      <div className="bot-bubble">{turn.reply}</div>
                    </div>
                  </div>
                );
              }
              if (turn.decision === "replied") {
                return (
                  <div className="bot-exchange" key={turn.id}>
                    <div className="bot-user-line">
                      <span className="bot-user-meta mono">{hm(turn.createdAt)}</span>
                      <span className="bot-user-bubble">{turn.input}</span>
                    </div>
                    <div className="bot-turn">
                      <span className={`bot-avatar ${bot?.avatarClass || "a"}`}>{bot?.avatar || bot?.name.slice(0, 1)}</span>
                      <div className="bot-turn-body">
                        <div className="bot-turn-meta">
                          <b>{bot?.name}</b>
                          <span className="tag">回你</span>
                        </div>
                        <div className="bot-bubble">{turn.reply}</div>
                        <details className="bot-why">
                          <summary>为什么这样回</summary>
                          <div className="bot-why-body">
                            <div><span>触发源</span><b className="mono">mention · 你直接说话</b></div>
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
                      </div>
                    </div>
                  </div>
                );
              }
              if (turn.decision === "asked") {
                return (
                  <div className="bot-turn" key={turn.id}>
                    <span className={`bot-avatar ${bot?.avatarClass || "a"}`}>{bot?.avatar || bot?.name.slice(0, 1)}</span>
                    <div className="bot-turn-body">
                      <div className="bot-turn-meta">
                        <b>{bot?.name}</b>
                        <span>{hm(turn.createdAt)}</span>
                        <span className="tag">先问一句</span>
                      </div>
                      <div className="bot-bubble">{turn.reply}</div>
                      <div className="bot-proposal-note">你回一句就会成为它的职责（人格卡 → 职责），以后随时能改。</div>
                    </div>
                  </div>
                );
              }
              if (turn.decision !== "answered") {
                return (
                  <div className={`bot-quiet ${turn.decision || "silent"}`} key={turn.id}>
                    <span className="bot-mark">{GLYPH[turn.decision || "silent"] || "·"}</span>
                    <span className="bot-quiet-main">
                      <b>{DECISION_LABEL[turn.decision || "silent"] || turn.decision}</b>
                      <span>{turn.reason || "—"}</span>
                      {turn.decision === "interrupted" && turn.reply && <span className="bot-partial">「{turn.reply}」</span>}
                      <details className="bot-why">
                        <summary>为什么</summary>
                        <div className="bot-why-body">
                          <div><span>触发源</span><b className="mono">{turn.trigger?.kind || "tick"}{turn.trigger?.ref ? ` · ${turn.trigger.ref}` : ""}</b></div>
                          <div><span>注入记忆</span><b>{turn.injected?.length ? turn.injected.map((m) => `[${m.layer}] ${m.title}`).join("；") : "没有注入（沉默/被拦不组装上下文）"}</b></div>
                          <div><span>成本</span><b className="mono">{turn.cost?.tokens ? `${turn.cost.tokens} tokens` : "没调用模型"}</b></div>
                        </div>
                      </details>
                    </span>
                    <span className="bot-time mono">{hm(turn.createdAt)}</span>
                  </div>
                );
              }
              return (
                <div className="bot-turn" key={turn.id}>
                  <span className={`bot-avatar ${bot?.avatarClass || "a"}`}>{bot?.avatar || bot?.name.slice(0, 1)}</span>
                  <div className="bot-turn-body">
                    <div className="bot-turn-meta">
                      <b>{bot?.name}</b>
                      <span>{hm(turn.createdAt)}</span>
                      <span className="tag ai">主动</span>
                    </div>
                    <div className="bot-bubble">{turn.reply}</div>
                    {turn.proposal && !turn.proposal.dismissed && (bot?.capability === "dispatch" || bot?.capability === "work") && (
                      turn.todoId
                        ? <div className="bot-proposal done">已建任务（{turn.todoId.slice(0, 6)}…）· 等你在桌面确认后才会起 run</div>
                        : (
                          <div className="bot-proposal">
                            <b>{turn.proposal.title}</b>
                            <p>{turn.proposal.desc.split("\n")[0]}</p>
                            <div className="row">
                              <button className="btn tiny primary" disabled={Boolean(busy)} onClick={() => void acceptProposal(turn)}>{bot?.capability === "work" ? "开跑" : "起任务"}</button>
                              <button className="btn tiny" disabled={Boolean(busy)} onClick={() => void dismissProposal(turn)}>先别</button>
                              <span className="tiny faint">{bot?.capability === "work" ? "会立即起一次 run（点这个就是授权）" : "只建 todo，不起 run；审批仍在你手里"}</span>
                            </div>
                          </div>
                        )
                    )}
                    {turn.proposal?.dismissed && <div className="bot-proposal-note">建议已忽略（留在回合记录里）</div>}
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
                  </div>
                </div>
              );
            })}
          </div>
          {streaming && streaming.botId === bot?.id && (
            <div className="bot-turn bot-streaming">
              <span className={`bot-avatar ${bot?.avatarClass || "a"}`}>{bot?.avatar || bot?.name.slice(0, 1)}</span>
              <div className="bot-turn-body">
                <div className="bot-turn-meta"><b>{bot?.name}</b><span className="tag">回你</span><span className="faint">正在输入…</span></div>
                <div className="bot-bubble">{streaming.text || "\u00a0"}<span className="bot-caret" /></div>
              </div>
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

          <div className="bot-composer">
            <textarea
              ref={composerRef}
              value={draft}
              rows={1}
              placeholder={bot?.persona?.mission
                ? `跟 ${bot?.name || "bot"} 说点什么；⌘↵ 发送`
                : `告诉 ${bot?.name || "bot"}：你负责…（第一句话会成为职责）；⌘↵ 发送`}
              onChange={(event) => {
                setDraft(event.target.value);
                const el = event.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(120, el.scrollHeight)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); }
              }}
            />
            {streaming
              ? <button className="btn" onClick={() => void cancel()}>取消</button>
              : <button className="btn primary" disabled={!draft.trim()} onClick={() => void send()}>发送</button>}
          </div>

          <div className="bot-foot">
            <span>
              {bot?.capability === "work"
                ? `能执行：点「开跑」会用 ${(snapshot.agents || []).find((a) => a.id === bot?.executorAgentId)?.name || "未绑定的 Agent"} 起一次 run，跑完回流一条汇报。`
                : bot?.capability === "dispatch"
                  ? "可起任务：只建 todo，不起 run；跑不跑由你在桌面决定。"
                  : "只读：不会建任务、不会起 run；要在 Chat 里派活。"}
            </span>
            <button className="btn tiny" onClick={onOpenMemory}>打开记忆</button>
          </div>
        </main>

        <aside className="bot-aside">
          <div className="bot-tabs">
            {([["persona", "人格卡"], ["memory", "记忆"], ["tasks", "任务"], ["routines", "日程"], ["policy", "策略"]] as const).map(([id, label]) => (
              <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
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
                这个人格还没绑定执行体（<code>executorAgentId</code>）。Mission 派给 Agent 的任务，
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
                <BotField label="职责" value={bot?.persona?.mission || ""} onCommit={(value) => void savePersona("mission", value)} />
                {!bot?.persona?.mission && <p className="bot-note">还没告诉它要做什么。在下面输入框说一句「你负责…」，这将成为它的职责。</p>}
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
                <div className="bot-label">日程（到点 / 到间隔 / 变化才跑）</div>
                {myRoutines.length
                  ? myRoutines.map((r) => (
                    <div className="bot-mem-row" key={r.id}>
                      <span className="mono">{r.enabled ? "on" : "off"}</span>
                      <span>
                        {r.name || r.when}
                        <em className="faint"> · {r.when}</em>
                        <b className="mono" style={{ float: "right" }}>{r.lastFiredAt ? hm(r.lastFiredAt) : "未跑"}</b>
                        <em className="faint">{r.due ? "到点了" : (r.why || (r.nextAt ? `下次 ${hm(r.nextAt)}` : ""))}</em>
                      </span>
                    </div>
                  ))
                  : <p className="bot-note">还没有日程。加一条：它会在到点时自己开口，跑过的每一次都记在左侧回合流里。</p>}
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
                {myRoutines.length > 0 && (
                  <RowMenu title="日程操作">
                    {myRoutines.map((r) => (
                      <button key={`${r.id}-toggle`} onClick={() => void toggleRoutine(r)}>{r.enabled ? "停用" : "启用"} · {r.name || r.when}</button>
                    ))}
                    {myRoutines.map((r) => (
                      <button
                        key={`${r.id}-mode`}
                        title="到点就跑 vs 等这个 bot 空下来再跑"
                        onClick={() => void run("routine", async () => {
                          await act("botRoutineSave", { id: r.id, botId: r.botId, mode: r.mode === "in-chat" ? "alongside" : "in-chat" });
                          notify(r.mode === "in-chat" ? "改成到点就跑" : "改成等这一轮");
                        })}
                      >
                        {r.mode === "in-chat" ? "改成到点就跑" : "改成等这一轮"} · {r.name || r.when}
                      </button>
                    ))}
                    {myRoutines.map((r) => (
                      <button key={`${r.id}-del`} className="danger" onClick={() => void removeRoutine(r)}>删除 · {r.name || r.when}</button>
                    ))}
                  </RowMenu>
                )}
                <p className="bot-note">日程只决定「什么时候开口」，不会自己起 Agent 任务；要动手仍然走 Chat 派活或 dispatch 建议。</p>
                {bot?.policy?.escalate && <p className="bot-note">必须转人工：{bot.policy.escalate}</p>}
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
                <div className="bot-kv">
                  <span>群聊</span><b>只回 @（P2）</b>
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
        </aside>
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
