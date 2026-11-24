#!/usr/bin/env node
/**
 * bot 自测入口：只负责按顺序加载各不变量，然后汇总。
 *
 * 每个不变量一个文件（`tests/bot/*.test.mjs`）——失败时文件名就说清是哪条坏了，
 * 不用在一个 700 行的文件里翻。新增不变量就新建一个文件，在这里加一行 import。
 *
 * 用法：node tests/bot/run.mjs（或 npm test -- bot）
 */
import { report } from "./_harness.mjs";

const suites = [
  "./seed.test.mjs",      // 不预置演示 bot / 老库清理 / 新建带 intro
  "./lifecycle.test.mjs", // 删机器人（清干净 + 撤销）/ 清空会话
  "./gates.test.mjs",     // 静音 / 间隔 / 条数 / token / 打分 / 候选
  "./prompt.test.mjs",    // 人格卡 + 记忆正文 + 主动说过的话
  "./reply.test.mjs",     // 被动回复：流式、取消、SSE
  "./dispatch.test.mjs",  // 能力档位：只产 proposal
  "./guard.test.mjs",     // 脱敏 / 防重复 / 敏感词
  "./notify.test.mjs",    // 通知节流
  "./quiet.test.mjs",     // 静默标记：NO_REPLY 装饰 / 被点名保留正文 / 不通知
  "./routine.test.mjs",   // 日程判定 / 落点
  "./ask.test.mjs",       // 提问卡片
  "./thread.test.mjs",    // 持续 chat：镜像 / 迁移
  "./resume.test.mjs",    // 半截落盘 / 重启收尾
  "./memory.test.mjs",    // 真实记忆库接线
  "./tools.test.mjs",     // 工具表 / 职责卡 / 工具循环上限与循环保护
  "./workspace.test.mjs", // 工作区只读：路径 jail / 二进制 / 搜索跳过依赖
  "./handoff.test.mjs",   // 工作区交接：长期关系 / 项目绑定 / 上下文 / 交回
  "./bridge.test.mjs",    // 机器人 ↔ 执行体双向：回话落 noted / 进 system / 过期不喂 / 不污染监视
  "./soul.test.mjs",      // SOUL.md 镜像：职责 / Never / 能力 / 空字段
  "./group.test.mjs",     // 群聊路由：@ 解析 / 投递 / 回复唤醒 / 共享上下文
  "./mail.test.mjs",      // 群内同事消息：待回复过滤 / prompt / 截断
  "./context.test.mjs",   // 上下文预算 / 长对话压缩 / 温度与工具签名
  "./tidy.test.mjs",      // 记忆整理：80% 才给候选 / 只归档可恢复
  "./templates.test.mjs",  // 内置模板：人格 / 职责 / 日程成品可用
  "./skills.test.mjs",     // 技能包：id / 正文 / 注入上限 / 未知 id
  "./github.test.mjs",     // GitHub 事件：解析 / 去重 / TTL
  "./webhook.test.mjs",    // Webhook 入站：token / 事件 / 去重键
  "./redact.test.mjs",     // 密钥封口：入参 / 结果 / 链接三类，trace 命中 0
  "./items.test.mjs",      // Items 台账：状态机 / ask / snooze / stale / 分页 / 编号
  "./patch.test.mjs",      // 作用域增量：patch < 全量 5% / 500ms 合并 / 按 id 合并
  "./memory-lines.test.mjs", // 记忆行模型：一行一条 / from / 200 行上限 / 未载入提示
];

for (const file of suites) await import(file);
report("Bot");
