/**
 * Items：机器人自己的工作台账（P0-3，借 ORCA 的 `bot-items*`，但不抄它的独立库）。
 *
 * 为什么不是聊天里翻昨天：
 *  - 「需要你决定」分散在多个会话的回合里，切走就看不到；
 *  - 没有 Waiting：等 CI / 等 review 和等你拍板混在一起；
 *  - 没有稳定编号，「这条活到今天什么状态」只能复述聊天。
 *
 * 口径（照抄的部分）：
 *  - 状态机 `planned / working / waiting / needs_you / done / canceled`；
 *  - `waiting` 必须写清在等什么（CI / review / 配额），`needs_you` 只等主人；
 *  - ask = 一条普通评论 + 最多 5 个问题 × 8 个选项，`recommended` 标建议，`multi` 允许多选；
 *  - 答案就是一条普通评论；snooze（later / tomorrow / monday / week，上限 366 天）；
 *  - `stale` 3 / 5 / 7 / 14 / never；分页 50（最多 100）。
 *
 * 不抄：独立 SQLite 文件 + `user_version` 迁移 + 只读降级、`mail` 列与跨会话投递、
 * `item_waiting_asks` 侧表、手机端页面。DB 仍是唯一事实源，表就在 `harness.db` 里。
 *
 * 这一层只碰 `store.state` 上的三个数组（`botItems` / `botItemLinks` / `botItemEvents`），
 * 不 import electron：`tests/bot/items.test.mjs` 拿一个假 store 就能测完状态机与分页。
 */
import { safeLink } from "../redact.mjs";

export const ITEM_STATUSES = ["planned", "working", "waiting", "needs_you", "done", "canceled"];
export const ITEM_STATUS_LABEL = {
  planned: "计划中", working: "在做", waiting: "等外部", needs_you: "等你决定", done: "已完成", canceled: "已取消",
};
/** 还开着的状态（出现在列表与计数里） */
export const ITEM_OPEN_STATUSES = ["planned", "working", "waiting", "needs_you"];
export const ITEM_LINK_KINDS = ["dispatch", "pr", "url", "file"];
export const ITEM_PAGE_SIZE = 50;
export const ITEM_PAGE_MAX = 100;
export const ITEM_TITLE_MAX = 120;
export const ITEM_BODY_MAX = 4000;
export const ITEM_ASK_QUESTIONS_MAX = 5;
export const ITEM_ASK_OPTIONS_MAX = 8;
export const ITEM_LINKS_MAX = 6;
export const ITEM_EVENTS_KEEP = 2000;
export const ITEM_SNOOZE_MAX_MS = 366 * 24 * 60 * 60 * 1000;
export const ITEM_STALE_DAYS = [3, 5, 7, 14];
const DAY = 24 * 60 * 60 * 1000;

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** 一条 item 的稳定短编号：#1 #2 …（每个 bot 各自从 1 开始） */
export const itemLabel = (item) => (item?.seq ? `#${item.seq}` : String(item?.id || ""));

/** 这条 item 现在是不是「该催了」：开着的状态里太久没动 */
export function isStale(item, now = Date.now()) {
  if (!item || !ITEM_OPEN_STATUSES.includes(item.status)) return false;
  const days = Number(item.stale) || 0;
  if (!days) return false;
  return now - (Number(item.updatedAt) || Number(item.createdAt) || 0) > days * DAY;
}

/** snoozed：到点前不进「等你决定」的计数，也不出现在默认列表里 */
export function isSnoozed(item, now = Date.now()) {
  return Boolean(item?.snoozeUntil) && Number(item.snoozeUntil) > now;
}

/**
 * snooze 的口径（Later 1 小时 / Tomorrow 9 / Monday 9 / In a week），上限 366 天。
 * 不认识的写法就报错——静默变成「没 snooze」会让提醒突然冒出来。
 */
export function snoozeUntil(kind, now = Date.now()) {
  const raw = String(kind ?? "").trim().toLowerCase();
  if (!raw) return 0;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const at = new Date(raw).getTime();
    if (!Number.isFinite(at) || at <= now) return -1;
    return Math.min(at, now + ITEM_SNOOZE_MAX_MS);
  }
  const map = { later: 60 * 60 * 1000, tomorrow: 0, monday: 0, week: 7 * DAY, "in a week": 7 * DAY };
  const fixedHour = (offsetDays, hour) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  let at = 0;
  if (raw === "later") at = now + map.later;
  else if (raw === "tomorrow") at = fixedHour(1, 9);
  else if (raw === "monday") {
    const day = new Date(now).getDay(); // 0=周日
    const ahead = day === 1 ? 7 : (8 - day) % 7 || 7;
    at = fixedHour(ahead, 9);
  } else if (raw === "week" || raw === "in a week") at = fixedHour(7, 9);
  else return -1;
  return Math.min(at, now + ITEM_SNOOZE_MAX_MS);
}

/** 把模型给的链接整成 { kind, ref, title }；凭据形状的 URL 直接拒收（见 P0-2） */
export function normalizeLink(input) {
  const raw = input && typeof input === "object" ? input : { url: input };
  const kind = String(raw.kind || "url").trim().toLowerCase();
  if (!ITEM_LINK_KINDS.includes(kind)) return { ok: false, error: `链接类型只能是 ${ITEM_LINK_KINDS.join(" / ")}` };
  const ref = String(raw.ref || raw.url || "").trim().slice(0, 500);
  if (!ref) return { ok: false, error: "链接不能为空" };
  if (kind !== "file" && /^https?:\/\//i.test(ref) && !safeLink(ref)) {
    return { ok: false, error: "这个链接里带凭据（token / signature …），拒收：换成不带 token 的地址" };
  }
  return { ok: true, link: { kind, ref, title: clip(raw.title || "", 120) } };
}

/**
 * ask：一条问题卡片。`{ context, questions: [{ text, options: [{label, recommended}], multi }] }`
 * 也接受更短的写法：`questions: ["要不要合？"]`、`options: ["是","否"]`（套在第一个问题上）。
 */
export function normalizeAsk(input) {
  if (input == null) return { ok: true, ask: null };
  const raw = typeof input === "string" ? { context: input } : (input && typeof input === "object" ? input : {});
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : (raw.text ? [raw] : []);
  if (!rawQuestions.length) {
    if (!String(raw.context || "").trim()) return { ok: false, error: "ask 至少要有一个问题" };
    return { ok: false, error: "ask 需要 questions（问题列表）" };
  }
  if (rawQuestions.length > ITEM_ASK_QUESTIONS_MAX) return { ok: false, error: `ask 最多 ${ITEM_ASK_QUESTIONS_MAX} 个问题` };
  const questions = [];
  for (const q of rawQuestions) {
    const text = clip(typeof q === "string" ? q : q?.text ?? q?.q ?? "", 300);
    if (!text) return { ok: false, error: "ask 的问题不能为空" };
    const rawOptions = (typeof q === "object" && Array.isArray(q?.options) ? q.options : (questions.length === 0 && Array.isArray(raw.options) ? raw.options : []));
    if (rawOptions.length > ITEM_ASK_OPTIONS_MAX) return { ok: false, error: `每个问题最多 ${ITEM_ASK_OPTIONS_MAX} 个选项` };
    const options = rawOptions.map((o) => {
      const label = clip(typeof o === "string" ? o : o?.label ?? o?.text ?? "", 80);
      return { label, recommended: Boolean(typeof o === "object" && (o?.recommended || o?.isRecommended)) };
    }).filter((o) => o.label);
    if (options.filter((o) => o.recommended).length > 1) return { ok: false, error: "每个问题只能标一个 recommended" };
    questions.push({ text, options, multi: Boolean(typeof q === "object" && q?.multi) });
  }
  return {
    ok: true,
    ask: {
      context: clip(raw.context || "", 1000),
      questions,
      multi: Boolean(raw.multi),
      status: "open",
      answer: "",
      askedAt: 0,
      answeredAt: 0,
    },
  };
}

/**
 * 校验一条新 item（不落库）。返回 `{ ok, item }` 或 `{ ok: false, error, code }`。
 * `code` 给 UI / 工具用（不必让模型猜为什么被拒）。
 */
export function normalizeItem(input = {}, { botId = "", seq = 1, now = Date.now() } = {}) {
  const title = clip(input.title, ITEM_TITLE_MAX);
  if (!title) return { ok: false, code: "item_title", error: "title 不能为空（一句话说清这条活）" };
  const status = String(input.status || "planned").trim().toLowerCase();
  if (!ITEM_STATUSES.includes(status)) return { ok: false, code: "item_status", error: `status 只能是 ${ITEM_STATUSES.join(" / ")}` };
  const waitingOn = clip(input.waitingOn ?? input.waiting_on ?? "", 200);
  if (status === "waiting" && !waitingOn) {
    return { ok: false, code: "item_waiting_on", error: "status=waiting 必须写 waiting_on：在等什么（CI / review / 配额）" };
  }
  const staleRaw = input.stale;
  let stale = 0;
  if (staleRaw != null && staleRaw !== "" && staleRaw !== "never" && staleRaw !== "0") {
    const days = Number(staleRaw);
    if (!ITEM_STALE_DAYS.includes(days)) return { ok: false, code: "item_stale", error: `stale 只能是 ${ITEM_STALE_DAYS.join(" / ")} / never（天）` };
    stale = days;
  }
  const askRes = normalizeAsk(input.ask);
  if (!askRes.ok) return { ok: false, code: "item_ask", error: askRes.error };
  if (askRes.ask) askRes.ask.askedAt = now;
  const links = [];
  for (const rawLink of (Array.isArray(input.links) ? input.links : []).slice(0, ITEM_LINKS_MAX)) {
    const res = normalizeLink(rawLink);
    if (!res.ok) return { ok: false, code: "item_link", error: res.error };
    links.push(res.link);
  }
  return {
    ok: true,
    item: {
      id: "",
      botId: String(botId || ""),
      seq,
      title,
      body: String(input.body || "").slice(0, ITEM_BODY_MAX),
      status,
      waitingOn,
      stale,
      snoozeUntil: 0,
      ask: askRes.ask,
      createdAt: now,
      updatedAt: now,
      closedAt: ITEM_OPEN_STATUSES.includes(status) ? 0 : now,
    },
    links,
  };
}

/**
 * 改一条 item。返回 `{ ok, item, changed, events }`；`changed` 是字段名数组（空 = 没变化）。
 * 完成 / 取消只改自己的台账，不动任何审批状态（reviewed / 合并仍归人）。
 */
export function applyItemSet(item, patch = {}, { now = Date.now() } = {}) {
  if (!item) return { ok: false, code: "item_missing", error: "找不到这条 item" };
  const changed = [];
  const events = [];
  const next = { ...item };
  const status = String(patch.status || "").trim().toLowerCase();
  if (status && status !== next.status) {
    if (!ITEM_STATUSES.includes(status)) return { ok: false, code: "item_status", error: `status 只能是 ${ITEM_STATUSES.join(" / ")}` };
    const waitingOn = clip(patch.waitingOn ?? patch.waiting_on ?? next.waitingOn ?? "", 200);
    if (status === "waiting" && !waitingOn) {
      return { ok: false, code: "item_waiting_on", error: "status=waiting 必须写 waiting_on：在等什么（CI / review / 配额）" };
    }
    next.status = status;
    next.waitingOn = waitingOn;
    next.closedAt = ITEM_OPEN_STATUSES.includes(status) ? 0 : now;
    if (!next.closedAt) next.snoozeUntil = 0; // 重新打开了就不再 snooze
    changed.push("status");
    events.push({ kind: "status", text: `状态：${ITEM_STATUS_LABEL[status] || status}` });
  }
  if (patch.title != null) {
    const title = clip(patch.title, ITEM_TITLE_MAX);
    if (!title) return { ok: false, code: "item_title", error: "title 不能为空" };
    if (title !== next.title) { next.title = title; changed.push("title"); }
  }
  if (patch.body != null) {
    const body = String(patch.body).slice(0, ITEM_BODY_MAX);
    if (body !== next.body) { next.body = body; changed.push("body"); }
  }
  if (patch.waitingOn != null || patch.waiting_on != null) {
    const waitingOn = clip(patch.waitingOn ?? patch.waiting_on, 200);
    if (waitingOn !== (next.waitingOn || "") && !changed.includes("status")) { next.waitingOn = waitingOn; changed.push("waitingOn"); }
  }
  if (patch.snooze != null) {
    const at = snoozeUntil(patch.snooze, now);
    if (at < 0) return { ok: false, code: "item_snooze", error: "snooze 只认 later / tomorrow / monday / week / YYYY-MM-DD HH:mm" };
    next.snoozeUntil = at;
    changed.push("snooze");
    events.push({ kind: "snooze", text: at ? `snooze 到 ${new Date(at).toLocaleString("zh-CN", { hour12: false })}` : "取消 snooze" });
  }
  if (patch.stale != null) {
    const raw = patch.stale;
    let stale = 0;
    if (raw !== "never" && raw !== "" && Number(raw) !== 0) {
      const days = Number(raw);
      if (!ITEM_STALE_DAYS.includes(days)) return { ok: false, code: "item_stale", error: `stale 只能是 ${ITEM_STALE_DAYS.join(" / ")} / never（天）` };
      stale = days;
    }
    if (stale !== next.stale) { next.stale = stale; changed.push("stale"); }
  }
  const links = [];
  if (patch.links != null) {
    if (!Array.isArray(patch.links)) return { ok: false, code: "item_link", error: "links 必须是数组" };
    for (const rawLink of patch.links.slice(0, ITEM_LINKS_MAX)) {
      const res = normalizeLink(rawLink);
      if (!res.ok) return { ok: false, code: "item_link", error: res.error };
      links.push(res.link);
    }
    changed.push("links");
  }
  if (!changed.length) return { ok: true, item, changed, events, links };
  next.updatedAt = now;
  return { ok: true, item: next, changed, events, links };
}

/** 计数：只统计开着的；snoozed 的不算「等你决定」 */
export function itemCounts(items = [], now = Date.now()) {
  const out = { planned: 0, working: 0, waiting: 0, needs_you: 0, done: 0, canceled: 0, open: 0, needsYou: 0, stale: 0 };
  for (const item of items) {
    if (!item) continue;
    if (Object.prototype.hasOwnProperty.call(out, item.status)) out[item.status] += 1;
    if (ITEM_OPEN_STATUSES.includes(item.status)) out.open += 1;
    if (item.status === "needs_you" && !isSnoozed(item, now)) out.needsYou += 1;
    if (isStale(item, now)) out.stale += 1;
  }
  return out;
}

/**
 * 分页：50 条一页（最多 100）。排序永远稳定（新→旧），翻页不重排。
 * 默认不含已结束的（done / canceled），要看得显式 includeDone。
 */
export function pageItems(items = [], { page = 1, size = ITEM_PAGE_SIZE, status = "", includeDone = false, now = Date.now() } = {}) {
  const want = String(status || "").trim().toLowerCase();
  const rows = items
    .filter((it) => (want ? it.status === want : includeDone ? true : ITEM_OPEN_STATUSES.includes(it.status)))
    .filter((it) => (want === "needs_you" ? !isSnoozed(it, now) : true))
    .slice()
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  const pageSize = Math.min(Math.max(Number(size) || ITEM_PAGE_SIZE, 1), ITEM_PAGE_MAX);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(Number(page) || 1, 1), pages);
  return {
    rows: rows.slice((current - 1) * pageSize, current * pageSize),
    total: rows.length,
    page: current,
    size: pageSize,
    pages,
  };
}

/** 一次写只发一条通知：事件行（comment / status / snooze / link / created） */
export function itemEvent({ itemId, botId, kind = "comment", text = "", author = "bot", at = Date.now() } = {}) {
  return { id: "", itemId: String(itemId || ""), botId: String(botId || ""), kind, text: String(text).slice(0, 2000), author, at };
}

/* --------------------------------------------------------------- 读写（store） */

/**
 * 在 `store.state.botItems / botItemLinks / botItemEvents` 上读写。
 * 主进程只用一个实例；单测拿假 store 就行（不需要 SQLite）。
 */
export function createItems({ store, now = () => Date.now() } = {}) {
  const stateOf = () => store.state;
  const itemsOf = () => (stateOf().botItems = Array.isArray(stateOf().botItems) ? stateOf().botItems : []);
  const linksOf = () => (stateOf().botItemLinks = Array.isArray(stateOf().botItemLinks) ? stateOf().botItemLinks : []);
  const eventsOf = () => (stateOf().botItemEvents = Array.isArray(stateOf().botItemEvents) ? stateOf().botItemEvents : []);
  const nextId = (prefix) => (typeof store.nextId === "function"
    ? store.nextId(prefix)
    : `${prefix}${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  const persist = () => { try { store.persist?.(); } catch { /* 落盘失败不影响内存态 */ } };

  const mine = (botId) => itemsOf().filter((it) => it.botId === String(botId || ""));
  const find = (botId, ref) => {
    const raw = String(ref ?? "").trim();
    if (!raw) return null;
    const id = raw.replace(/^#/, "");
    return mine(botId).find((it) => it.id === raw || itemLabel(it) === raw || String(it.seq) === id) || null;
  };

  function pushEvent(row) {
    const ev = itemEvent({ ...row, at: now() });
    ev.id = nextId("ie");
    const all = eventsOf();
    all.push(ev);
    if (all.length > ITEM_EVENTS_KEEP) stateOf().botItemEvents = all.slice(-ITEM_EVENTS_KEEP);
    return ev;
  }

  /** 记一条 item（校验 → 落库 → 链接 → 事件） */
  function add({ botId, ...input } = {}) {
    const id = String(botId || "").trim();
    if (!id) return { ok: false, code: "item_bot", error: "缺少 bot 上下文" };
    const seq = mine(id).reduce((max, it) => Math.max(max, Number(it.seq) || 0), 0) + 1;
    const res = normalizeItem(input, { botId: id, seq, now: now() });
    if (!res.ok) return res;
    const item = { ...res.item, id: nextId("it") };
    itemsOf().push(item);
    for (const link of res.links) linksOf().push({ id: nextId("il"), itemId: item.id, ...link, createdAt: now() });
    pushEvent({ itemId: item.id, botId: id, kind: "created", text: `新建：${item.title}` });
    persist();
    return { ok: true, item, links: res.links };
  }

  /** 改一条：状态 / 标题 / 正文 / 等待 / snooze / stale / 链接 */
  function set({ botId, item: ref, ...patch } = {}) {
    const target = find(botId, ref);
    if (!target) return { ok: false, code: "item_missing", error: `找不到 item ${ref || "（空）"}；先 item_list 看编号` };
    const res = applyItemSet(target, patch, { now: now() });
    if (!res.ok) return res;
    if (!res.changed.length) return { ok: true, item: target, changed: [] };
    Object.assign(target, res.item);
    if (res.changed.includes("links")) {
      stateOf().botItemLinks = linksOf().filter((l) => l.itemId !== target.id);
      for (const link of res.links) linksOf().push({ id: nextId("il"), itemId: target.id, ...link, createdAt: now() });
    }
    for (const ev of res.events) pushEvent({ itemId: target.id, botId: target.botId, kind: ev.kind, text: ev.text });
    persist();
    return { ok: true, item: target, changed: res.changed };
  }

  /** 留一条评论（答案也是普通评论：一条普通评论，不是一个新状态机） */
  function comment({ botId, item: ref, text, author = "bot", kind = "comment" } = {}) {
    const target = find(botId, ref);
    if (!target) return { ok: false, code: "item_missing", error: `找不到 item ${ref || "（空）"}` };
    const body = String(text || "").trim().slice(0, 2000);
    if (!body) return { ok: false, code: "item_comment", error: "评论不能为空" };
    target.updatedAt = now();
    // 有人在 comments 里回答 ask：把卡片标成 answered（答案就是这条评论）
    if (kind === "answer" && target.ask) {
      target.ask = { ...target.ask, status: "answered", answer: body.slice(0, 500), answeredAt: now() };
    }
    const ev = pushEvent({ itemId: target.id, botId: target.botId, kind: author === "owner" ? "owner" : kind, text: body, author });
    persist();
    return { ok: true, item: target, event: ev };
  }

  /** 一条 item 的明细（含链接与最近事件），给右栏「待办」用 */
  function get({ botId, item: ref, events = 20 } = {}) {
    const target = find(botId, ref);
    if (!target) return null;
    return {
      ...target,
      label: itemLabel(target),
      staleNow: isStale(target, now()),
      snoozed: isSnoozed(target, now()),
      links: linksOf().filter((l) => l.itemId === target.id),
      events: eventsOf().filter((e) => e.itemId === target.id).slice(-events),
    };
  }

  function list({ botId, status = "", page = 1, size = ITEM_PAGE_SIZE, includeDone = false } = {}) {
    const all = mine(botId);
    const paged = pageItems(all, { page, size, status, includeDone, now: now() });
    return {
      ...paged,
      rows: paged.rows.map((it) => ({
        ...it,
        label: itemLabel(it),
        staleNow: isStale(it, now()),
        snoozed: isSnoozed(it, now()),
        linkCount: linksOf().filter((l) => l.itemId === it.id).length,
      })),
      counts: itemCounts(all, now()),
    };
  }

  const counts = (botId) => itemCounts(mine(botId), now());
  function countsByBot() {
    const out = {};
    for (const item of itemsOf()) {
      out[item.botId] = out[item.botId] || { open: 0, needsYou: 0 };
      const c = itemCounts([item], now());
      out[item.botId].open += c.open;
      out[item.botId].needsYou += c.needsYou;
    }
    return out;
  }

  /** 删掉一个 bot 时把它的台账一起收走（含链接与事件） */
  function removeBot(botId) {
    const id = String(botId || "");
    const ids = new Set(mine(id).map((it) => it.id));
    stateOf().botItems = itemsOf().filter((it) => it.botId !== id);
    stateOf().botItemLinks = linksOf().filter((l) => !ids.has(l.itemId));
    stateOf().botItemEvents = eventsOf().filter((e) => !ids.has(e.itemId) && e.botId !== id);
    persist();
    return { removed: ids.size };
  }

  return { add, set, comment, get, list, counts, countsByBot, removeBot, find: (botId, ref) => find(botId, ref) };
}
