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
  "./gates.test.mjs",     // 静音 / 间隔 / 条数 / token / 打分 / 候选
  "./prompt.test.mjs",    // 人格卡 + 记忆正文 + 主动说过的话
  "./reply.test.mjs",     // 被动回复：流式、取消、SSE
  "./dispatch.test.mjs",  // 能力档位：只产 proposal
  "./guard.test.mjs",     // 脱敏 / 防重复 / 敏感词
  "./notify.test.mjs",    // 通知节流
  "./routine.test.mjs",   // 日程判定 / 落点
  "./ask.test.mjs",       // 提问卡片
  "./thread.test.mjs",    // 持续 chat：镜像 / 迁移
  "./resume.test.mjs",    // 半截落盘 / 重启收尾
  "./memory.test.mjs",    // 真实记忆库接线
  "./tools.test.mjs",     // 只读工具循环 / 职责卡 / 写操作闸门
];

for (const file of suites) await import(file);
report("Bot");
