/**
 * 内置技能包：一段可复用的做事方法，跟着 bot 走（不是提示词模板，也不是插件）。
 *
 * 为什么先放代码里：技能的内容需要可审查、可测试；等数量多了再挪到 resources/skills/*.md。
 * bot 只存 `skills: ["status-brief", ...]`，迁到文件时数据不用改。
 */

export const BOT_SKILLS = [
  {
    id: "status-brief",
    name: "状态简报",
    description: "先结论，再事实，最后一句建议；不复述时间线",
    body: [
      "写简报时：",
      "1. 第一句给结论：能发 / 不能发 / 需要你决定。",
      "2. 中间 3–5 条事实，每条带来源（任务编号、运行 id、文件行号）。",
      "3. 最后一句建议；没有异常就只说一句“今天没有异常”。",
      "不要按时间顺序复述发生了什么，也不要用“基本/大概”代替判断。",
    ].join("\n"),
  },
  {
    id: "pr-review",
    name: "代码审查",
    description: "行为变化 / 边界条件 / 测试缺口 / 风险，每条带 file:line",
    body: [
      "审代码时按这个顺序：",
      "1. 行为变化：这段改动让什么行为不一样了？",
      "2. 边界条件：空值、并发、失败重试、权限。",
      "3. 测试缺口：哪条路径没有被覆盖。",
      "4. 风险：数据迁移、兼容性、回滚。",
      "每条给 `file:line`；没有证据的判断标“不确定”；不评论纯风格问题。",
    ].join("\n"),
  },
  {
    id: "release-check",
    name: "发布检查",
    description: "CI / 未审 PR / 阻塞任务 / 回滚 / 监控，缺一项就说阻塞",
    body: [
      "发布前逐项检查：",
      "1. CI 全绿（贴 run id 或失败项）。",
      "2. 未审 PR 为 0。",
      "3. 阻塞任务为 0（列出编号）。",
      "4. 回滚方案已写。",
      "5. 监控已就位。",
      "任何一项不满足，先说“阻塞：X”，不要说“基本可以发”。",
    ].join("\n"),
  },
  {
    id: "incident-notes",
    name: "事故记录",
    description: "时间 + 事实 + 影响 + 动作，一行一条；结束时给 blameless 总结",
    body: [
      "记录事故时：",
      "- 一行一条：时间 / 事实 / 影响 / 动作。",
      "- 只写看到的事实，不写猜测；不确定就标“未确认”。",
      "- 结束时给 blameless 总结：发生了什么、为什么、下次怎么防。",
    ].join("\n"),
  },
  {
    id: "memory-discipline",
    name: "记忆纪律",
    description: "一句一条、优先改写旧条目、不写密钥、不确定标未验证",
    body: [
      "写记忆时：",
      "- 一句一条事实；先搜有没有旧的，能改写就不要追加。",
      "- 不写密钥、令牌、完整路径里的用户名。",
      "- 不确定的写“未验证”，不要伪装成结论。",
      "删除只删自己的；别人的共享记忆不要动。",
    ].join("\n"),
  },
];

const BY_ID = new Map(BOT_SKILLS.map((s) => [s.id, s]));

export function botSkill(id) {
  return BY_ID.get(String(id || "")) || null;
}

/** bot.skills → 技能对象（未知 id 静默丢弃，旧数据不会炸） */
export function skillsFor(ids = []) {
  return (Array.isArray(ids) ? ids : []).map((id) => BY_ID.get(String(id))).filter(Boolean);
}

/** UI 用：不带正文，避免列表变重 */
export function skillSummaries() {
  return BOT_SKILLS.map((s) => ({ id: s.id, name: s.name, description: s.description }));
}
