-- ============================================================================
-- 协作场景（Coordination Scene）v1 — 迁移参考
-- ============================================================================
-- 与 electron/db.mjs 的 SCHEMA 同步；实际迁移由启动时的 CREATE TABLE IF NOT EXISTS 完成。
-- 与现有 scenes 表（项目执行配置）无关：scenes 决定「单个任务怎么跑」，
-- coordination_scenes 决定「多个机器人怎么协作、在什么舞台上呈现」。
--
-- config.cast[] 的形状（2026-11-21 起）：
--   { botId, role: lead|worker|reviewer, seat: 0-5|null, displayName? }
--   老数据是 { agentId, ... }，读的时候按 bots.executor_agent_id 反查成 botId；
--   写入只写 botId。舞台人口是机器人，Agent 只是它借的执行体（见 arch/ARCH-bot.md §2.1）。
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS coordination_scenes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '场景',
  project_id TEXT,
  template TEXT NOT NULL DEFAULT 'office',   -- office | warroom | carrier（旧的 factory 读写时迁移为 carrier）
  config TEXT NOT NULL DEFAULT '{}',         -- { cast: [], prefs: {} }
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

COMMIT;
