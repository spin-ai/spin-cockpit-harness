/**
 * 渲染层只借用 `electron/bot/routine.mjs` 里的纯函数（nextRunAt / describeRoutine 等），
 * 它不碰 fs / electron，所以可以安全打包进前端。这里补一份最小类型声明，
 * 避免为了两个纯函数把整块主进程类型拉进来。
 */
declare module "*/electron/bot/routine.mjs" {
  export type RoutineLike = {
    id?: string;
    name?: string;
    kind?: string;
    atHour?: number;
    everyMs?: number;
    onceAt?: number;
    enabled?: boolean;
    lastFiredAt?: number;
    createdAt?: number;
    prompt?: string;
    mode?: string;
    watch?: { kind?: string; path?: string; cmd?: string };
  };
  export function nextRunAt(routine: RoutineLike, now?: number): number | null;
  export function describeRoutine(routine: RoutineLike): string;
  export function normalizeRoutine(patch?: RoutineLike, existing?: RoutineLike | null): RoutineLike;
  export function routineDue(routine: RoutineLike, opts?: { now?: number; probe?: (watch: unknown) => { hash?: string } | null }): { due: boolean; reason?: string; nextAt?: number | null };
  export function todayAt(hour: number, now?: number): number;
}
