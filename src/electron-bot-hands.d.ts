/**
 * 渲染层借用 `electron/bot/hands.mjs` 里的纯函数（执行链取哪一条 / 哪些状态算活跃）。
 * 和 `electron-bot-patch.d.ts` 同一个理由：它不碰 fs / electron，可以安全打包进前端。
 *
 * 注意：这个文件不能有顶层 import——`declare module` 通配符只在全局脚本文件里才是环境声明。
 */
declare module "*/electron/bot/hands.mjs" {
  export const ACTIVE_RUN_STATUSES: string[];
  /** 这一轮派出去的 todo / run id 集合（时间窗内） */
  export function linkedHands(turns: unknown[], opts?: { botId?: string; now?: number; windowMs?: number }): { todos: Set<string>; runs: Set<string> };
  /** 点停止时应该一起停的 run */
  export function runsToStopForCancel(runs: unknown[], turns: unknown[], opts?: { botId?: string; now?: number; windowMs?: number }): string[];
  /** 界面上的执行链：todo → 最近一次 run（活跃优先） */
  export function handChainForTurn(turn: unknown, opts?: { todos?: unknown[]; runs?: unknown[] }): {
    todo: { id: string; key?: string; title?: string } | null;
    run: { id: string; status: string; startedAt?: number; createdAt?: number } | null;
    todoIds: string[];
    extra: number;
  } | null;
}
