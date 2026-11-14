-- ============================================================================
-- 协作场景（Coordination Scene）v1 — 迁移参考
-- ============================================================================
-- 与 electron/db.mjs 的 SCHEMA 同步；实际迁移由启动时的 CREATE TABLE IF NOT EXISTS 完成。
-- 与现有 scenes 表（项目执行配置）无关：scenes 决定「单个任务怎么跑」，
-- coordination_scenes 决定「多个 Agent 怎么协作、在什么舞台上呈现」。
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
