/**
 * 渲染层只借用 `electron/bot/patch.mjs` 里的纯函数（applyBotPatch / 常量）。
 * 它不碰 fs / electron，可以安全打包进前端；这里补一份最小类型声明，
 * 避免为了一个合并函数把整块主进程类型拉进来。
 *
 * 注意：这个文件不能有顶层 import——`declare module` 通配符只在全局脚本文件里才是环境声明。
 */
declare module "*/electron/bot/patch.mjs" {
  export const BOT_PATCH_MERGE_MS: number;
  export const BOT_PATCH_TURNS: number;
  /** 只替换对应的切片（botTurns / botGroupMessages / botChats / itemCounts），别的字段原样 */
  export function applyBotPatch<T>(state: T, patch: unknown): T;
  export function buildBotPatch(input: Record<string, unknown>): Record<string, unknown> | null;
  export function mergeBotPatch(a: unknown, b: unknown): unknown;
  export function trimTurn(turn: unknown): unknown;
}
