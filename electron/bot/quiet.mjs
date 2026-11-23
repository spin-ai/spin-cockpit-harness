/**
 * 静默标记：一轮「没什么值得说」时，谁都不打扰。
 *
 * 口径抄 ORCA 的 `src/shared/bot-quiet-result.ts`：
 *  - 一轮的最终消息以 `NO_REPLY` 结尾 = 这一轮不值得说；
 *  - 容忍模型给标记加的装饰：`**NO_REPLY**` / `NO_REPLY.` / `> NO_REPLY` / 代码围栏包住；
 *  - **被点名时**（人在直接问它）：标记前面的正文就是回答，要发出去，不能吞掉；
 *  - 正文仍要落库（`bot_turns.decision=quiet` + `reply` 保留），可审计，但不通知、不进未读。
 *
 * 纯函数：不读时钟、不碰 store，`tests/bot/quiet.test.mjs` 直接测。
 * 不抄：ORCA 给 Slack DM 开的特殊分支（我们没有 Slack）。
 */

export const QUIET_MARKER = "NO_REPLY";

/** 写进 system prompt 的规则行（和匹配逻辑同源，改一处就够） */
export const QUIET_INSTRUCTION = `如果这件事不值得现在开口，只输出 ${QUIET_MARKER}（不要解释、不要加别的话）。`;

/** 代码围栏行（``` 或 ```js）本身不是正文 */
const isFenceLine = (line) => /^\s*```[a-zA-Z0-9_-]*\s*$/.test(String(line));

/** 行首的引用 / 列表 / 标题装饰 */
const stripLead = (line) => String(line)
  .replace(/^[\s>#]+/, "")
  .replace(/^[-+•*]\s+/, "")
  .replace(/^[\s`*_~]+/, "")
  .trim();

/**
 * 这一行里标记的位置：返回 { head, tail }。
 * head = 标记前留着的话；tail = 标记后留着的话（非空说明标记只是正文里的提及）。
 */
function splitMarkerLine(line) {
  const m = String(line).match(/NO_REPLY\b[.!。]?/i);
  if (!m) return null;
  const at = m.index ?? 0;
  const head = stripLead(String(line).slice(0, at));
  const tail = String(line).slice(at + m[0].length).replace(/[\s`*_>#~.!。,，;；:：]+/g, "").trim();
  return { head, tail };
}

/**
 * 解析一轮的输出。
 *
 * @param {string} text 模型的最终输出
 * @param {{ addressed?: boolean }} [opts] addressed = 这一轮是人在直接问它（被点名）
 * @returns {{ quiet: boolean, marker: boolean, text: string, body: string }}
 *   `text` 是**该发出去**的正文（quiet 时为空）；`body` 是标记前的原文（审计用）。
 */
export function quietOf(text, { addressed = false } = {}) {
  const raw = String(text ?? "");
  if (!raw.trim()) return { quiet: false, marker: false, text: raw, body: "" };

  const lines = raw.split("\n");
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/NO_REPLY/i.test(lines[i])) { at = i; break; }
  }
  if (at < 0) return { quiet: false, marker: false, text: raw, body: raw };

  const parts = splitMarkerLine(lines[at]);
  if (!parts) return { quiet: false, marker: false, text: raw, body: raw };
  // 标记后面还有话 = 它只是正文里的一处提及，不是「到此为止」
  if (parts.tail) return { quiet: false, marker: false, text: raw, body: raw };

  // 标记前的正文：前面几行（去掉围栏行）+ 同一行里标记之前的字
  const before = lines.slice(0, at).filter((line) => !isFenceLine(line));
  const head = [...before, parts.head]
    .join("\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n");

  // 只有标记：这一轮什么都不说
  if (!head) return { quiet: true, marker: true, text: "", body: "" };
  // 被点名：标记前的正文就是回答，发出去
  if (addressed) return { quiet: false, marker: true, text: head, body: head };
  // 没被点名：标记就是「到此为止」，正文只留审计
  return { quiet: true, marker: true, text: "", body: head };
}

/** 廉价判定：这段输出是不是「没什么要说」 */
export function isQuiet(text, opts = {}) {
  return quietOf(text, opts).quiet;
}
