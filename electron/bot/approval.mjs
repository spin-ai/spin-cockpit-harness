/**
 * 审批的时限与「无人值守」判定。
 *
 * 背景：ACP 的 `session/request_permission` 没有超时——没人点就一直挂着，run 停在 `waiting_input`。
 * 有人看着时这不是问题（弹窗就在那儿）；**无人值守**（bot 开着 standing、自己起 run）时必须兜底，
 * 否则那条 run 会永远等一个不会来的人。
 *
 * 口径：
 *  - 有人看着：10 分钟没人处理 → 按拒绝收尾，并在会话里写清原因（可以重跑）。
 *  - 无人值守：3 分钟 → 同上（它本来就不该等人）。
 *  - `COCKPIT_APPROVAL_TIMEOUT_MS` 可覆盖（本地调试 / 测试用）；`0` = 不限时。
 *
 * 纯函数：不读时钟、不碰 store，`tests/bot/approval.test.mjs` 直接测。
 */

export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
export const APPROVAL_TIMEOUT_UNATTENDED_MS = 3 * 60 * 1000;

/** 这一次审批等多久；`override` 来自环境变量（非正数忽略） */
export function approvalTimeoutMs({ unattended = false, override = 0 } = {}) {
  const forced = Number(override);
  if (Number.isFinite(forced) && forced > 0) return forced;
  return unattended ? APPROVAL_TIMEOUT_UNATTENDED_MS : APPROVAL_TIMEOUT_MS;
}

/** 这个任务是不是无人值守：归一个开着 standing 的机器人 */
export function unattendedTodo(todo, bots = []) {
  if (!todo?.botId) return false;
  const bot = (bots || []).find((b) => b.id === todo.botId);
  return Boolean(bot?.policy?.standing?.enabled);
}

/** 无人值守起 run 的前提：这个任务已经设成「本任务放行」，否则每步都会卡在等人批 */
export const UNATTENDED_NEEDS_RELEASE = "无人值守要先把这个任务设成「本任务放行」（审批档），否则每个写操作都会卡在等人批";

/** 超时说明：落在会话里的一句人话 */
export function approvalTimeoutNote({ minutes = 10, unattended = false, title = "" } = {}) {
  const why = unattended ? "无人值守" : "没人处理";
  return `审批超时（${minutes} 分钟${why}）：按拒绝处理${title ? ` · ${title}` : ""}`;
}
