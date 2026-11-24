import { useEffect, useState } from "react";
import { hm } from "../ui";
import { CAP_LABEL, DECISION_LABEL } from "../labels";
import { confirmDialog } from "./ConfirmHost";
import type { Bot, BotRoutine, BotTurn, State } from "../types";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { RowMenu } from "./RowMenu";
import { Overview } from "./Overview";
import { useT } from "../i18n";
import { Segmented } from "./Tabs";
import { ListIcon, TableIcon } from "./Icons";
import { UndoBar, type UndoAction } from "./UndoBar";
import { describeRoutine, nextRunAt } from "../../electron/bot/routine.mjs";

type Act = (type: string, payload?: unknown) => Promise<any>;
type Layout = "cards" | "list";
type Filter = "all" | "bound" | "unbound" | "quiet";
type Sort = "recent" | "name" | "turns" | "team";
type Template = {
  id: string; name: string; avatar?: string; avatarClass?: string; line: string; capability?: string;
  routine?: { kind: string; name?: string; atHour?: number; everyMs?: number } | null;
};

const HOUR = 3_600_000;

const timeAgo = (ts: number | undefined, now: number) => {
  if (!ts) return "—";
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return "刚刚";
  if (diff < HOUR) return `${Math.round(diff / 60_000)} 分钟`;
  if (diff < 24 * HOUR) return `${Math.round(diff / HOUR)} 小时`;
  return `${Math.round(diff / (24 * HOUR))} 天`;
};

/**
 * 机器人（配置页）——和「项目」同一套结构：一个主 surface，卡片 / 列表两种排布。
 *
 * 这里管的是**身份与出场规则**：名字、头像、职责、能力档位、绑的执行体、日程、配额、暂停 / 静音。
 * 说话本身在会话里（点「打开会话」进控制台），不在这一页复制第二条时间线。
 */
export function Bots({ state, act, notify, now, onOpenBot }: {
  state: State;
  act: Act;
  notify: (m: string) => void;
  now: number;
  /** 打开某个机器人的会话（控制台） */
  onOpenBot: (botId: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [layout, setLayout] = useState<Layout>(() => {
    try { return localStorage.getItem("ymh.bots.layout") === "list" ? "list" : "cards"; } catch { return "cards"; }
  });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [creating, setCreating] = useState("");
  const [undo, setUndo] = useState<UndoAction | null>(null);
  useEffect(() => { try { localStorage.setItem("ymh.bots.layout", layout); } catch { /* ignore */ } }, [layout]);

  const capLabel = (cap?: string) => t(`cap.${cap || "read"}`, CAP_LABEL[cap || "read"] || "只读");
  const bots = state.bots ?? [];
  const turns = state.botTurns ?? [];
  const routines = state.routines ?? [];
  const agents = state.agents ?? [];

  const lastTurnOf = (botId: string): BotTurn | null => {
    let out: BotTurn | null = null;
    for (const t of turns) if (t.botId === botId && (!out || t.createdAt > out.createdAt)) out = t;
    return out;
  };
  const turnsThisHour = (botId: string) => turns.filter((t) => t.botId === botId && t.createdAt > now - HOUR && t.decision !== "silent").length;

  /** 下一次会自己开口的时间：取最近的一条启用日程（没有日程就是 null） */
  const nextRoutineOf = (botId: string): { at: number; label: string } | null => {
    let best: { at: number; label: string } | null = null;
    for (const r of routines as BotRoutine[]) {
      if (r.botId !== botId || r.enabled === false) continue;
      const at = nextRunAt(r, now);
      if (!at || (best && at >= best.at)) continue;
      best = { at, label: r.name || describeRoutine(r) };
    }
    return best;
  };

  const enriched = bots.map((bot: Bot) => {
    const executor = bot.executorAgentId ? agents.find((a) => a.id === bot.executorAgentId) ?? null : null;
    const last = lastTurnOf(bot.id);
    const muted = Boolean(bot.mutedUntil && bot.mutedUntil > now);
    const paused = bot.status === "paused";
    return {
      bot,
      executor,
      last,
      muted,
      paused,
      next: nextRoutineOf(bot.id),
      items: (state.itemCounts || {})[bot.id] || {},
      mine: routines.filter((r: BotRoutine) => r.botId === bot.id),
      turnsThisHour: turnsThisHour(bot.id),
      state: paused ? t("bots.statePaused", "已暂停") : muted ? t("bots.stateMuted", "静音中") : executor ? t("bots.stateReady", "待命") : t("bots.stateUnbound", "未绑定执行体"),
      stateClass: paused || muted ? "paused" : executor ? "ready" : "unbound",
    };
  });

  const filtered = enriched
    .filter(({ bot, executor }) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const hay = `${bot.name} ${bot.persona?.mission ?? ""} ${executor?.name ?? ""} ${executor?.alias ?? ""}`.toLowerCase();
      return hay.includes(q);
    })
    .filter(({ executor, muted, paused }) => {
      if (filter === "bound") return Boolean(executor);
      if (filter === "unbound") return !executor;
      if (filter === "quiet") return muted || paused;
      return true;
    })
    .sort((a, b) => {
      if (sort === "name") return a.bot.name.localeCompare(b.bot.name, "zh-Hans-CN");
      if (sort === "team") return (a.bot.team || "未分组").localeCompare(b.bot.team || "未分组", "zh-Hans-CN") || a.bot.name.localeCompare(b.bot.name, "zh-Hans-CN");
      if (sort === "turns") return b.turnsThisHour - a.turnsThisHour || (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0);
      return (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0) || a.bot.name.localeCompare(b.bot.name, "zh-Hans-CN");
    });

  const bound = enriched.filter((e) => e.executor).length;
  const speaking = enriched.filter((e) => e.turnsThisHour > 0).length;
  const quiet = enriched.filter((e) => e.muted || e.paused).length;
  const filterLabel = { all: "全部", bound: "已绑定执行体", unbound: "未绑定执行体", quiet: "静音或暂停" }[filter];

  useEffect(() => {
    let alive = true;
    void act("botTemplates")
      .then((rows) => { if (alive) setTemplates(Array.isArray(rows) ? rows : []); })
      .catch(() => { /* 模板拉不到就只留空白入口 */ });
    return () => { alive = false; };
  }, [act]);

  const create = async (templateId?: string) => {
    try {
      setCreating(templateId || "blank");
      const res = templateId
        ? (await act("botCreateFromTemplate", { templateId })) as { bot?: Bot; routine?: unknown } | null
        : { bot: (await act("botSave", { name: "" })) as Bot | null };
      const created = res?.bot;
      if (created?.id) {
        setShowTemplates(false);
        notify(templateId ? `已按模板新建：${created.name}（预置日程默认停用）` : "已新建机器人，去会话里选它改名字与人格");
        onOpenBot(created.id);
      }
    } catch (err) {
      notify(String((err as Error)?.message || err));
    } finally {
      setCreating("");
    }
  };

  const pause = async (bot: Bot) => {
    try {
      await act("botStatus", { id: bot.id, status: bot.status === "paused" ? "active" : "paused" });
      notify(bot.status === "paused" ? "已恢复" : "已暂停");
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  };

  const mute = async (bot: Bot, minutes: number) => {
    try {
      await act("botStatus", { id: bot.id, mutedUntil: minutes > 0 ? now + minutes * 60_000 : 0 });
      notify(minutes > 0 ? `已静音 ${minutes} 分钟` : "已取消静音");
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  };

  const remove = async (bot: Bot) => {
    if (!(await confirmDialog({ danger: true, title: `删除机器人「${bot.name}」？`, desc: "它的回合、会话、日程与群成员会一起删除（已建的任务保留）。删除后 6 秒内可以撤销。" }))) return;
    try {
      await act("botRemove", { id: bot.id });
      notify("机器人已删除");
      setUndo({ label: `已删除「${bot.name}」`, run: () => act("botUndoRemove") });
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  };

  /** 批量操作：四个 bot 不用逐个点（低频，收进 ⋯） */
  const bulk = async (kind: "pause" | "resume" | "mute") => {
    const list = filtered.map((e) => e.bot);
    if (!list.length) return;
    try {
      for (const bot of list) {
        if (kind === "pause") await act("botStatus", { id: bot.id, status: "paused" });
        else if (kind === "resume") await act("botStatus", { id: bot.id, status: "active", mutedUntil: 0 });
        else await act("botStatus", { id: bot.id, mutedUntil: now + 60 * 60_000 });
      }
      notify(kind === "pause" ? `已暂停 ${list.length} 个` : kind === "resume" ? `已恢复 ${list.length} 个` : `已静音 ${list.length} 个 · 1 小时`);
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  };

  const actionsFor = (e: (typeof enriched)[number]) => (
    <>
      <button className="btn tiny primary" onClick={() => onOpenBot(e.bot.id)}>{t("bots.openChat", "打开会话")}</button>
      <RowMenu title={t("bots.more", "更多机器人操作")}>
        <button onClick={() => onOpenBot(e.bot.id)}>{t("bots.personaRules", "人设、配额与日程")}</button>
        <button onClick={() => void pause(e.bot)}>{e.paused ? t("bots.resume", "恢复主动开口") : t("bots.pause", "暂停主动开口")}</button>
        <button onClick={() => void mute(e.bot, 60)}>{t("bots.mute1h", "静音 1 小时")}</button>
        {e.muted ? <button onClick={() => void mute(e.bot, 0)}>{t("bots.unmute", "取消静音")}</button> : null}
        <button className="danger" onClick={() => void remove(e.bot)}>{t("bots.delete", "删除机器人")}</button>
      </RowMenu>
    </>
  );

  const meta = (e: (typeof enriched)[number]) => {
    const project = (state.projects || []).find((p) => p.id === e.bot.projectId);
    const host = (state.hosts || []).find((h) => h.id === e.bot.hostId);
    return (
      <div className="bot-card-meta">
        <span className="tiny muted ellipsis" title={e.bot.persona?.mission || t("bots.noMission", "还没写职责")}>
          {e.bot.persona?.mission || t("bots.noMission", "还没写职责")}
        </span>
        <span className="tiny faint">
          {t("bots.metaExecutor", "执行体")} {e.executor ? (e.executor.alias || e.executor.name) : t("bots.stateUnbound", "未绑定")}
          {project ? ` · ${t("bots.metaProject", "项目")} ${project.name}` : ""}
          {host ? ` · ${t("bots.metaHost", "主机")} ${host.name}` : ""}
          {e.next ? ` · ${t("bots.next", "下次")} ${new Date(e.next.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })} ${e.next.label}` : (e.mine.length ? ` · ${t("bots.routinesOff", "{n} 条日程（未启用）").replace("{n}", String(e.mine.length))}` : "")}
        </span>
      </div>
    );
  };

  return (
    <div className="page bots-page">
      <PageHeader
        title={t("page.bots")}
        subtitle={bots.length
          ? t("bots.subtitle", "{n} 个机器人 · {b} 个绑定执行体 · {q} 个静音或暂停；人设与出场规则在这里改，说话在会话里")
            .replace("{n}", String(bots.length)).replace("{b}", String(bound)).replace("{q}", String(quiet))
          : t("bots.subtitleEmpty", "还没有机器人；从头建一个，或选一个模板——人设与出场规则在这里改，说话在会话里")}
        actions={<div className="row gap8">
          <Segmented
            ariaLabel="机器人视图"
            value={layout}
            onChange={(id) => setLayout(id as Layout)}
            items={[
              { id: "cards", label: (<><TableIcon size={14} /> {t("action.cards")}</>), title: t("bots.cardsView", "卡片视图") },
              { id: "list", label: (<><ListIcon size={14} /> {t("action.list")}</>), title: t("bots.listView", "列表视图") },
            ]}
          />
          {bots.length > 0 && (
            <RowMenu title={t("bots.bulk", "批量操作")}>
              <button onClick={() => void bulk("pause")}>{t("bots.pauseAll", "全部暂停")}</button>
              <button onClick={() => void bulk("resume")}>{t("bots.resumeAll", "全部恢复")}</button>
              <button onClick={() => void bulk("mute")}>{t("bots.muteAll", "全部静音 1 小时")}</button>
            </RowMenu>
          )}
          <button className="btn primary" onClick={() => setShowTemplates((v) => !v)}>＋ {t("action.newBot")}</button>
        </div>}
      />

      {showTemplates && (
        <section className="panel list-panel" aria-label={t("bots.fromTemplate", "从模板新建")}>
          <div className="list-head">
            <div className="row gap8"><b>{t("bots.fromTemplate", "从模板新建")}</b></div>
            <span className="tiny faint">{t("bots.templateNote", "只预置人格 / 职责 / 一条停用日程；创建后不跟随模板更新")}</span>
          </div>
          {templates.map((tpl) => (
            <div className="bot-auto" key={tpl.id}>
              <div className="bot-auto-main">
                <b>{tpl.avatar || "🤖"} {tpl.name}</b>
                <span className="tiny faint">{tpl.line}</span>
                {tpl.routine && <span className="tiny faint">{t("bots.presetRoutine", "预置日程：{name}（默认停用）").replace("{name}", tpl.routine.name || tpl.routine.kind)}</span>}
              </div>
              <button className="btn tiny primary" disabled={Boolean(creating)} onClick={() => void create(tpl.id)}>{t("bots.useTemplate", "用这个")}</button>
            </div>
          ))}
          <div className="bot-auto">
            <div className="bot-auto-main">
              <b>{t("bots.blankBot", "空白机器人")}</b>
              <span className="tiny faint">{t("bots.blankDesc", "从零开始，先问它要做什么")}</span>
            </div>
            <button className="btn tiny" disabled={Boolean(creating)} onClick={() => void create()}>{t("bots.blank", "空白")}</button>
          </div>
        </section>
      )}

      {bots.length > 0 && (
        <Overview items={[
          { label: t("bots.overviewRobots", "机器人"), value: bots.length },
          { label: t("bots.overviewBound", "绑定执行体"), value: bound },
          { label: t("bots.overviewSpeaking", "本小时开口"), value: speaking, tone: speaking ? "run" : undefined },
          { label: t("bots.overviewUnbound", "待绑定"), value: bots.length - bound },
          { label: t("bots.overviewQuiet", "静音 / 暂停"), value: quiet, active: true },
        ]} />
      )}

      <section className="panel list-panel">
        <div className="list-head">
          <div className="row gap8">
            <b>{t("bots.allRobots", "全部机器人")}</b>
            <span className="tiny faint">{filtered.length}/{bots.length}{filter !== "all" ? ` · ${filterLabel}` : ""}</span>
          </div>
          <div className="list-tools">
            <select className="project-filter" aria-label={t("bots.filter", "筛选机器人")} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">{t("bots.all", "全部")}</option>
              <option value="bound">{t("bots.bindBound", "已绑定执行体")}</option>
              <option value="unbound">{t("bots.bindUnbound", "未绑定执行体")}</option>
              <option value="quiet">{t("bots.bindQuiet", "静音或暂停")}</option>
            </select>
            <select className="project-filter" aria-label={t("bots.sort", "机器人排序")} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="recent">{t("bots.sortRecent", "最近开口")}</option>
              <option value="name">{t("bots.sortName", "名称")}</option>
              <option value="turns">{t("bots.sortTurns", "本小时开口")}</option>
              <option value="team">{t("bots.sortTeam", "团队")}</option>
            </select>
            <input
              className="project-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("bots.searchPlaceholder", "搜索名字 / 职责 / 执行体")}
              aria-label="搜索机器人"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            compact
            title={query ? t("bots.noMatchTitle", "没有匹配的机器人") : t("bots.emptyTitle", "还没有机器人")}
            desc={query ? t("bots.noMatchDesc", "换个关键词试试。") : t("bots.emptyDesc", "建一个机器人，给它写职责、绑执行体，它就会按出场规则自己开口。")}
            action={!query ? <button className="btn primary" onClick={() => setShowTemplates(true)}>＋ {t("bots.emptyAction", "新建机器人")}</button> : undefined}
          />
        ) : layout === "cards" ? (
          <div className="bots-grid">
            {filtered.map((e) => (
              <article className="bot-card" key={e.bot.id}>
                <header className="bot-card-head">
                  <span className={`bot-card-avatar ${e.bot.avatarClass || "a"}`}>{e.bot.avatar || e.bot.name.slice(0, 1)}</span>
                  <div className="bot-card-title">
                    <div className="row gap6 wrap">
                      <b className="ellipsis">{e.bot.name}</b>
                      <span className="tag">{capLabel(e.bot.capability)}</span>
                      {e.bot.team && <span className="tag">{e.bot.team}</span>}
                      <span className={`tag bot-state ${e.stateClass}`}>{e.state}</span>
                    </div>
                    {meta(e)}
                  </div>
                </header>

                <div className="bot-card-turn">
                  <span className="tiny faint">{e.last ? hm(e.last.createdAt) : "—"}</span>
                  <span className={`tag ${e.last?.decision === "escalated" ? "warn" : ""}`}>
                    {e.last ? DECISION_LABEL[e.last.decision || ""] || "回合" : "还没有回合"}
                  </span>
                  <span className="tiny muted ellipsis" title={e.last?.reason || e.last?.reply || ""}>
                    {e.last?.reason || e.last?.reply || "等着你给它派活"}
                  </span>
                </div>

                <footer className="bot-card-foot">
                  <span className="tiny faint">
                    本小时 {e.turnsThisHour} 条 · 最近 {timeAgo(e.last?.createdAt, now)}前
                    {Number(e.items.needsYou) > 0 ? ` · 待你决定 ${e.items.needsYou}` : ""}
                  </span>
                  <div className="project-actions">{actionsFor(e)}</div>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="list-rows">
            {filtered.map((e) => (
              <div className="list-item" key={e.bot.id}>
                <div className="list-main">
                  <span className={`bot-card-avatar ${e.bot.avatarClass || "a"}`}>{e.bot.avatar || e.bot.name.slice(0, 1)}</span>
                  <div className="list-title">
                    <div className="row gap6 wrap">
                      <b className="ellipsis">{e.bot.name}</b>
                      <span className="tag">{capLabel(e.bot.capability)}</span>
                      {e.bot.team && <span className="tag">{e.bot.team}</span>}
                      <span className={`tag bot-state ${e.stateClass}`}>{e.state}</span>
                    </div>
                    {meta(e)}
                  </div>
                </div>
                <div className="list-stats">
                  <span><b>{e.turnsThisHour}</b>本小时</span>
                  <span><b>{e.mine.length}</b>日程</span>
                  <span><b>{e.executor ? 1 : 0}</b>执行体</span>
                </div>
                {Number(e.items.needsYou) > 0 && (
                  <span className="tiny faint">待你决定 {e.items.needsYou}</span>
                )}
                <span className="list-time tiny faint">最近 {timeAgo(e.last?.createdAt, now)}前</span>
                <div className="project-actions">{actionsFor(e)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
      <UndoBar action={undo} onDone={() => setUndo(null)} />
    </div>
  );
}
