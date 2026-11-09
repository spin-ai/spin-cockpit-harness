# CHAT：从「两态」到「单会话（thread）」

> 起因：Chat 在两个状态间切换（未选任务 = 分派表单，选中任务 = 会话），但这不是产品设计，而是数据模型的副作用——消息只能挂在 `todo_id` 上，没有任务就没有地方放消息。
> 本文记录改造后的模型、`send` 状态机、迁移方式与遗留边界。差距基线见 [`GAP-chat.md`](GAP-chat.md)。

---

## 1. 根因

改造前：

```
todos(id, ...)
messages(id, todo_id, ...)     ← todo_id 是消息的宿主
TaskChat({ todo: Todo | null }) ← 组件唯一输入是“有没有任务”
dispatch() { 先建 todo，再建 run }
```

因果被写反了：**先有任务，才有对话**。于是只能加一个 `todo == null` 分支当“分派表单”，两态由此产生。副作用：

- 分派、发送、附件、快捷键……每个能力都要在两条分支写两遍；
- 分派原话不入会话（`dispatch` 不写 user message），任务会话第一屏只有 `system: run started`；
- 分派失败（如没有 agent）会先落一个孤儿 todo 再抛错；
- 真正的“不绑任务的会话”（D5 全局对话）在表结构上无法表达。

---

## 2. 目标与非目标

| 目标 | 非目标（本期不做） |
|---|---|
| 一个会话实体，消息挂 session，不挂 task | 无任务的“纯聊天”ACP 会话（需要常驻 client，P1） |
| Chat 只有一种渲染：永远是一个 thread | 把 Chat 做成看板 / 并行总览 |
| 派活 = 会话里的一条消息 → 任务草稿 | agent 在 Terminal 内启动、由 harness 捕获完成（P0 遗留） |
| 纠偏有真实投递回执，不伪造「已注入」 | 消息虚拟化 / Markdown / diff 渲染 |
| 任务操作只在 TODO 行内维护，Chat 不重复 | 多标签会话、thread 归档 |

---

## 3. 数据模型

### 3.1 新增/变更

```sql
threads(
  id, todo_id,            -- todo_id 为空 = 尚未派活的“新任务”会话
  title, project_id, project, agent_id,
  created_at, updated_at
)

messages(
  id, todo_id, run_id, role, kind, content, injected, created_at,
  thread_id,              -- 新增：真正的宿主
  delivery                -- 新增：pending | injected | failed（仅纠偏消息）
)
```

- `messages.todo_id` 保留但由 thread 派生，只用于按项目过滤与旧数据兼容。
- 一个 todo 对应一个 thread；thread 可以先于 todo 存在。
- `delivery` 只描述“这条纠偏消息投递到 run 的结果”，不是任务状态。

### 3.2 迁移（`electron/db.mjs`）

启动时自动执行，幂等：

1. 读取旧行，`ALTER TABLE messages ADD COLUMN thread_id / delivery`（失败即已存在）；
2. 每个没有 thread 的 todo 生成一个 thread（`th<seq>`，继承 title / projectId / cwd / agentId）；
3. 每条 `thread_id` 为空的消息，按 `todo_id` 回填到对应 thread；
4. 没有任何 todo 归属的孤儿消息丢弃；
5. 有变更则 `persist()` 一次。

已用「旧 8 列 messages 表 + 1 todo + 1 message」实测：迁移后 thread 自动生成、消息 `threadId` 正确、重开 DB 结果稳定。

---

## 4. 单一发送路径

`send({ threadId, text, agentId, projectId })` 是唯一入口，先落消息，再按会话状态决定行为：

| 会话状态 | 行为 | 返回值 `mode` |
|---|---|---|
| 未派活（`thread.todoId == null`） | 建 todo（标题=消息前 120 字）+ 排队 run；消息留在 thread 顶部，`runId` 为空 | `dispatch` / `error` |
| 有 `running` / `waiting_input` run | 纠偏：消息 `delivery=pending`，对同一 ACP client 发 `session/prompt` | `steer` |
| 有 `queued` run（还没开跑） | 挂到该 run 上作为补充指令，不另开 run | `queued` |
| 有 todo、无 run、未确认 | 新建 run，消息 `runId` 指向它，并在 `startRun` 时拼进 prompt | `run` |
| 已确认 | 只记录 | `note` |
| 没有可用 agent | 只记录 + 一条 `system/error` 卡片，**不创建任务** | `error` / `note` |

要点：

- **先落消息，再建任务**：失败时用户原话仍在会话里，不再产生孤儿 todo。
- **不抛错给 UI 清空草稿**：只有 `mode === "error"` 时保留输入框内容。
- `dispatch` / `comment` 保留为兼容别名（`dispatch` 转发到 `send`，`comment` 只记录）。

### 4.1 run 的 prompt 组装

```
任务：<todo.title>
描述：<todo.desc>            （如有）
验收：<acceptance>           （如有）
补充指令：
- <本轮 runId 绑定的 user 消息>
完成后给出结论；如需改文件请直接修改。
```

派活原话由标题承载，`text === todo.title` 时不重复拼进“补充指令”。

---

## 5. 投递回执

改造前：`injected: true` 无条件写死，`prompt` 失败只记 event，UI 仍显示「已注入」。

改造后（`deliverSteer`）：

```
写消息 delivery=pending
  ├─ 无 handle        → delivery=failed + 错误卡片
  ├─ prompt 成功       → delivery=injected, injected=true
  └─ prompt 失败       → delivery=failed（保留消息，可点“重发”）
run 结束 / 停止时 → settlePendingSteers：所有 pending 一律 failed
```

UI 三种态可区分：`投递中…` / `已注入` / `投递失败 · 重发`（点击触发 `retryMessage`）。

---

## 6. UI

```
CHAT
├── pane-head        状态 pill（来自 todo） + 「＋ 新任务」
├── thread-bar       key / 作用域（全局或项目）/ 标题 / @agent / 运行时长
├── chat-scroll      消息按 run 分组（run 分隔线：runId · 状态 · 耗时）
└── composer         textarea（Enter 发送 / Shift+Enter 换行）+ 发送
```

- **只有一个渲染分支**：`thread == null` 时提示「＋ 新任务」，其余一律渲染会话。
- **没有第二份操作按钮**：停止 / 确认 / 派活 / 重试只在 TODO 行内（`TaskPane.QuickActions`），Chat 不再重复。
- **agent 是会话属性**，运行中禁用、空闲可改。
- **对话作用域**：未派活的会话默认是**全局对话**（`thread.projectId = null`），不随项目切换隐藏；composer 的 `◎ 全局 / 项目 · xxx` 控制派活目标。全局作用域下派活时按 Agent 所在项目兜底；显式选项目则按该项目建任务。
- 任务一旦绑定项目即锁定（任务 = project → terminal → agent 的前提）。改作用域只改会话目标，**不再同步切换整个工作区项目**。
- **模型是会话属性**：`thread.model` / `modelName` / `effort`。Chat 底部选择器调用 `listModels`（主进程起一个 dsh ACP，读 `session/new` 的 `configOptions`，缓存 10 分钟），写入 thread；`startRun` 用 `thread.model || settings.model`。模型切换对**下一次 run** 生效，运行中的 steer 仍用当前 ACP session。空值 = 跟随设置 / dsh 默认。
- 滚动遵循“贴底才跟随”：用户翻历史时，流式追加不会把视口拽回去。
- 新任务入口：顶栏「＋ 新任务」/ Chat 内「＋ 新任务」/ ⌘N，全部走 `newThread`，**删除了 NewTodo 表单**（原来的第二分派入口）。

---

## 7. 代码地图

| 文件 | 变更 |
|---|---|
| `electron/db.mjs` | `threads` 表；messages 新增 `thread_id` / `delivery`；`addMessage(threadId, …)`；启动迁移；修复 persist 中 projects 重复插入导致事务失败的问题 |
| `electron/main.mjs` | `threadForTodo` / `ensureThreads` / `newThreadRecord` / `resolveThread` / `queueRun` / `activeRunOf` / `deliverSteer` / `settlePendingSteers`；`send`、`newThread`、`setThreadAgent`、`setThreadProject`、`retryMessage`；`startRun` / `handleUpdate` / 审批 / 确认 / 停止 / 重试 / 采纳全部改为 thread 维度；`files:*` 支持 root |
| `src/types.ts` | `Thread`、`Delivery`、`Message.threadId`、`State.threads` |
| `src/App.tsx` | todo + thread 双选择（以 thread 为主）、`selectTodo`、`newTask`、scoped 按 thread 过滤、文件预览跟随 run worktree |
| `src/components/TaskChat.tsx` | 单态重写：thread bar、run 分隔、投递回执、可保留草稿的发送 |
| `src/components/FilePanel.tsx` | `root` 参数，可指向 run 的 worktree |
| `src/components/NewTodo.tsx` | 删除（单入口化） |
| `src/styles.css` | `.thread-bar` / `.thread-select` / `.run-divider` / `.delivery.*` / `.composer textarea` / `.worktree-tag` |

---

## 8. 遗留边界（明确不做/未做）

| 项 | 说明 |
|---|---|
| D5 纯聊天 | 未绑任务的会话目前发一句话就会派活。真正“先聊完再转 TODO”需要 run-less 的常驻 ACP client，属下一阶段 |
| Chat ↔ Terminal 同源 | Terminal 仍是独立登录 shell，不在里面启动 agent；run 的工作目录（worktree）只在文件预览里体现。终止“双通道”需要把 ACP 会话绑定到终端标签，或反之以 pty 为准 |
| 多 run 的 thread | 已按 runId 分组展示，但没有折叠/回放控制 |
| 重试 & worktree | 每次重试新建 worktree，终端标签仍指向项目目录，需要在终端侧支持“跟随 run” |
| 消息量 | 无虚拟化，全量 state 广播；长会话仍会慢 |
| 失败重发 | 只支持对“当前 active run”重发；run 已结束则需要重新发送一条消息 |

---

## 9. 验收清单（本版可验证）

1. 顶栏「＋ 新任务」→ Chat 出现空白会话，输入一句话 → 立即出现任务 + 会话首条 user 消息 + run 分隔线。
2. 任务运行中在同一输入框发消息 → 消息出现「投递中…」→「已注入」；失败时显示「投递失败 · 重发」。
3. 运行中换 agent：下拉禁用；空闲时可改，下一次 run 生效。草稿会话可切「作用域」（全局 / 项目，不会切换工作区）；任务一旦派活，作用域锁定。
4. 任务已确认后再发消息 → 只记录，不新建 run。
5. 没有检测到 agent 时派活 → 会话里出现错误卡片，**不产生任务**，输入框内容保留。
6. 点 TODO 行 → Chat 切到该任务的会话；发消息后运行 → 文件预览自动切到该 run 的 worktree（显示 `run worktree` 标记）。
7. 旧数据库启动 → 自动生成 threads，历史消息仍按任务可见。

---

## 10. 回滚

数据库是单文件 `harness.db`，升级前备份即可。回滚到旧版本时，新增的 `threads` 表与 `messages.thread_id` / `delivery` 列会被旧代码忽略；旧代码的 `messages.todo_id` 仍在写入，不会丢历史。

## 11. 增量（2026-11）：思考可见 + 工具行可读 + 运行中进展

真实 ACP 载荷（`dsh --profile acp` 实测）：

```text
tool_call        { title:"bash", kind:"other", status:"in_progress",
                   rawInput:{ description:"List files in working directory", command:"ls -1" } }
tool_call_update { status:"completed",
                   content:[{ type:"content", content:{ type:"text", text:"hello.txt\n" } }] }
agent_thought_chunk { content:{ type:"text", text:"User asks: ..." } }
```

据此修了三处「看不出来在干嘛」：

| 问题 | 处理 |
|---|---|
| 工具行只有 `bash · completed`：首行取了最没信息量的 title+status，命令藏在第二次展开里 | `electron/tool-format.mjs` 统一格式化：首行 `Bash · 完成 · ls -1`（工具名首字母大写、状态中文化 `in_progress/completed → 运行中/完成`），第二段起依次是完整命令、`rawInput.description`、`tool_call_update.content` 里的输出（截断 1200 字） |
| 工具输出被丢掉（`content` 字段从来没读） | 同上：输出并入消息正文，展开工具行即可看到 |
| 思考过程被合进「思考与工具」折叠组，摘要只显示最后一条工具 → 看不到思考 | 前端把 `kind === "thought"` 拆成独立的「思考」块：浅紫底 + 左侧 2px hairline，默认 2 行 + 「展开」，工具仍单独成组 |
| 运行中只有一句「dsh 正在处理」 | `LiveStatus`：项目 · Agent · 状态 · 用时 · 步数 · 最近一步，可展开最近 4 步 |

约束：状态文本只在新消息生成时中文化，历史消息保持原文；`showTool=false` 时思考与工具一起隐藏（沿用原设置）。

### 展开详情时不能和鼠标抢

`now` 是全局面板每秒 tick 一次，直接在渲染里用 `timeAgo(x, now)` 会让每一秒都改写文本节点：
拖选到一半的选区会被截断/跳位（"11s" → "12s"）。处理：

- 展开「详情」后**冻结计时**（`frozenAt`），面板里的用时与相对时间不再刷新；收起后恢复。
- 历史行（工具行、思考头）一律用 10s 粗粒度时间，减少无意义重渲染。
- 展开时 `scrollIntoView({ block: "nearest" })`：面板向下长，长会话里不做这一步会被容器裁掉一半。
- `.chat-live-head` / `.chat-live-toggle` / `.thought-head` 设 `user-select: none`，正文保持可选，避免按在按钮上拖动产生半截选区。

### 详情里要有真信息，也要能看到全部

- **老消息兼容**：历史工具消息是 `bash · completed`，渲染时 `normalizeToolContent()` 归一化——
  `bash → Bash`、`list_agents → List Agents`、`completed → 完成`，无需迁移数据。
- **两行一行信息**：首行「Name · 状态 · 参数」，第二行（灰）是命令 / 路径；命令太长才省略，`title` 给全文。
- **不限 4 条**：默认最近 6 步，点击「看全部」展开该 run 的全部工具/思考步骤（`min(320px, 45vh)` 内部滚动，
  `overscroll-behavior: contain` 防止滚动穿透到会话）。

## 12. 中断的收口（2026-11）：run 不会永远「进行中」

现场：卡片显示「进行中 14:47 harness/168-r781-d52ep」，涨了十几分钟。查库发现
`runs.status='running'`，但最后一条消息停在 22:39，且机器上已没有 `dsh --profile acp` 进程——
应用被重启（重装）时 ACP 子进程一起退出，而数据库没人结算，卡片就一直挂着。

处理：

| 时机 | 行为 |
|---|---|
| 优雅退出（`before-quit`） | 仍在跑的 run → `interrupted`，`error="应用退出，运行中断"`，关联 todo 回到 `todo` |
| 下次启动（`recoverMissions`） | 兜底扫一遍：所有 `running / waiting_input / waiting_plan / waiting_children` 的 run → `interrupted`；`endedAt` 取**该 run 最后一条消息时间**（不是重启时间，否则把停机空档也算成耗时）；往会话补一条 system 消息说明原因 |

`RUN_STATUS.interrupted` 在 UI 显示为「已中断」，任务回到「待执行」，可以直接重跑。
