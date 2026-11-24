/**
 * 「思考档」→ 各网关的推理参数。
 *
 * 为什么需要单独一层：同一个 `effort` 在不同厂商的字段名不一样，
 * 而且**不认这个字段的网关会直接 400**。这里只负责「按模型家族给出安全的那几个字段」，
 * 调用方（bot 的工具循环）在 400 时去掉它们重试一次即可。
 *
 *  - Ark / 豆包（1.6 thinking 系）：`thinking: { type: "disabled" | "enabled" }`
 *  - OpenAI 推理模型（o1/o3/o4/gpt-5）：`reasoning_effort: "minimal" | "low" | "medium" | "high"`
 *  - DeepSeek / 其它：没有可用字段 → 返回空（不要瞎塞）
 */

const ARK = /doubao|(^|[-_./])(seed|ep)-?\d/i;
const OPENAI_REASONING = /(^|[-_/])(o1|o3|o4|gpt-5)([-_.]|$)/i;

/** 模型家族：只用来决定「能不能关思考 / 用哪个字段」，不影响模型选择 */
export function reasoningFamily(model = "") {
  const name = String(model || "").toLowerCase();
  if (!name) return "none";
  if (ARK.test(name)) return "ark";
  if (OPENAI_REASONING.test(name)) return "openai";
  if (/deepseek/.test(name)) return "deepseek";
  return "none";
}

/**
 * 这一档要带哪些字段。`quick` = 尽量关掉思考（首字最快）；
 * `deep` = 明确加大推理；`standard`/空 = 不动（用网关默认，最安全）。
 */
export function reasoningParams({ model = "", effort = "" } = {}) {
  const family = reasoningFamily(model);
  const level = ["quick", "deep"].includes(String(effort || "")) ? String(effort) : "";
  if (family === "ark") {
    if (level === "quick") return { family, fields: { thinking: { type: "disabled" } } };
    if (level === "deep") return { family, fields: { thinking: { type: "enabled" } } };
    return { family, fields: {} };
  }
  if (family === "openai") {
    const effortField = level === "quick" ? "minimal" : level === "deep" ? "high" : "";
    return { family, fields: effortField ? { reasoning_effort: effortField } : {} };
  }
  return { family, fields: {} };
}
