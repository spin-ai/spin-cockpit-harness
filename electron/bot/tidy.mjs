/**
 * 记忆整理计划：只归档，不删除。
 *
 * 为什么是「计划 + 人点一下」而不是每天自动删：
 *  - 记忆是长期资产，误删一次就再也找不回来；归档可在记忆页恢复，删除不行。
 *  - 真正该删的是「过期/矛盾」，那属于 Dream 的复核流程；这里只解决「装不下」。
 *
 * 输入是 `memory.inject()` 的 items（每条带 chars / score / pinned / updatedAt）与 usage，
 * 输出要归档的条目；纯函数，单测在 tests/bot/tidy.test.mjs。
 */

export const TIDY_TRIGGER_RATIO = 0.8;
export const TIDY_TARGET_RATIO = 0.6;
export const TIDY_MAX_ARCHIVE = 20;

export function planTidy({
  items = [],
  used = 0,
  budget = 8000,
  target = TIDY_TARGET_RATIO,
  trigger = TIDY_TRIGGER_RATIO,
  max = TIDY_MAX_ARCHIVE,
} = {}) {
  const safeBudget = Math.max(800, Number(budget) || 8000);
  const usedChars = Math.max(0, Number(used) || 0);
  const ratio = usedChars / safeBudget;
  const targetChars = Math.round(safeBudget * Math.max(0.3, Math.min(0.9, Number(target) || TIDY_TARGET_RATIO)));
  const need = Math.max(0, usedChars - targetChars);
  const triggerAt = Math.max(0.5, Math.min(0.95, Number(trigger) || TIDY_TRIGGER_RATIO));
  const ready = ratio >= triggerAt && need > 0;

  // 先动分数最低、最久没更新的；置顶、note 一律不碰（note 有自己的条数上限）
  const candidates = (Array.isArray(items) ? items : [])
    .filter((i) => i && i.included && i.layer !== "note" && !i.pinned && Number(i.chars) > 0)
    .sort((a, b) =>
      (Number(a.score) || 0) - (Number(b.score) || 0) ||
      (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0));

  const picks = [];
  let freed = 0;
  if (ready) {
    const cap = Math.max(1, Math.min(100, Number(max) || TIDY_MAX_ARCHIVE));
    for (const c of candidates) {
      if (freed >= need || picks.length >= cap) break;
      picks.push({
        id: c.id, layer: c.layer, title: c.title,
        chars: Number(c.chars) || 0, score: Number(c.score) || 0,
      });
      freed += Number(c.chars) || 0;
    }
  }

  return {
    ready: ready && picks.length > 0,
    ratio: Math.round(ratio * 100) / 100,
    used: usedChars,
    budget: safeBudget,
    target: targetChars,
    need,
    freed,
    short: ready && picks.length > 0 && freed < need,
    picks,
    reason: ready ? "" : (ratio < triggerAt
      ? `占用 ${Math.round(ratio * 100)}% < ${Math.round(triggerAt * 100)}%`
      : "已经在目标以内"),
  };
}
