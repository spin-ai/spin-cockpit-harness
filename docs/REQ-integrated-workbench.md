# REQ · 场景工作台：Mission / TODO / Terminal / Chat 的融合

> 状态：需求草案（v0.1）
> 关联：`REQ-original.md`、`ARCH-chat-thread.md`、`ARCH-terminal-ux.md`、`ARCH-hosts-stats.md`
> 结论先说：**可以有机融合，而且应该融合。** 前提是承认它们不是三个产品，而是同一套对象模型的三层视图。

---

## 0. 一句话

把 **Scene（场景配置）** 作为项目级执行模板，把 **Mission / Task** 统一成 WorkItem，把 **Run** 作为唯一执行事实，把 **Terminal** 作为 Run 或独立 shell 的执行表面，让 **TODO / 场景总览 / Chat 进展面板** 都读同一份数据。

```text
Chat 是控制面
  → WorkItem（Task / Mission）
  → Run（ACP 或 Terminal）
  → Terminal / ACP 事件
  → TODO / 场景总览 / Chat 进展
```

Mission、TODO、Terminal 不是三个并列模块：

- **Mission** 是 WorkItem 的一种 kind，不是新页面；
- **TODO** 是 WorkItem 的看板视图；
- **Terminal** 是 Run 的一种执行表面，不是第二套任务系统；
- **Scene** 是“任务应该怎么跑”的配置，不是任务本身。

---

## 1. 现在为什么割裂

| 现状 | 问题 |
|---|---|
| Mission 有独立面板和 supervisor 状态机 | 和 TODO 看板是两套心智；Mission 卡片不显示终端/子任务运行现场 |
| TODO 只显示当前项目 | 看不到其他项目的任务、终端、运行 |
| Terminal 是 renderer 内存 tab | 重开应用丢失；不能按项目列出；和 run 的绑定只在终端模式下存在 |
| Chat 只看当前 thread | 想看全局进展必须切 TODO / 统计 / 终端 |
| 终端模式没有结构化事件 | Mission 子任务如果用 pty，主管拿不到 ACP 式结果 |
| 场景配置不存在 | “任务该去哪个项目、用哪个 Agent、ACP 还是终端”靠当前会话上下文和模型判断 |

根因：**没有把“配置 / 工作项 / 执行 / 表面”分层。** 每加一个能力就多一套页面或一套状态。

---

## 2. 设计原则

1. **一套对象模型**：Project → Scene → WorkItem → Run → Surface。
2. **一个调度器**：只有 `tick()` 和 `send()` 两条主路径；Mission 不另起调度。
3. **配置与现状分离**：Scene 是 desired state；Terminal / Run / WorkItem 是 actual state。
4. **执行方式可配**：同一 WorkItem 可以选择 ACP 或 Terminal；Mission supervisor 仍强制 ACP。
5. **自动分配只做推荐，不静默开跑**：先生成 Draft + 理由，人确认后再建 run。
6. **终端必须可关联**：每个 agent 终端要么绑定 Run，要么明确是项目 shell；不出现“不知道在跑什么”的 tab。
7. **所有进展只有一个事实源**：Chat dock、场景总览、TODO 看板都读 `work_items + runs + terminals`。

---

## 3. 核心对象模型

```text
Project（本地目录）
  └─ Scene（执行模板，1..n）
       ├─ defaultAgent / runtime / command / worktree / concurrency / acceptance
       └─ WorkItem（Task 或 Mission）
            ├─ Run（每次执行，ACP 或 Terminal）
            │    └─ Surface（ACP 事件流 / Terminal pty）
            └─ Mission
                 └─ Delegation → child WorkItem → child Run → child Surface
```

### 3.1 对象职责

| 对象 | 职责 | 不做什么 |
|---|---|---|
| Project | 本地目录、项目级配置、资源边界 | 不直接执行任务 |
| Scene | 任务路由与执行模板：Agent、runtime、命令、worktree、并发、验收 | 不拆任务、不存运行状态 |
| WorkItem | 任务/目标、状态、验收、项目、Scene | 不直接持有 pty |
| Run | 一次执行的事实：状态、耗时、错误、runtime、worktree、terminalId | 不负责页面布局 |
| Terminal | Run 或独立 shell 的表面：pty、标签、输出、退出码 | 不成为任务状态源 |
| Delegation | Mission 与 child WorkItem 的合同 | 不复制 child 任务 |

### 3.2 Mission 不是新对象

继续复用 `todos.kind = 'mission'`，不新建 `missions` 表。Mission 是 WorkItem 的一种：

- Mission 卡片在 TODO 看板里展开子任务；
- 子任务是普通 WorkItem，有独立 Run / Terminal / 验收；
- Delegation 只记录 Mission → child 的关系、结果、分支；
- Mission 的 `mission_state` 与 WorkItem 的 `status` 同时存在，但看板优先显示 `mission_state`（避免“等待子任务”被误显示成“等待输入”）。

---

## 4. Scene：场景配置

### 4.1 定位

Scene 是 **项目级执行模板**，回答：

> 这类任务在这个项目里，应该用谁、怎么跑、跑在哪、什么算完成？

一个项目可以有多个 Scene，例如：

- `frontend`：pi / terminal / worktree / 1 并发 / 验收“页面可打开”
- `backend`：dsh / acp / worktree / 2 并发 / 验收“测试通过”
- `docs`：pi / terminal / 不建 worktree / 验收“Markdown 可渲染”

### 4.2 字段

```yaml
name: frontend
projectId: p-...
runtime: terminal          # acp | terminal
agentId: ag-...            # 可空：按能力自动选
command: pi                # terminal 模式使用
cwdMode: worktree          # worktree | project
maxConcurrent: 1
worktree: true
approval: ask              # ask | allow | deny（ACP）
acceptance:
  - 页面可打开
  - 不破坏现有接口
env: {}
# 仅用于说明，不参与自动分配
notes: "前端任务优先走 pi 终端，不要动后端接口。"
```

### 4.3 可编辑方式

- **结构化编辑器**：表单 + YAML/JSON 文本，二者同步。
- 文本必须是可校验的 schema；保存前校验：
  - project / agent 存在；
  - runtime 与 agent CLI 兼容（dsh → acp；pi/claude/codex/opencode → terminal）；
  - terminal 模式必须有 command；
  - maxConcurrent > 0；
  - acceptance 非空（或明确允许空）。
- `notes` 是自由文本，只用于说明，**不参与自动分配**。  
  这一点很重要：自然语言备注不能当执行规则，否则“配置驱动”会退化成模型猜。

### 4.4 场景总览页

一个页面，两个区域，不要混成一个列表：

```text
┌ 场景配置（desired）──────────────┬ 运行总览（actual）──────────────┐
│ 项目列表                          │ 当前项目的终端 / Run / WorkItem   │
│  ├─ frontend                      │  - #123 运行中 · terminal t-1     │
│  ├─ backend                       │  - #124 待确认 · ACP              │
│  └─ docs                          │  - shell: zsh · 项目根目录        │
│  YAML / 表单                      │  - 最近失败 / 退出码              │
└───────────────────────────────────┴──────────────────────────────────┘
```

- 左侧项目 / Scene 可切换；
- 中间编辑 Scene；
- 右侧实时显示该项目的 Terminal / Run / WorkItem；
- 顶部有「所有项目」汇总：运行中 / 排队 / 待确认 / 异常终端。

---

## 5. Terminal 与 Run 的融合

### 5.1 两种 Terminal

| 类型 | 说明 | 绑定 |
|---|---|---|
| 项目 shell | 用户自己开的终端 | 不绑定 WorkItem，只绑定 Project |
| Agent 终端 | Chat / 场景派活后启动的 CLI | 必须绑定 Run + WorkItem |

### 5.2 终端元数据持久化

当前 tabs 是 renderer 内存；为了“所有项目终端总览”，需要持久化最小元数据：

```text
terminals
  id, project_id, work_item_id, run_id, title, cwd,
  kind(shell|agent), status(opening|running|exited), terminal_id,
  created_at, closed_at, exit_code
```

- 不持久化 scrollback；
- 应用重启后，未退出终端标记 `interrupted`，Run 标记 `interrupted`，不假装还在跑；
- 关闭 tab = 结束 run（agent 终端）或只关闭 shell（项目 shell）。

### 5.3 TODO 行上的终端状态

WorkItem 行显示：

- `ACP`：无终端，查看 Chat；
- `终端`：显示终端标签标题 / 运行时长，点击聚焦；
- `已退出`：显示 exit code，可重启；
- `待确认`：终端已退出，等待人确认。

---

## 6. Mission 与 Terminal 的融合

Mission 的 supervisor 仍然走 ACP；child WorkItem 可以按 Scene 选择 ACP 或 Terminal。

```text
Mission (ACP supervisor)
  ├─ child #1 (Scene=backend, ACP)     → ACP 事件 → delegation
  └─ child #2 (Scene=frontend, terminal) → pty → exit + result contract → delegation
```

### 6.1 终端 child 的结果合同

终端模式没有 `session/update`，必须定义“什么算结果”：

```yaml
result:
  mode: exit          # exit | file | none
  file: RUN_RESULT.md # file 模式
```

- `exit`：exit 0 = completed，非 0 = failed；summary = “exit N, no structured result”；
- `file`：Run 结束后读取 cwd 下 `RUN_RESULT.md` 或 `result.json`，写入 delegation.resultSummary；
- `none`：只标 completed，主管只能看 diff / artifacts；
- 没有合同就必须显式标记“结果不可信”，不能把 exit 0 当成验收通过。

### 6.2 边界

- Mission 仍然只有一个 supervisor，不允许 child 再成为 Mission；
- 终端 child 的审批由 CLI 自己处理，不进入 ACP 审批队列；
- supervisor 通过 `task_get` / `delegation` 读结果，不读取终端 scrollback。

---

## 7. Chat：控制面 + 进展面板

### 7.1 对话 → 确认 → 分配

```text
用户在 Chat 描述目标
  → 生成 Draft WorkItem（标题 / 验收 / 项目 / 建议 Scene）
  → 显示分配预览：
      项目：spin-yieldmind-app
      Scene：frontend
      Agent：pi
      Runtime：terminal
      理由：项目匹配 + frontend 标签 + pi 可用
  → 用户点「确认执行」
  → 创建 WorkItem + Run
  → terminal 模式：打开标签、启动 CLI、写入任务
  → ACP 模式：启动 ACP，流式回 Chat
```

- 不确认不创建 run；
- 用户可以在预览里改项目 / Scene / Agent / Runtime；
- 没有匹配 Scene 时显示原因和候选项，不静默使用默认值。

### 7.2 合并已有命令

- `/task`、`/project` 仍保留；
- 新建 / 派活统一走「Draft → 确认」；
- Mission 走同一入口，只是 Draft 类型为 Mission，预览显示 supervisor + 计划审批。

### 7.3 Chat 进展面板

Chat 顶部加范围切换：

```text
[当前会话] [当前项目] [所有项目]
```

可收起的进展 dock：

- 运行中 / 排队 / 等待输入 / 待确认 / 最近失败；
- 每行：WorkItem key + title + Scene + Agent + Runtime + 终端；
- 操作：停止 / 重试 / 打开终端 / 跳到任务；
- 点击终端直接在右侧 Terminal 聚焦；
- 不把几十条 run 写进 transcript。

---

## 8. 统一状态

| WorkItem | Run | Terminal | 界面 |
|---|---|---|---|
| `todo` | 无 | 无 | 待执行 |
| `queued` | `queued` | 无 | 排队 / 等待并发 |
| `in_progress` | `running` (ACP) | 无 | 运行中 · ACP |
| `in_progress` | `running` (terminal) | running | 运行中 · 终端 |
| `waiting_input` | `waiting_input` | pty 等待输入 | 等待审批 / 终端输入 |
| `in_review` | `completed` | exited 0 | 待确认 |
| `todo` | `failed` | exited ≠0 | 失败，可重试 |
| `todo` | `cancelled` | closed | 已停止 |
| `in_review` | `completed` | exit 0 | 待确认 |
| `done` | `completed` | — | 已确认 |
| — | `interrupted` | interrupted | 应用重启，可恢复 |

原则：**WorkItem 是看板事实，Run 是执行事实，Terminal 是表面事实。** 三者不互相伪造。

---

## 9. 自动分配规则

按优先级匹配：

1. 用户在 Draft 里显式选择项目 / Scene / Agent；
2. `@project` / `@scene` / `@agent`；
3. WorkItem 的 scene 标签 / 类型匹配；
4. 项目默认 Scene；
5. 全局默认；
6. 都不匹配 → 显示候选与原因，让人选。

限制：

- 不自动跨项目兜底，除非 Scene 明确允许；
- 不静默把 terminal 模式换成 ACP；
- 不绕过 worktree / 并发 / 审批；
- 分配结果必须可解释（“为什么选这个 Scene”）。

---

## 10. 数据模型变更

### 新增

```text
scenes
  id, project_id, name, runtime, agent_id, command,
  cwd_mode, worktree, max_concurrent, approval,
  acceptance_json, env_json, config_yaml, notes,
  created_at, updated_at

terminals
  id, project_id, work_item_id, run_id, title, cwd,
  kind(shell|agent), status, terminal_id, exit_code,
  created_at, closed_at
```

### 扩展

```text
todos
  + scene_id
  + runtime            # acp | terminal
  + result_contract    # exit | file | none

runs
  + scene_id
  + runtime
  + result_summary
  + result_source      # acp | exit | file
```

`delegations` 不变；child WorkItem 使用自己的 scene / runtime。

---

## 11. 分阶段

### P0 · 统一视图（只读）

- Mission 卡片并入 TODO 看板，展开子任务；
- 终端元数据持久化，TODO 行显示终端状态；
- 场景总览页（左侧项目 / Scene，右侧终端 / Run / WorkItem）；
- Chat 进展 dock：当前会话 / 当前项目 / 所有项目。

### P1 · Scene 配置 + 确认

- Scene YAML / 表单编辑与校验；
- Chat Draft → 分配预览 → 确认执行；
- terminal 模式从 Draft 创建终端标签；
- 结果合同 `exit | file | none`。

### P2 · 自动分配与 Mission 终端 child

- Scene 匹配规则 + 可解释理由；
- Mission child 按 Scene 选择 ACP / terminal；
- 终端 child 的 result contract 写入 delegation；
- 场景级并发 / 预算 / 失败策略。

---

## 12. 验收场景

1. 场景总览能看到所有项目；每个项目下列出终端、运行中、待确认、最近失败。
2. 修改 Scene 的 runtime / agent 后，下一次派活生效；已有 run 不受影响。
3. Chat 聊完说“执行”，出现 Draft 预览；确认后创建 WorkItem + Run。
4. Scene=frontend 走 terminal：自动打开终端标签、在 worktree 启动 pi、写入任务；运行中消息直接写 pty。
5. Scene=backend 走 ACP：Chat 收到流式消息、审批、纠偏回执。
6. Mission 的 child 可以是 ACP 或 terminal；主管能看到每个 child 的 run / 终端 / 结果摘要。
7. Chat 切到「所有项目」能看到所有运行中 / 排队 / 待确认，并能打开对应终端。
8. 关闭终端 / pty 退出后，TODO 和 Chat 状态同步；不出现“终端没了但 run 还在跑”。
9. 应用重启后，所有终端 run 标 `interrupted`，不伪造完成。
10. 没有匹配 Scene 时不自动开跑，显示候选和原因。

---

## 13. 非目标

- 不做第二个 Mission 页面；Mission 就是 TODO 卡片。
- 不做第二个 Terminal 管理器；Terminal 是 Run 的表面。
- 不做自由文本 NL 配置驱动分配；执行规则必须结构化、可校验。
- 不做无人确认的全自动派活（至少 P0/P1 不做）。
- 不做多用户 / 云端队列；仍是本地单用户优先。
- 不读取终端 scrollback 当结构化结果；要么 ACP，要么 result contract。

---

## 14. 风险

| 风险 | 处理 |
|---|---|
| 终端模式结果不可信 | 强制 result contract；默认 `exit` 并在 UI 标注“无结构化结果” |
| Scene 配置漂移 | schema 校验 + 保存前预览 + 配置版本 |
| Mission 与 Scene 双重拆解 | Scene 只做路由/约束；拆解只由 supervisor 做 |
| Chat 进展过载 | dock 可收起，默认当前项目，所有项目是显式切换 |
| 终端持久化变成第二个 pty 系统 | 只存元数据，不存 scrollback；pty 仍由主进程持有 |
| 自动分配黑盒 | 返回匹配理由；无匹配时让人选 |

---

## 15. 待确认

1. 一个项目是单 Scene 还是多 Scene？（建议多 Scene，按标签匹配）
2. Scene 文本配置用 YAML 还是 JSON？（建议 YAML，表单同步）
3. terminal child 的默认结果合同是 `exit` 还是 `file`？（建议 `exit` + 可选文件）
4. 自动分配是否允许“无确认直接开跑”？（建议不允许）
5. 场景总览页放在左侧导航，还是并入「项目」页？（建议独立「场景」入口）
