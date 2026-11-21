/**
 * 日程（routine）判定：只管"该不该跑"，不管"怎么跑"。
 *
 * 三类触发，按落地成本排序（先做最便宜的两类）：
 *  - `daily`  每天某个整点跑一次（本地时区，按"今天的这个点"有没有跑过来判）；
 *  - `every`  每隔 N 毫秒跑一次（分钟为单位配置）；
 *  - `watch`  变化才跑：给一个 probe（文件 mtime+size 或命令输出指纹），指纹变了才跑。
 *
 * 为什么不引 cron 库：本项目只需要"每天一次 / 每隔 N 分钟 / 变了才跑"三种，
 * cron 表达式会带来一周 5 天与周序的边界问题，而收益只是让用户写出更复杂的规则
 * （Rakazo 引了 croner 处理 `@once` 与周序，那是它的产品需要）。
 *
 * 全部是纯函数：`probe` 由调用方注入，所以能在不碰文件系统的情况下测。
 */

export const ROUTINE_KINDS = ["daily", "every", "watch"];

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * 落点（Rakazo 的 in-chat / alongside）：
 *  - `alongside`：到点就跑，不等（报告、摘要、提醒——prompt 自己能说清的事）；
 *  - `in-chat`：如果这个 bot 正在回话 / 刚回过话，先等它，别打断（跟进类）。
 *    等满 5 分钟还不空就让给正在跑的那一轮，不能无限等。
 */
export const ROUTINE_MODES = ["alongside", "in-chat"];

export const WAIT_LIMIT_MS = 5 * 60 * 1000;

export const DEFAULT_ROUTINE = {
  kind: "daily",
  mode: "alongside",
  atHour: 9,
  everyMs: 60 * MINUTE,
  watch: { kind: "file", path: "", cmd: "" },
  enabled: true,
  lastFiredAt: 0,
  lastHash: "",
};

export function normalizeRoutine(patch = {}, existing = null) {
  const kind = ROUTINE_KINDS.includes(patch.kind) ? patch.kind : (existing?.kind || "daily");
  const atHour = clampInt(patch.atHour ?? existing?.atHour ?? DEFAULT_ROUTINE.atHour, 0, 23);
  const everyMs = Math.max(1, clampInt(Math.round(Number(patch.everyMs ?? existing?.everyMs ?? DEFAULT_ROUTINE.everyMs) / MINUTE), 1, 7 * 24 * 60)) * MINUTE;
  const watch = { ...DEFAULT_ROUTINE.watch, ...(existing?.watch || {}), ...(patch.watch || {}) };
  return {
    id: String(patch.id || existing?.id || `rt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`),
    name: String(patch.name ?? existing?.name ?? "").slice(0, 40),
    kind,
    atHour,
    everyMs,
    watch: { kind: watch.kind === "cmd" ? "cmd" : "file", path: String(watch.path || "").slice(0, 400), cmd: String(watch.cmd || "").slice(0, 400) },
    mode: ROUTINE_MODES.includes(patch.mode) ? patch.mode : (existing?.mode || "alongside"),
    enabled: patch.enabled === undefined ? (existing?.enabled ?? true) : Boolean(patch.enabled),
    waitingSince: Number(patch.waitingSince ?? existing?.waitingSince ?? 0),
    lastFiredAt: Number(patch.lastFiredAt ?? existing?.lastFiredAt ?? 0),
    lastHash: String(patch.lastHash ?? existing?.lastHash ?? ""),
    lastError: String(patch.lastError ?? existing?.lastError ?? ""),
    createdAt: existing?.createdAt || Number(patch.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

function clampInt(value, lo, hi) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** 今天（本地时区）的 atHour 整点时间戳 */
export function todayAt(hour, now = Date.now()) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/**
 * 该不该跑。
 * @returns {{ due: boolean, reason: string, hash?: string, baseline?: boolean, nextAt?: number|null }}
 */
export function routineDue(routine, { now = Date.now(), probe } = {}) {
  if (!routine) return { due: false, reason: "日程不存在" };
  if (!routine.enabled) return { due: false, reason: "已停用" };

  if (routine.kind === "daily") {
    const slot = todayAt(routine.atHour, now);
    if (now < slot) return { due: false, reason: `今天 ${routine.atHour}:00 还没到`, nextAt: slot };
    if (routine.lastFiredAt >= slot) {
      return { due: false, reason: `今天 ${routine.atHour}:00 已经跑过`, nextAt: slot + DAY };
    }
    return { due: true, reason: `到点（${routine.atHour}:00）`, nextAt: slot + DAY };
  }

  if (routine.kind === "every") {
    const at = (routine.lastFiredAt || 0) + routine.everyMs;
    if (!routine.lastFiredAt) return { due: true, reason: "还没跑过", nextAt: now + routine.everyMs };
    if (now < at) return { due: false, reason: `距上次 ${Math.round((now - routine.lastFiredAt) / MINUTE)} 分钟 < ${Math.round(routine.everyMs / MINUTE)} 分钟`, nextAt: at };
    return { due: true, reason: `距上次 ${Math.round((now - routine.lastFiredAt) / MINUTE)} 分钟`, nextAt: now + routine.everyMs };
  }

  // watch：变化才跑。第一次只建基线（否则"刚配好就误报一次"）
  if (typeof probe !== "function") return { due: false, reason: "没有 watch 探针" };
  if (!routine.watch?.path && !routine.watch?.cmd) return { due: false, reason: "还没设置要看什么" };
  let probed;
  try {
    probed = probe(routine.watch);
  } catch (err) {
    return { due: false, reason: `看不了：${String(err?.message || err).slice(0, 120)}`, nextAt: null };
  }
  if (!probed || !probed.hash) return { due: false, reason: probed?.reason || "探针没有返回指纹", nextAt: null };
  if (!routine.lastHash) return { due: false, reason: "已记录基线（下次变化才跑）", hash: probed.hash, baseline: true, nextAt: null };
  if (probed.hash === routine.lastHash) return { due: false, reason: "没有变化", hash: probed.hash, nextAt: null };
  return { due: true, reason: "内容变了", hash: probed.hash, nextAt: null };
}

/** UI 用：下一次大概什么时候（给不出就 null，不要编） */
export function nextRunAt(routine, now = Date.now()) {
  if (!routine || !routine.enabled) return null;
  if (routine.kind === "daily") {
    const slot = todayAt(routine.atHour, now);
    return routine.lastFiredAt >= slot ? slot + DAY : Math.max(now, slot);
  }
  if (routine.kind === "every") return (routine.lastFiredAt || now) + routine.everyMs;
  return null;
}

/** 一句话描述（UI 列表 / 回合流的 trigger 文案共用） */
export function describeRoutine(routine) {
  if (!routine) return "";
  const base = routine.kind === "daily"
    ? `每天 ${String(routine.atHour).padStart(2, "0")}:00`
    : routine.kind === "every"
      ? `每 ${Math.round(routine.everyMs / MINUTE)} 分钟`
      : (() => {
        const w = routine.watch || {};
        return `变化才跑 · ${w.kind === "cmd" ? `命令 ${w.cmd}` : `文件 ${w.path}`}`;
      })();
  return routine.mode === "in-chat" ? `${base} · 等这一轮` : base;
}
