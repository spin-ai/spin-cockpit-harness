> 层：架构 · 状态：部分落地 · 核对：2026-11-23 · 覆盖：机器人工作区交接的数据模型、动作、观察面、UI 与未做边界

# Arch · Bot 工作区交接

> 需求与验收：[`../product/REQ-bot-workspace.md`](../product/REQ-bot-workspace.md)。
> 上游：[`ARCH-bot.md`](ARCH-bot.md)（人格 / 记忆 / 能力 / 触发）、[`ARCH-workbench-execution.md`](ARCH-workbench-execution.md)（Project / Todo / Run / Terminal）、[`ARCH-terminal-ux.md`](ARCH-terminal-ux.md)（pty 生命周期）。
> 参照：`third-part/orca @ 1ab037e`（MIT，本地只读副本，整个 `third-part/` 不入库）。

## 0. 一句话

```text
交接 = 一条长期关系（bot_workspaces） + 一条可审计回合 + 一个可在那里起活的 cwd
```

不是：把当前项目切到 bot、打开 bot 会话、以为它「接手了」。那只是跳转。

---

## 1. 为什么参考 ORCA

ORCA 的 bot 之所以「和 terminal / 项目交接得好」，是因为它把工作区当成 **bot 的资产**，不是一次性的界面状态：

| ORCA 的做法 | 源码锚点（`仓库 @ commit`） | 解决什么 |
|---|---|---|
| bot home 是 hidden Bots project group 里的 folder workspace | `src/main/bots/bot-home.ts`、`src/main/bots/bot-home-workspace.ts:12` | bot 有稳定的 cwd / SOUL.md / MEMORY.md |
| 人点 Hand to bot：**先移动工作区**，再通知；通知失败会搬回去 | `src/shared/bots/hand-over-workspace.ts`（`handOverWorkspace`） | 不留半交接 |
| 交接 turn 带 workspace id、agents、goal；agent 继续跑并改为向 bot 汇报 | `src/shared/bots/bot-take-over.ts:50`–`52` | bot 知道「到哪、问谁、干什么」 |
| bot 用 `worktree ps` / `bot work list` 看工作区、worker、PR、CI | `src/main/bots/bot-preamble.ts:34`、`:38`；`src/shared/bots/bot-work-list.ts:94` | 工作区可见、可追 |
| 代码活交给 worker（新 worktree），bot 自己不看文件 | `src/main/bots/bot-preamble.ts:72` | 观察面与执行面分开 |
| 关标签不结束会话；工区下的 agent approvals 进 bot 的 Needs you | `src/main/bots/bot-session-tabs.ts:25`、`src/main/bots/bot-handed-workspaces.ts` 头部 | 视图 ≠ 进程 ≠ 所有权 |
| item 状态：`planned / working / waiting / needs_you / done / canceled` | `src/shared/bots/bot-items.ts:6`、`bot-item-status-name.ts` | 账本把「等人的」与「等外部」分开 |

我们不完全照搬的三点：

1. **不移动人的目录**：ORCA 把 worktree 挪进 bot home；我们只记关系。移动不可逆、跨项目易踩，交回也麻烦。
2. **不把 bot 变成 agent CLI 会话**：我们的 bot 是「人格 + 上下文 + 工具循环」；执行仍由它绑定的 Agent（ACP / pty worker）承担。
3. **不引入第二套账本**：先用 `bot_workspaces` + 现有 todo / run / bot_turn watching，不新建 item 状态机。

---

## 2. 数据模型

```sql
CREATE TABLE bot_workspaces (
  id TEXT PRIMARY KEY, bot_id TEXT, project_id TEXT, path TEXT, branch TEXT, title TEXT,
  kind TEXT,              -- project | worktree | terminal
  terminal_id TEXT, goal TEXT,
  status TEXT,            -- open | released
  created_at INTEGER, updated_at INTEGER
);
```

| 字段 | 语义 | 不变式 |
|---|---|---|
| `path` | 交出去的绝对路径（realpath） | 同一个 `(bot_id, path)` 最多一条 open |
| `kind` | 项目根 / 独立 worktree / 终端目录 | 项目根交接同时绑 `bots.project_id` |
| `terminal_id` | 从哪条 pty 交过来的（可为空；pty 退出后仍保留） | 只是线索，不是所有权：终端可以关，关系还在 |
| `goal` | 人当时给的一句话目标 | 进 system prompt 与审计行，最多 400 字 |
| `status` | `open` / `released` | 交回不删行；历史可追；再交同路径会复用 released 行（重新 open） |

**为什么单独一张表，不塞进 `bots.persona`**：交接是**多对多**关系（一个 bot 多个工作区，一个路径可以先后交给不同 bot），且需要按路径查询（`task_create` / 工具 root / run 的 worktree 判定）。塞 JSON 会让这三处都要扫描全表。

写入用显式列名（`electron/db.mjs` 的 persist 注释说明了位置插入踩过的坑），往返用例在 `tests/db.test.mjs`「bot_workspaces」。

---

## 3. 动作

### 3.1 交出去（`botHandOffWorkspace`）

```text
项目右键 / 终端右键
  → main：realpath + 目录校验；项目内路径或带 .git 的工作树才接受
  → bots().handOff()：幂等 upsert + 项目根绑 bots.project_id
       + 会话 system 行「〔交接〕…」
       + bot_turns(decision=watching, trigger.kind=handoff)
       + bot_events(bot.workspace.handed)
  → broadcast（不切当前项目、不抢视图）
```

交接时如果这条终端 / 目录上正有在跑的 run：`todos.bot_id` 归这个 bot，并挂一条 `watching`；run 结束时走现有回流路径给 `reported`（**执行体不变**，只是「谁在盯」变了）。

**带新目标时自动开一轮**：`kickoffHandoff()` 以 `trigger.kind=handoff`、`inputRole=none` 调 `bots().reply()`，长 prompt 只留审计、不进对话气泡；重复交同一目录或没目标不触发（不烧 token）。没有模型 key 或 bot 还在 intro 时静默跳过。

### 3.2 看得见（`work_list` + 上下文）

`work_list` 按工作区聚合：

| 块 | 来源 |
|---|---|
| `title / path / branch / kind / goal` | `bot_workspaces` |
| `terminal`：状态 / 标题 / 尾部 600 字 / stalled | `terminalSnapshot()`（pty 活着）或持久化的 `terminals.output_tail` |
| `runs`：最近 3 次的 runId / 任务 / 状态 / 用时 | `runs`（按 cwd 或任务 cwd 匹配） |
| `tasks`：未完成、未确认的任务 | `todos`（按 cwd 匹配） |

`compileContext({ workspaces })` 把同样的清单写成一段 system（最多 8 条），并进 `sectionChars.workspaces`：

```text
交给你的工作区（读文件的 root 可以选它们；建任务时传 workspace=<id> 就在那里起活）：
- demo · 分支 feat/x · worktree · /…/demo · workspace=bw…
```

### 3.3 在那里干活

- **观察面**：`workspace_list / read / grep`、`git_status / log / diff` 增加可选 `workspace` 参数；解析 id / 标题 / 路径，**未知引用直接拒绝**，不静默回退到项目根。
- **建任务**：`task_create` 增加 `workspace`；`cwd = workspace.path`；`todos.projectId = workspace.projectId`；去重键带 cwd（同一标题在另一个工作区不算同一条）。
- **起 run**：`prepareRunWorktree` 命中交接路径时返回 `skipped: "handed-workspace"`，**不再从它派生新 worktree**——人交的就是这条树。
- **无人值守**：`run_start` 不再只认 `bots.project_id`；任务 cwd 命中交接工作区也允许（仍受每小时上限与 standing 开关约束）。
- **给活着的 worker 发话**：`worker_send`（work / dispatch 档）把一句话投进当前 run（复用 `deliverSteer`：pty 直接写入 / ACP 作为下一次 prompt），只允许自己名下的任务或交接工作区里的 run；回复仍要用 `run_log` 读，不假装同步问答。
- **主目录镜像**：`userData/bots/<id>/SOUL.md` 由 `soulMarkdown()` 生成（职责 / 语气 / Never / 能力），和 MEMORY.md 一起在 bot 保存 / 交接 / 交回 / 模板创建 / 恢复历史后刷新；只读镜像，DB 是事实源。

### 3.4 交回来（`botWorkspaceRelease`）

只改关系，不动世界：

1. `status = released`、`updatedAt`；
2. 如果是项目根，且**没有同项目其它 open 工作区**，解绑 `bots.project_id`（并记一版人格历史）；
3. 文件、分支、run、terminal 一个都不动。

再交同一路径：复用历史行重新 `open`，审计不丢。

---

## 4. UI

| 位置 | 形态 | 约束 |
|---|---|---|
| 项目列表右键 | `交给机器人 · <名字>`（有 bot 才可点） | 不新造弹层；不切当前项目、不抢视图 |
| 终端右键菜单 | `交给机器人 · <名字>`（带 cwd / 标题 / 分支 / terminalId） | 与「接管终端 / 关联任务」同一菜单层 |
| Bot 控制台左栏 | 「工作区」一行一条：类型 + 标题 + 目标 + 「打开终端」「目标」「交回」；「已交回 N」可展开历史 | 复用 `.bot-upnext` / `.bot-mem-row` / `.bot-link` / `.bot-exec`，不新增卡片体系；目标行内编辑（不弹 `window.prompt`） |
| Bot 会话 | `〔交接〕…` system 行 | 不进 user 气泡 |

**「打开终端」语义**：有 `terminalId` 且 pty 活着 → `requestTerminalAdopt`；否则 `requestTerminalAt(path)`。终端已退出时不假装接上。

---

## 5. 删除 / 撤销 / 迁移

| 场景 | 行为 |
|---|---|
| 删除 bot | `collectBotData` / `dropBotData` 带上它的 `bot_workspaces`；撤销时一起回来 |
| 旧库升级 | `CREATE TABLE IF NOT EXISTS`；没有历史数据需要迁移（新表从空开始） |
| pty 退出 | 关系不动；`work_list` 的 `terminal` 回落到持久化 tail |
| 项目路径改名 | 校验时 realpath；找不到就拒绝交接，不写一条坏路径 |

---

## 6. 验收

| 判据 | 落点 |
|---|---|
| `(bot, path)` 幂等；项目根绑 `project_id` | `tests/bot/handoff.test.mjs` |
| 工作区进 system prompt 且带 `workspace=` | `tests/bot/handoff.test.mjs` |
| 交回 released + 解绑；删 bot 无孤儿 | `tests/bot/handoff.test.mjs` |
| 表往返不丢字段 | `tests/db.test.mjs`「bot_workspaces」 |
| 工具表仍无 shell / 改文件 / 改设置 | `tests/bot/tools.test.mjs` |
| 设计规范（不新增页面外壳 / 卡片 / 字符图标） | `npm run verify:design` |
| 文档状态头 / 索引 / 内链 | `npm run verify:docs` |

---

## 7. 风险与红线

| 风险 | 应对 |
|---|---|
| 把交接当「授权任意路径」 | 交接由**人**发起；工具侧只认 `bot_workspaces` 里的路径，未知引用拒绝 |
| 一个新 worktree 被误当成项目根 | `kind` 区分；只有项目根交接才绑 `bots.project_id` |
| run 在交接树里并发写 | 同一工作区的 bot 任务按现有队列串行；不并发派活（后续若要并发需显式子 worktree） |
| 交回后它还记得旧路径 | released 行不删；上下文只列 open；`work_list` 只列 open |
| 敏感文件被读 | 仍走 `workspace.mjs` 的 jail + `.env` / 密钥 / 二进制拒绝；交接不放宽这些 |
| 交接后没人说话 | 关系进上下文即可；是否主动开口由 `goal` 与策略决定（见未做） |

---

## 8. 明确未做

1. ~~交接后自动开口~~：已做条件触发（带新目标才开）。
2. **worker mail 的完整回路**：`worker_send` 已能投递，但 worker 的回复不会自动变成 bot 的回合（ORCA 有 `orchestration send` 的双向 mail）；现在是 bot 发完再 `run_log` 读。
3. **bot home 文件夹（memory/ / skills/ + 作为 workspace）**：SOUL.md / MEMORY.md 已是只读镜像；把 home 做成 folder workspace 会牵动 Project / Terminal / Agent 三处，单独一期。
4. **item 状态机（`waiting` vs `needs_you`）**：先复用 todo / 提问卡片 / watching 回合；`work_list` 先把事实看全。
5. **跨机 / 远端工作区**：本机 realpath 校验；远端要等主机执行面统一。
6. **搬移工作区到 bot home**：ORCA 会移动；我们不移动人的目录（见 §1）。
7. **PR / CI 跟着交接工作区进账本**：GitHub 事件目前是 bot 级轮询（`electron/bot/github.mjs`），没有「这条工作区的 PR 现在什么状态」的逐条读。
8. **交接历史面板**：`bot_workspaces` 保留 released 行，但 UI 只显示 open；审计靠回合账与 `bot_events`。

---

## 9. 代码位置

| 面 | 文件 |
|---|---|
| 表 / 读写 / 往返 | `electron/db.mjs`（SCHEMA、load、persist、DELETE 清单） |
| 交接 / 交回 / 上下文 / 删除 / SOUL.md | `electron/bot/index.mjs`（`handOff` / `releaseWorkspace` / `botWorkspaces` / `compileContext` / `soulMarkdown` / `collectBotData`） |
| 动作 / 路径校验 / 工具执行 / run cwd | `electron/main.mjs`（`botHandOffWorkspace`、`botWorkspaceRelease`、`botReadToolNow`、`prepareRunWorktree`） |
| 工具 schema / 目录 | `electron/bot/tools.mjs`（`work_list`、`workspace` 参数） |
| 渲染层 | `src/components/Bot.tsx`（工作区一栏）、`src/components/TaskPane.tsx`（项目右键）、`src/components/TerminalPanel.tsx`（终端右键） |
| 类型 | `src/types.ts`（`BotWorkspace` / `State.botWorkspaces`） |
| 用例 | `tests/bot/handoff.test.mjs`、`tests/db.test.mjs`、`tests/bot/tools.test.mjs` |
