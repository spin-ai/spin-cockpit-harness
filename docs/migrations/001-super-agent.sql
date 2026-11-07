-- ============================================================================
-- Super Agent / Mission 编排 v1 — 迁移草案
-- ============================================================================
-- 状态：DRAFT，未接入 electron/db.mjs 的启动迁移。
-- 目标库：SQLite（sql.js）。
--
-- 说明：
--  1. 应用内迁移应逐条执行并 try/catch 忽略「column already exists」，
--     与 db.mjs 现有迁移风格保持一致；本文件是给实现者的参考 SQL。
--  2. SQLite 不支持 ADD COLUMN IF NOT EXISTS；重复执行本文件会失败。
--  3. 回滚需要恢复迁移前备份；不要在生产库上直接 DROP COLUMN。
--  4. mission 复用 todos 作为容器（kind='mission'），避免一期同时改
--     thread/run/board 三套宿主关系；未来需要跨项目 Mission 时再抽表。
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Agent：从「CLI 运行配置」升级为「运行配置 + 角色」
--    存量 Agent 一律是 worker；supervisor 由用户显式配置。
-- ---------------------------------------------------------------------------
ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'worker';
ALTER TABLE agents ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN max_children INTEGER NOT NULL DEFAULT 4;

-- ---------------------------------------------------------------------------
-- 2. Thread：普通会话 / Mission 会话
--    Mission thread 仍然通过 todo_id 指向 mission todo。
-- ---------------------------------------------------------------------------
ALTER TABLE threads ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';

-- ---------------------------------------------------------------------------
-- 3. Todo：普通任务 / Mission 容器
--    - mission 的 status 继续服务看板；
--    - mission_state 表达 Mission 自己的生命周期；
--    - 子任务继续用 parent_id 指向 mission todo。
-- ---------------------------------------------------------------------------
ALTER TABLE todos ADD COLUMN kind TEXT NOT NULL DEFAULT 'task';
ALTER TABLE todos ADD COLUMN mission_state TEXT;

-- ---------------------------------------------------------------------------
-- 4. Run：worker / supervisor
--    注意：runs.parent_run_id 现有语义是「retry 的上一次 run」，
--    本方案不改它的语义；编排父子关系放在 delegations 表。
-- ---------------------------------------------------------------------------
ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'worker';
ALTER TABLE runs ADD COLUMN delegation_id TEXT;

-- ---------------------------------------------------------------------------
-- 5. 计划：主管提交的计划按 revision 保存，审批后不可原地覆盖
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mission_plans (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | approved | superseded
  plan TEXT NOT NULL DEFAULT '{}',           -- JSON，见 ARCH-super-agent.md
  created_at INTEGER NOT NULL,
  approved_at INTEGER
);

-- ---------------------------------------------------------------------------
-- 6. Delegation：主管和子任务之间的合同
--    子任务本身是 todos 行；child_run_id 指向当前/最近一次 worker run。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delegations (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  supervisor_run_id TEXT NOT NULL,
  child_todo_id TEXT NOT NULL,
  child_run_id TEXT,
  agent_id TEXT NOT NULL,
  plan_step_key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  acceptance TEXT NOT NULL DEFAULT '[]',     -- JSON string[]
  status TEXT NOT NULL DEFAULT 'proposed',   -- proposed | queued | running | waiting_input | completed | accepted | rework | failed | cancelled
  result_summary TEXT NOT NULL DEFAULT '',
  artifacts TEXT NOT NULL DEFAULT '[]',      -- JSON array of artifact refs
  branch TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- ---------------------------------------------------------------------------
-- 7. 索引：按 mission / 主管 run / 状态查询是高频路径
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_delegations_mission ON delegations(mission_id);
CREATE INDEX IF NOT EXISTS idx_delegations_supervisor_run ON delegations(supervisor_run_id);
CREATE INDEX IF NOT EXISTS idx_delegations_child_todo ON delegations(child_todo_id);
CREATE INDEX IF NOT EXISTS idx_delegations_status ON delegations(status);
CREATE INDEX IF NOT EXISTS idx_mission_plans_mission ON mission_plans(mission_id, revision);
CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(parent_id);
CREATE INDEX IF NOT EXISTS idx_runs_todo ON runs(todo_id);
CREATE INDEX IF NOT EXISTS idx_threads_todo ON threads(todo_id);

-- ---------------------------------------------------------------------------
-- 8. Schema 标记（应用迁移完成后写入；便于未来判断是否已迁移）
-- ---------------------------------------------------------------------------
INSERT OR REPLACE INTO meta (k, v) VALUES ('superAgentSchema', '1');

COMMIT;

-- ============================================================================
-- 兼容性检查清单（实现时在 db.mjs 中完成，不依赖本文件）
-- ============================================================================
-- [ ] 旧库：agents/todos/threads/runs 全部获得默认值，现有数据不变。
-- [ ] 旧库：delegations / mission_plans 为空表，不产生孤儿 Mission。
-- [ ] 旧库：runs.parent_run_id 的 retry 语义保持不变。
-- [ ] 新库：CREATE TABLE 与现有 SCHEMA 合并，启动迁移幂等。
-- [ ] 迁移前自动备份 harness.db（至少复制一份 .bak）。
-- [ ] 迁移失败时回滚事务并保持应用可启动（只读降级）。
