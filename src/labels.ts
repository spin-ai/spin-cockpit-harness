/** 机器人相关的文案表：能力档位与回合判定。多处共用，别再各写一份。 */

export const CAP_LABEL: Record<string, string> = { read: "只读", dispatch: "可起任务", work: "能执行" };

export const DECISION_LABEL: Record<string, string> = {
  answered: "主动",
  replied: "回复",
  reported: "汇报",
  noted: "收到回话",
  asked: "先问一句",
  watching: "监视中",
  streaming: "生成中",
  interrupted: "被打断",
  silent: "沉默",
  blocked: "被拦",
  escalated: "转人工",
  quiet: "没说什么",
};
