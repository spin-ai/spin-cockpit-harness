/**
 * GitHub 事件（v1）：用本机 `gh` CLI 只读拉 PR / CI 失败，变成 bot 的候选事件。
 *
 * 不引 OAuth、不开 webhook：登录态沿用你已经在 `gh` 里配好的账号；
 * 没装/没登录就静默跳过，不假装有事件。
 */

export const GITHUB_EVENT_TTL = 12 * 60 * 60 * 1000;

/** `gh ... --json` 的输出；坏 JSON 一律当空，不让一轮 tick 崩 */
export function parseGhJson(text) {
  try {
    const value = JSON.parse(String(text || "[]"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/**
 * 把 `gh pr list` / `gh run list` 的结果变成去重行。
 * key 里带 botId 的命名空间由调用方加，这里只产出「事件本身」。
 */
export function eventRowsFromGh({ botId, prs = [], runs = [], now = Date.now() } = {}) {
  const id = (key) => `gh-${String(botId).replace(/[^a-zA-Z0-9_-]/g, "")}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const out = [];
  for (const pr of prs) {
    const number = Number(pr?.number);
    if (!Number.isFinite(number)) continue;
    out.push({
      id: id(`pr-${number}`),
      botId,
      source: "github",
      key: `pr:${number}`,
      title: `PR #${number} 等你 review：${String(pr.title || "").slice(0, 120)}`,
      url: String(pr.url || ""),
      at: now,
      seen: false,
    });
  }
  for (const run of runs) {
    const runId = run?.databaseId ?? run?.id;
    if (runId == null) continue;
    out.push({
      id: id(`ci-${runId}`),
      botId,
      source: "github",
      key: `ci:${runId}`,
      title: `CI 失败：${String(run.workflowName || "workflow").slice(0, 60)} · ${String(run.displayTitle || "").slice(0, 100)}`,
      url: String(run.url || ""),
      at: now,
      seen: false,
    });
  }
  return out;
}

export function isFreshEvent(event, now = Date.now(), ttl = GITHUB_EVENT_TTL) {
  return Boolean(event) && now - (Number(event.at) || 0) <= ttl;
}
