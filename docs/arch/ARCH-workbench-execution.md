> 层：架构 · 状态：部分落地 · 核对：2026-11-22 · 覆盖：Project、Todo、Run、Thread、Terminal、Tab 的职责、执行归属、工作台界面与迁移验收

# 工作台任务与执行模型

> 需求与验收见 [`../product/REQ-workbench-execution.md`](../product/REQ-workbench-execution.md)。
> 本文是目标设计，不表示代码已经落地。实现后同步修正 [`ARCH-multi-agent-workspace.md`](ARCH-multi-agent-workspace.md)、[`ARCH-chat-thread.md`](ARCH-chat-thread.md) 与 [`ARCH-terminal-ux.md`](ARCH-terminal-ux.md) 中冲突的旧约束。

## 0. 最终决策

```text
Project                  唯一长期归属；projectId 与执行 cwd 分离
├─ Todo                  要验收的工作；可有多次 Run、一个主 Thread、若干 Terminal
├─ Run                   Harness 启动并跟踪的一次执行；Todo 可以在启动后再关联
├─ Thread                消息宿主；可纯聊天，也可后转任务
└─ Terminal              一条 pty；可承载 Run，也可以只是人的 shell

Tab / Pane               上述对象的视图；不拥有进程、执行或任务的生命周期
```

**本设计修正此前两个过强的约束：**

1. 不再要求「所有 Run 创建时必须有 Todo」。正确约束是：**从 Todo 派活必须先有 Todo；探索 Run / 纯聊天 Run 可以没有 Todo，并在之后关联。**
2. 不再把「手动 Terminal 关联 Todo」实现成「补建 running Run」。手动 Terminal 与受管 Run 是两种事实，关联只改变导航归属。

这两条修正分别删除纯聊天的隐藏 Todo、终端接入后的假 Run，不需要新增 `Session` 实体。

## 1. 当前实现为什么会产生歧义

| 当前行为 | 代码位置 | 问题 |
|---|---|---|
| 「起 Agent（不建任务）」只创建 Terminal | `TerminalPanel.launchAgent()`、`terminal:create` | Harness 启动了 Agent，却没有记录探索 Run，之后无法原样提升 |
| `attachTerminalToTask` 新建 `status=running` 的 Run | `electron/main.mjs` 同名 action | 把早已手动运行的进程包装成受管执行，startedAt 与完成语义不可靠 |
| 纯聊天创建 `kind="chat"` 的隐藏 Todo | `actions.chat` | 用不可见工作项绕过 Run 必须有 Todo 的约束 |
| `terminal:close` 先 `settleTerminalRun("cancelled")` 再 kill | `electron/main.mjs` | 关视图与取消执行耦合 |
| 左栏与项目树各列一份 running Terminal | `TaskPane.tsx` | 与标签栏重复，且只列 running，退出即消失 |
| pty Run 的 Chat 侧主要读 `resultSource=pty_tail` | `setRunResult()`、Chat run 产出卡 | 是尾部摘要，不是与 ACP 等价的对话 transcript |

因此问题不是「Terminal 是否在任务列表」，而是**执行归属、视图生命周期和手动 / 受管边界没有分开**。

## 2. 领域对象与不变量

### 2.1 目标关系

```ts
type ProjectId = string;
type TodoId = string;
type RunId = string;
type ThreadId = string;
type TerminalId = string;

interface Run {
  id: RunId;
  projectId: ProjectId;          // 必填，不从当前选中项目临时猜
  todoId: TodoId | null;         // 可后关联；历史关联不被关 Tab / 取消视图清空
  threadId: ThreadId | null;     // ACP 的消息落点；pty 可在关联任务后补上
  agentId: string;
  hostId: string;
  cwd: string;                   // 项目根目录或 run worktree
  carrier: Carrier;
  status: RunStatus;
  startedAt: number | null;
  endedAt: number | null;
}

type Carrier =
  | { kind: "acp"; sessionId: string | null }
  | { kind: "pty"; terminalId: TerminalId };

interface TerminalRecord {
  id: TerminalId;
  projectId: ProjectId;
  todoId: TodoId | null;         // 导航关联，不代表受管执行
  runId: RunId | null;           // 只有 Harness 启动的 pty Run 才有
  cwd: string;
  status: "running" | "exited" | "closed" | "detached" | "failed";
}
```

### 2.2 必须守住的不变量

| # | 不变量 | 目的 |
|---|---|---|
| I1 | 新 Todo、Run、Terminal 必须有明确 `projectId`；`cwd` 不能代替项目归属 | worktree 切换不改变项目，跨项目不串数据 |
| I2 | `dispatchTodo()` 必须先有 Todo；`startExploration()` 与纯聊天可以 `todoId=null` | 任务闭环与合法探索同时成立 |
| I3 | 每个 Run 必须有 Agent、Host、cwd、Carrier；ACP 必须有 Thread 落点，pty 必须有 Terminal | 没有无落点、无执行体的 Run |
| I4 | `carrier.kind="pty" ⟺ terminalId 存在`；`carrier.kind="acp" ⟺ terminalId 不存在` | 删除 `runtime / terminalId / agent.chatRuntime` 三路临时推断 |
| I5 | 手动 Terminal 可以 `todoId != null && runId == null`；它绝不自动创建 Run | 关联导航不伪造执行事实 |
| I6 | 关联已有探索 Run 时保留 runId、startedAt、endedAt、terminalId、结果 | 提升不制造第二次执行 |
| I7 | Tab / Pane 不拥有领域对象；关视图不得写 Run / Todo 状态或 kill pty | 看与停分离 |
| I8 | 只有 `stopRun` 结算 Run，只有 `stopTerminal` 结束手动进程；pty Run 停止时二者联动 | 状态写点可审计 |
| I9 | 取消 / 归档 Todo 不删除 Run、Thread、Terminal，也不清空历史 `run.todoId` | 保留「当时为谁执行」的审计事实 |
| I10 | `projectId` 是归属，`cwd` 是实际执行目录；Git、文件、Bot 工具按对象 cwd 工作 | 主仓与 worktree 不混用 |

> 旧数据中 `projectId=null` 的 Terminal 不静默归到当前项目。它只作为 legacy 记录显示；要关联或继续执行时由用户显式选择 Project。新写入不允许再产生这种记录。

### 2.3 Run、Terminal、Thread 的组合

| 场景 | Run | Terminal | Thread | Todo |
|---|---|---|---|---|
| 任务面板派 ACP Agent | 有，ACP | 无 | 任务 Thread | 创建 Run 前已有 |
| 任务面板派 pty Agent | 有，pty | 有，`runId` 互相关联 | 任务 Thread，pty 尾部作摘要 | 创建 Run 前已有 |
| 标签栏打开 Agent 探索 | 有，pty，`todoId=null` | 有 | 可无；关联任务后补 / 绑定 | 可后关联 |
| 新建 shell 后手敲 pi | **无** | 有，`runId=null` | 无 | 可后关联，但不产生 Run |
| ACP 纯聊天 | 有，`todoId=null`、`threadId` 必填 | 无 | 有 | 可后转任务 |
| Bot 对话回合 | 由 Bot 域管理；若委派工作则走普通任务 Run | 视执行体 | Bot Thread | 仅委派工作时需要 |

**Terminal 与 Chat 不是一个 Run 必然具有的两个视图。** Carrier 决定原生面：ACP 只有对话面；pty 的原生面是 Terminal，Chat 中的 `pty_tail` 只是明确标注来源的尾部摘要。

## 3. 四个生命周期，四个所有者

| 对象 | 所有者 | 正常结束 | 结束后的可见性 |
|---|---|---|---|
| Tab / Pane | Renderer | 关标签 / 关 pane | 后台或最近入口可恢复；不影响领域状态 |
| Terminal | Main 进程 | 进程退出或显式结束进程 | 记录与现有 8KB tail 保留 |
| Run | Main / Scheduler | completed / failed / cancelled / interrupted | 关联任务则进运行记录；探索则进最近记录 |
| Todo | 人 / Mission 规则 | 确认 / 取消 / 归档 | 任务列表与历史视图；不级联删历史 |

### 3.1 关闭与停止矩阵

| 用户动作 | Tab | Terminal | Run | Todo |
|---|---|---|---|---|
| `⌘W` / 点标签关闭 | 关闭 | 活着则 detached，继续写 buffer | **不变** | **不变** |
| 恢复后台视图 | 重开 | 同一 id 重新 attach，回放关闭期间 buffer | 不变 | 不变 |
| 结束进程… | 可保留退出态或关闭 | kill，写 exited / closed | 若有关联则 cancelled | 由现有 Run 结算规则处理 |
| 停止 Run | 终端标签可保留退出态 | pty carrier 被结束 | cancelled | 由现有 Run 结算规则处理 |
| 关联手动 Terminal | 不变 | 只写 todoId | **不创建** | **不因关联自动改状态** |
| 关联探索 Run | 不变 | 写 todoId | 原 Run 写 todoId / threadId | 按原 Run 真实状态投影 |

不新增危险的 `⌘⇧W` 结束快捷键；macOS 上它通常还承担关窗口语义。P0 只把「结束进程…」放在终端右键 / 后台菜单，并在有活跃 Run 时二次确认。

### 3.2 detach / attach 的正确实现语义

当前 `info.attached` 只支持首次挂载，目标需要支持反复挂载：

```text
terminal:create        attached=false，输出进入 buffer
terminal:attach        返回并清空 buffer，attached=true，之后实时推送
terminal:detach        attached=false，后续输出重新进入 buffer；不 kill、不 settle
terminal:attach again  返回同一 terminalId 的新 buffer，再继续实时推送
terminal:stop          唯一显式 kill 入口，按 carrier / run 关系结算
```

Renderer 的 effect cleanup 只调用 `detachTerminal`。React StrictMode 的卸载 / 重挂载、关闭 pane、切换项目都不能落到 `closeTerminal`。现有 `terminalOwners` 用来防止旧实例误操作新实例，保留这一所有权保护。

应用重启后，持久化 Tab 不得把旧 Agent 标签静默变成一个新 shell 并假装续跑：旧进程不存在时显示已中断 / 已退出记录；「重新启动」必须显式创建新 Terminal，任务需要重跑时创建新 Run。

## 4. 工作台界面

### 4.1 常驻结构

```text
┌ 左栏：工作目录 ──────────────┬ 主面：视图 ─────────────────────────────────┐
│ 任务                  筛选 ▾ │ [对话 · #12] [任务详情] [pi · 探索] [zsh] ⌄ ＋ │
│ ▾ 待执行                     ├─────────────────────────────────────────────┤
│   ○ #13 补文档               │                                             │
│ ▾ 进行中                     │   当前标签的原生内容：                       │
│   ● #12 修登录页  @pi  派活中 │   ACP 对话 / pty 终端 / 任务详情 / 预览     │
│ ▾ 待确认                     │                                             │
│ ▾ 已完成                     │                                             │
│ ──────────────────────────── │                                             │
│ ▾ 项目                       │                                             │
│   ● Cockpit Harness          │                                             │
│   ○ WeKnora                  │                                             │
└──────────────────────────────┴─────────────────────────────────────────────┘
```

- 左栏删除「终端 Agent（未绑任务）」和项目树 Terminal 子列表，只保留任务与项目。
- Chat 继续是工作台标签；**本轮不把 composer 搬到底部**，避免同时重做输入布局。
- `⌄` 是条件式「后台与最近」入口：当前项目没有隐藏记录时不渲染，不显示数量。
- `＋` 只负责新建视图 / 打开探索 Agent，不再承担「给当前任务派活」；任务派活入口在任务行。

### 4.2 后台与最近菜单

```text
⌄
┌ 仍在运行 ─────────────────────────┐
│ pi · 探索        运行中 · 3 分钟   │  点行 = 恢复同一视图
│ zsh · harness    运行中 · 12 分钟  │
├ 最近结束 ─────────────────────────┤
│ pi · 调研        已结束 · exit 0   │  点行 = 打开现有 tail
└───────────────────────────────────┘
```

- 菜单只列当前 Project 的隐藏 Terminal；打开中的 Terminal 不重复出现。
- 「仍在运行」按 createdAt 稳定排序，「最近结束」按 endedAt 稳定排序；恢复视图不重排任务 / 项目列表。
- 行菜单提供「结束进程…」；已结束行没有这个危险动作。
- 展示数量可限制为最近 20 条，但只是显示截断，不删除数据库记录，也不自动 kill。
- `⌘⇧T` 恢复最近关闭的视图；若是活 Terminal 就 attach，若已退出就显示保存的 tail。

### 4.3 终端对象动作

把当前标签栏的「接入 #KEY」文字链接收进终端右键的对象动作区，避免同一行堆叠视图导航和归属操作：

```text
关联到当前任务…        / 建成任务并关联
在对话里查看           / 仅有关联 Thread / Run 时可用
────────────
结束进程…
```

- 对探索 Run：「关联」调用 `attachRunToTodo`，保留原 Run。
- 对手动 Terminal：「关联」调用 `linkTerminalToTodo`，只写 Terminal.todoId。
- 对纯 shell：允许关联为任务的工作终端，但仍不创建 Run。
- 对已有其他活跃 Run 的 Todo，关联探索 Run 默认拒绝并说明原因；需要并行时走既有广播，不隐式变成广播。
- 任务详情分两块展示：**受管运行（Run）**与**关联终端（手动 / 受管）**，不合并成一个状态。

### 4.4 Chat 发送语义

保留现有 composer 结构，但在发送箭头旁增加可见的上下文动作文本，不能只靠 `title` 猜：

| Thread 状态 | 可见动作 | 领域结果 |
|---|---|---|
| 草稿 + 任务模式 | 创建并派活 | 创建 Todo + Run，原话绑定首个 Run |
| 草稿 + 纯聊天 | 发送 | 创建无 Todo 的 ACP Run，Thread 保留 |
| Todo + active Run | 纠偏 | deliverSteer，真实回执 |
| Todo + queued Run | 补充指令 | 加入 queued Run，不另建 Run |
| Todo + 无 active Run | 继续并运行 | 新 Run，原话绑定它 |
| Todo 已确认 | 仅记录 | Message，不建 Run |
| Mission 草稿 | 开始规划 | Mission + Supervisor Run |

「只聊」是明确的会话模式，不再通过隐藏 Todo 实现。分配预览仍是发送前的可选检查，不改变最终领域动作。

## 5. 统一领域命令与授权

### 5.1 命令边界

```ts
createTodo(input): Todo
assignTodo({ todoId, agentId }): Todo

dispatchTodo({ todoId, agentId?, origin, messageId?, authorization }): Run
startExploration({ projectId, agentId, cwd, origin }): Run   // todoId=null
startChatTurn({ threadId, text, origin }): Run               // todoId 可空

attachRunToTodo({ runId, todoId }): Run                      // 保留执行事实
linkTerminalToTodo({ terminalId, todoId }): TerminalRecord   // 不创建 Run
promoteThreadToTodo({ threadId, todoId? }): Todo              // 保留 Thread / Runs

detachTerminalView({ terminalId }): void
attachTerminalView({ terminalId }): { data, exited, exitCode }
stopRun({ runId }): void
stopTerminal({ terminalId }): void
```

`Agent.chatRuntime` 只是下一次执行的默认 Carrier 选择；创建 Run 时快照为 `run.carrier`。执行中不再读取 Agent 当前设置反推旧 Run 的原生面。

### 5.2 授权规则

| 调用来源 | authorization | 允许结果 |
|---|---|---|
| 任务行「派活」 | 本次明确点击 | dispatchTodo |
| Chat「创建并派活 / 继续并运行」 | 本次明确发送 | dispatchTodo |
| 「打开 Agent 终端」 | 选择 Agent 的明确动作 | startExploration，不建 Todo |
| Mission 计划审批 | approved plan revision | 批量创建 child Todo + dispatchTodo |
| IM / Bot | `/run` 或明确「开跑」语义 | dispatchTodo；否则只 createTodo |
| 插件 | `task:start` 权限 + 调用参数 | 无权限只能 createTodo |
| Scheduler / 自动化 | 已持久化的自动化授权与触发记录 | 不能借用当前 UI 选中状态 |

`origin` 只记录来源与默认路由，不改变 Run 的数据形状。`dispatchTodo` 是任务 Run 的唯一创建入口；渲染层不得先 `createTerminal(todoId)` 再补 Run。

### 5.3 后关联的状态投影

`attachRunToTodo` 不启动、不重试、不改 cwd：

- Run active：Todo 按现有规则显示 `in_progress / waiting_input`。
- Run completed：Todo 进入 `in_review`，并走既有 writeback 完整性检查。
- Run failed / cancelled / interrupted：Todo 回到可重试状态，保留失败事实。
- 原 Thread 有多个无 Todo 的 chat Run 时，`promoteThreadToTodo` 将同一 Thread 的历史 Run 一并关联；不复制消息。
- 关联动作写审计事件，包含原 runId、目标 todoId、操作者与时间。

取消 / 归档 Todo 时只做现有级联停止与状态处理；**不把历史 run.todoId 置空**。只有显式「解除探索关联」才允许改归属，并写审计事件。

## 6. 状态与结果归属

P0 不做大规模 Todo 状态机重写，但收敛写入边界：

- Run 状态只由 Scheduler / Executor 结算写。
- Todo 状态只能由人的动作、Mission 规则、Run 结算映射写；Terminal 关联和 Tab 动作不在其列。
- 手动 Terminal 的 `running / exited` 不参与 Todo 执行状态、耗时或并发统计。
- 探索 Run 参与真实并发与用量统计；调度器按 `run.projectId + run.cwd + run.agentId` 工作，不能因 `todoId=null` 静默跳过或永远 queued。
- 探索 Run 没有 Todo 时，结果写 Thread 或 Terminal；关联后按既有规则投影到 Todo，不重跑结果生成。
- pty 的 `resultSource=pty_tail` 必须在 UI 标注「终端尾部摘要」；ACP 的 `acp_text` 才是对话正文。
- `run.projectId` 与 `run.cwd` 分别服务归属和文件访问；Bot workspace 工具、Git、Diff、预览使用当前 Run 的 cwd。

## 7. 数据迁移与兼容

1. `runs.todo_id` 当前 SQLite 定义已经允许空值，无需为了探索 Run 放松表约束；需要改的是 `tick()`、统计、查询和 UI 中「找不到 todo 就跳过」的假设。
2. `runs` 增加 `project_id / thread_id`；从 Todo、Thread、Message、Agent 可确定地回填，不能确定的保留 legacy 并禁止自动派活。
3. `runtime + terminal_id` 迁移为 Carrier 读模型；写路径先双写一拍，再切读，最后删旧推断。DB 可继续保留旧列作回滚兼容。
4. 现有 `kind="chat"` 隐藏 Todo 不删除。新纯聊天不再创建它；用户「转为任务」时优先复用 / 升级既有记录，避免历史断裂。
5. 现有手动 Terminal 若已经通过 `attachTerminalToTask` 生成 Run，无法可靠反推是否受管，保留为 legacy managed run 并标来源；不批量删 Run。
6. 现有 Terminal `projectId=null` 不按当前项目批量回填，避免串项目；新写入加校验。
7. Tab 持久化增加对象 id 与视图类型，不把「恢复视图」等同于「重启进程」。旧 Tab 没有 terminalId 时按 legacy shell 处理并明确提示。

## 8. 分期实施

### M0：先加契约测试，不改界面

- 固定 I1–I10 的 fixture 与状态矩阵，尤其是手动 Terminal 不造 Run、探索 Run 后关联不换 id。
- 为 `terminal:close` 当前会 cancel 的行为建立一条反向验收，作为 M1 的改造目标。

### M1：视图与进程解耦

- `terminal:detach / attach / stop`，关闭 Tab 不再 kill。
- 条件式「后台与最近」、`⌘⇧T`、重复挂载 buffer。
- 保留左栏旧分组直到后台恢复验证通过，再删除两处重复 Terminal 列表。

### M2：执行归属与关联

- Run 增加 projectId / threadId / Carrier，允许探索 Run 无 Todo。
- `startExploration`、`attachRunToTodo`、`linkTerminalToTodo` 三分；删除 `attachTerminalToTask` 的假 Run 行为。
- 任务详情分「受管运行 / 关联终端」；调度与统计支持无 Todo 的探索 Run。

### M3：各入口统一

- Chat 纯聊天移除新隐藏 Todo；composer 显示明确动作文本。
- 任务面板、Chat、Mission、IM、Bot、插件统一走 `dispatchTodo` 与授权闸。
- `+` 菜单改名「打开 Agent 终端」，不再 toast「未绑任务」。

### M4：恢复与清理

- Tab 按对象恢复，重启后不伪装进程续活。
- 最近记录展示上限、legacy 数据提示、文档状态回填。
- 最后再评估是否需要完整会话历史页；没有用例就不新增页面。

### 落地状态（2026-11-22，M1 + M2 核心）

已落地：

| 项 | 落点 |
|---|---|
| `terminal:detach`：关视图只 detach，输出攒回 buffer，可重新 attach | `electron/main.mjs` / `preload.cjs` / `TerminalPanel` 卸载路径 |
| 探索 Run：`terminal:create` 带 `explore` 时创建无 `todoId` 的受管 run（trigger=exploration） | `electron/main.mjs` |
| 三分关联：`attachRunToTodo`（保留 runId/startedAt/输出，按真实状态投影 Todo）、`linkTerminalToTodo`（只改归属，不造 run）、`attachTerminalToTask` 兼容入口二选一分发 | `electron/main.mjs` |
| 关闭标签不再取消运行（原 `terminal:close` 的 settle/kill 只留给显式「结束进程…」） | `TerminalPanel` 卸载用 detach；右键菜单新增「结束进程…」 |
| 条件式「后台与最近」菜单：当前项目无视图的终端分「仍在运行 / 最近结束」，恢复同一 terminalId；`>0` 才出现，无计数 | `TerminalPanel` term-strip |
| 「起 Agent」改「打开 Agent 终端（探索，可后关联任务）」，不再 toast「未绑任务」 | `TerminalPanel.launchAgent` |
| 重启后 running 终端记录标 `detached`（pty 已随应用退出，不伪装续活）；attach missing 时明确提示 | `seed()` / `TermTab.attach` |
| 左栏删除三处重复终端列表（「终端 Agent（未绑任务）」分组、平铺列表、项目树终端子列表）与相关视图开关 | `TaskPane.tsx` |
| `Run.todoId` 类型放宽为可空；Chat 进展条兼容无任务的探索 run | `src/types.ts` / `TaskChat.tsx` |

未做（后续）：

- `⌘⇧T` 恢复最近关闭标签的快捷键（菜单已覆盖找回路径）。
- M0 契约测试：main 进程 actions 未抽成可导入模块，动作级 fixture 测试待重构后补；现有保障 = typecheck + 全量 tests + 手工验收。
- M2 其余：`run.project_id / thread_id` 落库与 Carrier 读模型（写路径仍用 `runtime + terminalId` 快照）。
- M3：Chat 纯聊天仍创建隐藏 `kind=chat` Todo；composer 动作文案未改；各入口授权闸未统一。
- M4：Tab 按对象恢复 / 最近记录展示上限。

## 9. 测试与验收

### 9.1 领域 / DB

- 三种创建：Todo Run、探索 Run、手动 Terminal；断言对象数量与关联字段。
- pty / ACP Carrier 判别穷尽；任何 pty Run 缺 terminalId、ACP Run 多 terminalId 都失败。
- 探索 Run 在 `tick()` 中不被「没有 Todo」卡住；其 cwd 并发、Agent 并发与用量统计正确。
- 关联 Run 前后 runId、startedAt、endedAt、terminalId、消息 id 不变。
- 关联手动 Terminal 前后 runs 数量、Todo 状态不变。
- 纯聊天无隐藏 Todo；提升后同一 Thread / Run 历史可见。
- 取消 Todo 后历史 run.todoId 保持；数据重启后不丢。

### 9.2 终端生命周期

- 关闭视图 3 秒后 Terminal 与 Run 仍 running；恢复同一 id，关闭期间输出不丢。
- StrictMode 卸载 / 重挂载、关闭 split pane、切换项目均不 kill。
- `stopTerminal` 才结束手动进程；`stopRun` 才取消受管 Run；二者关联时只结算一次。
- 进程退出后从「最近」重开能看到 tail；重启应用不自动伪造新 Run。

### 9.3 入口与 UI

- 面板派 pty Agent 只产生一个 Run；Renderer 不重复 createTerminal。
- IM 未授权只建 Todo；明确开跑只建一个 Run；重复消息有幂等键。
- Chat 五种状态的动作文案与领域结果一致。
- 左栏没有 Terminal 重复列表；后台入口无数字 / 红点；点击任务和恢复视图满足列表稳定性。
- `npm run typecheck`、`npm run build`、`npm run verify:design`、`npm test`；亮暗主题各检查工作区与任务详情。

## 10. 代码落点

| 范围 | 位置 |
|---|---|
| Run / Terminal 类型与 Carrier | `src/types.ts`、`electron/db.mjs` |
| 统一创建、关联、授权与结算 | `electron/main.mjs`；过大时拆 `execution-service.mjs`，不把规则继续塞进 IPC 分支 |
| pty detach / attach / stop | `electron/main.mjs` 的 terminal IPC、`electron/preload.cjs`、`src/global.d.ts` |
| 标签恢复、后台菜单、移除旧接入链接 | `src/components/TerminalPanel.tsx` |
| 删除左栏重复 Terminal 列表 | `src/components/TaskPane.tsx` |
| 任务详情分 Run / 手动 Terminal | `src/components/TaskDetail.tsx` |
| Chat 动作文案与纯聊天无隐藏 Todo | `src/components/TaskChat.tsx`、`electron/main.mjs` |
| IM / Bot / 插件授权复用 | `electron/main.mjs`、`plugins/host.mjs` |
| 契约与回归 | `tests/` 新增 execution / terminal-view 用例；渲染层走隔离预览 |

## 11. 明确不做

- 不新增 `sessions` 表，不把 Thread / Run / Terminal 合成第四套同步事实源。
- 不在左栏恢复任何常驻 Terminal / 会话分组，不把产品改成会话中心。
- 不让手动 shell 自动变成 Run 或 Todo，不通过标题 / 进程名伪造完成状态。
- 不让 Tab close 兼具停止语义，不设置空闲自动 kill。
- 不把 pty tail 称为完整对话，不为 ACP Run 伪造 Terminal。
- 不在本轮搬 composer、重做 Mission、引入历史大页面或第四种页面外壳。
