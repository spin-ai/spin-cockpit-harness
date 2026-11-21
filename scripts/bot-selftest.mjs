#!/usr/bin/env node
/**
 * bot 自测入口：只负责按顺序加载各不变量，然后汇总。
 *
 * 每个不变量一个文件（`scripts/bot/*.test.mjs`）——失败时文件名就说清是哪条坏了，
 * 不用在一个 700 行的文件里翻。新增不变量就新建一个文件，在这里加一行 import。
 *
 * 用法：node scripts/bot-selftest.mjs（或 npm run bot:selftest）
 */
import { report } from "./bot/_harness.mjs";

const suites = [
  "./bot/gates.test.mjs",     // 静音 / 间隔 / 条数 / token / 打分 / 候选
  "./bot/prompt.test.mjs",    // 人格卡 + 记忆正文 + 主动说过的话
  "./bot/reply.test.mjs",     // 被动回复：流式、取消、SSE
  "./bot/dispatch.test.mjs",  // 能力档位：只产 proposal
  "./bot/guard.test.mjs",     // 脱敏 / 防重复 / 敏感词
  "./bot/notify.test.mjs",    // 通知节流
  "./bot/routine.test.mjs",   // 日程判定 / 落点
  "./bot/ask.test.mjs",       // 提问卡片
  "./bot/thread.test.mjs",    // 持续 chat：镜像 / 迁移
  "./bot/resume.test.mjs",    // 半截落盘 / 重启收尾
  "./bot/memory.test.mjs",    // 真实记忆库接线
];

for (const file of suites) await import(file);
report("Bot");
