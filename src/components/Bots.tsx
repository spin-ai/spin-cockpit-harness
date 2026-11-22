import { useEffect, useState } from "react";
import type { Bot, BotRoutine, BotTurn, State } from "../types";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { RowMenu } from "./RowMenu";
import { Overview } from "./Overview";
import { useT } from "../i18n";
import { Segmented } from "./Tabs";
import { ListIcon, TableIcon } from "./Icons";

type Act = (type: string, payload?: unknown) => Promise<any>;
type Layout = "cards" | "list";
type Filter = "all" | "bound" | "unbound" | "quiet";
type Sort = "recent" | "name" | "turns";

const CAP_LABEL: Record<string, string> = { read: "只读", dispatch: "可起任务", work: "能执行" };
const DECISION_LABEL: Record<string, string> = {
  answered: "主动开口", replied: "回复", reported: "汇报", asked: "先问一句",
  silent: "沉默", blocked: "被拦", escalated: "转人工", watching: "监视中",
  streaming: "生成中", interrupted: "被打断",
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

const hm = (ts: number | undefined) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
  useEffect(() => { try { localStorage.setItem("ymh.bots.layout", layout); } catch { /* ignore */ } }, [layout]);

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
      mine: routines.filter((r: BotRoutine) => r.botId === bot.id),
      turnsThisHour: turnsThisHour(bot.id),
      state: paused ? "已暂停" : muted ? "静音中" : executor ? "待命" : "未绑定执行体",
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
      if (sort === "turns") return b.turnsThisHour - a.turnsThisHour || (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0);
      return (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0) || a.bot.name.localeCompare(b.bot.name, "zh-Hans-CN");
    });

  const bound = enriched.filter((e) => e.executor).length;
  const speaking = enriched.filter((e) => e.turnsThisHour > 0).length;
  const quiet = enriched.filter((e) => e.muted || e.paused).length;
  const filterLabel = { all: "全部", bound: "已绑定执行体", unbound: "未绑定执行体", quiet: "静音或暂停" }[filter];

  const create = async () => {
    try {
      const created = (await act("botSave", { name: "" })) as Bot | null;
      if (created?.id) {
        notify("已新建机器人，去会话里选它改名字与人格");
        onOpenBot(created.id);
      }
    } catch (err) {
      notify(String((err as Error)?.message || err));
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
    if (!window.confirm(`删除机器人「${bot.name}」？回合记录与日程会一起删除，已建的任务保留。`)) return;
    try {
      await act("botRemove", { id: bot.id });
      notify("机器人已删除");
    } catch (err) {
      notify(String((err as Error)?.message || err));
    }
  };

  const actionsFor = (e: (typeof enriched)[number]) => (
    <>
      <button className="btn tiny-btn primary" onClick={() => onOpenBot(e.bot.id)}>打开会话</button>
      <RowMenu title="更多机器人操作">
        <button onClick={() => onOpenBot(e.bot.id)}>人设、配额与日程</button>
        <button onClick={() => void pause(e.bot)}>{e.paused ? "恢复主动开口" : "暂停主动开口"}</button>
        <button onClick={() => void mute(e.bot, 60)}>静音 1 小时</button>
        {e.muted ? <button onClick={() => void mute(e.bot, 0)}>取消静音</button> : null}
        <button className="danger" onClick={() => void remove(e.bot)}>删除机器人</button>
      </RowMenu>
    </>
  );

  const meta = (e: (typeof enriched)[number]) => (
    <div className="bot-card-meta">
      <span className="tiny muted ellipsis" title={e.bot.persona?.mission || "还没写职责"}>
        {e.bot.persona?.mission || "还没写职责"}
      </span>
      <span className="tiny faint">
        执行体 {e.executor ? (e.executor.alias || e.executor.name) : "未绑定"}
        {e.mine.length ? ` · ${e.mine.length} 条日程` : ""}
      </span>
    </div>
  );

  return (
    <div className="page bots-page">
      <PageHeader
        title={t("page.bots")}
        subtitle={`${bots.length} 个机器人 · ${bound} 个绑定执行体 · ${quiet} 个静音或暂停；人设与出场规则在这里改，说话在会话里`}
        actions={<div className="row gap8">
          <Segmented
            ariaLabel="机器人视图"
            value={layout}
            onChange={(id) => setLayout(id as Layout)}
            items={[
              { id: "cards", label: (<><TableIcon size={12} /> {t("action.cards")}</>), title: "卡片视图" },
              { id: "list", label: (<><ListIcon size={12} /> {t("action.list")}</>), title: "列表视图" },
            ]}
          />
          <button className="btn primary" onClick={() => void create()}>＋ {t("action.newBot")}</button>
        </div>}
      />

      <Overview items={[
        { label: "机器人", value: bots.length },
        { label: "绑定执行体", value: bound },
        { label: "本小时开口", value: speaking, tone: speaking ? "run" : undefined },
        { label: "待绑定", value: bots.length - bound },
        { label: "静音 / 暂停", value: quiet, active: true },
      ]} />

      <section className="panel list-panel">
        <div className="list-head">
          <div className="row gap8">
            <b>全部机器人</b>
            <span className="tiny faint">{filtered.length}/{bots.length}{filter !== "all" ? ` · ${filterLabel}` : ""}</span>
          </div>
          <div className="list-tools">
            <select className="project-filter" aria-label="筛选机器人" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">全部</option>
              <option value="bound">已绑定执行体</option>
              <option value="unbound">未绑定执行体</option>
              <option value="quiet">静音或暂停</option>
            </select>
            <select className="project-filter" aria-label="机器人排序" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="recent">最近开口</option>
              <option value="name">名称</option>
              <option value="turns">本小时开口</option>
            </select>
            <input
              className="project-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名字 / 职责 / 执行体"
              aria-label="搜索机器人"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            compact
            title={query ? "没有匹配的机器人" : "还没有机器人"}
            desc={query ? "换个关键词试试。" : "建一个机器人，给它写职责、绑执行体，它就会按出场规则自己开口。"}
            action={!query ? <button className="btn primary" onClick={() => void create()}>＋ 新建机器人</button> : undefined}
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
                      <span className="tag">{CAP_LABEL[e.bot.capability || "read"] || "只读"}</span>
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
                  <span className="tiny faint">本小时 {e.turnsThisHour} 条 · 最近 {timeAgo(e.last?.createdAt, now)}前</span>
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
                      <span className="tag">{CAP_LABEL[e.bot.capability || "read"] || "只读"}</span>
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
                <span className="list-time tiny faint">最近 {timeAgo(e.last?.createdAt, now)}前</span>
                <div className="project-actions">{actionsFor(e)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
