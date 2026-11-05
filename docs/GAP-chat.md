# CHAT 实现现状与需求差距

> 审计对象：`src/components/TaskChat.tsx`、`electron/main.mjs`（`dispatch` / `comment` / `startRun` / `handleUpdate`）、`electron/acp.mjs`、`src/components/TerminalView.tsx`、`src/components/FilePanel.tsx`
> 对照需求：`docs/REQ-original.md`（纠正版 v3，五列线框）、`docs/REQ-multi-agent-workspace.md`（43 条，D1–D5）
> 结论速览：改造前 CHAT = **任务详情 + 单 Agent 分派表单 + ACP 消息流查看器**；需求要的是 **唯一自然语言分派入口 + 任务绑定终端内 agent 会话的控制台**。

---

## 0. 改造进展（当前）

已完成「单会话（thread）」改造，设计见 [`ARCH-chat-thread.md`](ARCH-chat-thread.md)。**第 1–5 节保留为改造前的基线审计**，用于对照；下表是逐条状态。

| 原差距 | 状态 | 说明 |
|---|---|---|
| 两态（分派表单 / 任务会话） | ✅ 已修 | 消息宿主改为 thread；Chat 永远渲染一个会话 |
| 分派原话不入会话 | ✅ 已修 | `send` 先落 user 消息，再建任务 |
| 无 agent 时产生孤儿任务 | ✅ 已修 | 失败只写错误卡片，不创建 todo |
| 发送失败丢输入 | ✅ 已修 | 仅成功时清空 composer |
| 「已注入」乐观标记 | ✅ 已修 | `pending → injected / failed` + 重发；run 结束时 pending 一律 failed |
| project 不能在 Chat 指定 | ✅ 已修 | 会话级 project 下拉；派活按会话 project 建任务 |
| NewTodo 表单绕开 Chat | ✅ 已修 | 删除 NewTodo，顶栏/⌘N 均走 `newThread` |
| Chat 内与 TODO 行重复的操作按钮 | ✅ 已修 | 停止/确认/派活/重试只保留在 TODO 行内 |
| 消息流不可按 run 回放 | ◐ 部分 | 已按 runId 插入分隔线；无折叠/回放控制 |
| 文件预览看不到 run 的 worktree | ✅ 已修 | `files:*` 支持 root，预览跟随 `run.cwd` 并标注 `run worktree` |
| Chat ↔ Terminal 同一执行通道 | ❌ 未做 | Terminal 仍是独立 shell，不在里面启动 agent（P0 遗留） |
| D4 Agent 提问 → 等待输入 | ❌ 未做 | 仍只有 ACP permission 进入 `waiting_input` |
| D5 全局自由对话 / 转 TODO | ❌ 未做 | 未绑任务的会话目前发一句话就会派活 |
| D2 step 边界投递 | ◐ 部分 | 有真实回执与失败态；未校验“消息早于下一次 tool call” |
| 长会话性能 | ❌ 未做 | 无虚拟化，全量 state 广播 |

> 下文第 1–5 节是**改造前**的实现与差距记录，不作为当前状态。

---

## 1. CHAT 改造前实现了什么

### 1.1 两种形态（同一栏）

| 形态 | 触发 | 内容 | 代码 |
|---|---|---|---|
| 分派面板 | 未选中任务 | `textarea` + agent 下拉 + 「分派」；只读显示 `项目：{state.projectPath}` | `TaskChat.tsx:72-84` |
| 任务会话 | 选中任务 | `key / 项目目录名 / 标题 / agent chip / 运行耗时`；操作 `停止 / 派活 / 确认 / 重试` | `TaskChat.tsx:41-56` |

### 1.2 分派通路（唯一的自然语言入口）

```
TaskChat.send()
  → act("dispatch", { text, agentId })            TaskChat.tsx:26-29
  → actions.dispatch                              main.mjs:303-326
      todo.title = 整句话（不拆描述 / 验收 / 项目）
      todo.cwd   = store.state.projectPath（全局）
      run        = queued → tick()
  → onSelect(created.id)，Chat 切到任务会话态
```

要点：不解析“在 `spin-publish` 用 pi …”里的 project；agent 只来自下拉框；任务创建即排队开跑（无法“只指派不开跑”）。

### 1.3 执行与流式回传

`startRun`（`main.mjs:82-181`）起 `dsh --profile acp` 子进程 → `session/new` → `session/prompt`，通知经 `handleUpdate`（`main.mjs:183-225`）落库：

| ACP 更新 | 落库结果 | 备注 |
|---|---|---|
| `agent_message_chunk` | 单条 `agent/text` 消息内追加拼接 | 真流式 |
| `agent_thought_chunk` | `agent/thought` | 样式弱化 |
| `tool_call` / `tool_call_update` | `tool/tool`，内容 = `title · status` | 无参数/输出/diff；从 `rawInput.path` 推断 artifact |
| `plan` | 只写 event | 不进 Chat |
| `session/request_permission` | `waiting_input` + ApprovalModal + system 消息 | 唯一进入 `waiting_input` 的路径 |

结束/失败/审批各写 `system` 消息与 inbox（`main.mjs:135,158,170`）。

### 1.4 会话渲染

- 按 `todoId` 过滤 `state.messages`，尾部自动滚动（`TaskChat.tsx:17-20`）；
- role = `user / agent / tool / system`，kind = `text / thought / tool / system / error`；
- 纯文本 `pre-wrap`（`styles.css:195-208`），无 Markdown / 代码块 / diff。

### 1.5 纠偏（steer）

有 active run（`running | waiting_input`）时发送消息 → `comment({ steer: true })`（`main.mjs:289-302`）：

- 写一条 `injected=true` 的 user 消息；
- 对同一个 ACP client **并发**再调 `client.prompt(text)`；
- 无 active run 时只落一条普通评论：不投递、不起 run。

### 1.6 状态联动

| 操作 | 效果 | 代码 |
|---|---|---|
| 确认 | `confirmed=true`、`status=done`，就地进「已确认」 | `main.mjs:327-335` |
| 停止 | run `cancelled`、todo 回 `todo` | `main.mjs:385-397` |
| 重试 | 新 run，旧 run 保留 | `main.mjs:398-412` |
| 派活 | 对 `todo` 状态任务新建 run | `main.mjs:336-350` |

所有变更走 `broadcast()` 全量 state 推送。

---

## 2. 与 `REQ-original.md`（纠正版 v3）的差距

| # | 需求 | 现状 | 差距 | 级别 |
|---|---|---|---|---|
| 2 | Chat 是唯一分派入口；一句话指定 project + agent + 要做的事 | 只能选 agent；project 是全局固定值且 UI 无切换入口（`harness:chooseProject` 有 IPC，但无任何调用方）；`NewTodo` 表单、`planToday` 模板、TODO 行内「派活/重试」均绕过 Chat | 多入口并存；不解析 project / agent 语义 | P0 |
| 3 | 任务 = project → terminal → agent，agent 在该 terminal 启动登录 | Chat 分派走 ACP 子进程；Terminal 是独立登录 shell（`TerminalView.tsx:27`、`main.mjs:517`），不启动 agent、不与 ACP 会话共享 | Chat 与 Terminal 是两条互不相通的通道 | P0 |
| 4 | Terminal 默认打开当前任务项目目录与 agent，多标签 | 选中任务即按 `key` 重建 shell，无标签；cwd 用 `todo.cwd`，而 ACP run 实际在 worktree（`main.mjs:94-98`） | 目录不一致；无 agent；无多标签 | P0 |
| 5 | 状态分组即看板；行内 project / agent / 状态 / 耗时；点行同步 | 已实现 | 耗时仅 active run 有，queued 显示 `—` | 已满足（细节） |
| 6 | 文件/产物预览可看 agent 改动 | 预览根 = 全局 `projectPath`（`main.mjs:494,505`），不是 run worktree | 验收场景 1/5 断链 | P0 |
| 7 | 完成后结论 / 产物 / 退出状态回到任务 | 只有 Chat 文本 + `run.completed` + todo→`in_review`；无结构化结论、退出码、产物清单；`missingWriteback` 永远 false | 仅文本层回写 | P1 |
| 9 | 纠偏必须进入当前运行，不重开任务 | running 时经 ACP prompt 注入；无投递回执、无降级；`injected` 无条件 true；queued 时消息只落评论；Terminal 输入完全不影响 run | 可靠性不达标 | P0 |
| 10 | 不同 project 多任务并行 | 只有一个全局 projectPath | Chat 无法指定项目 | P0 |
| 1 | 固定五列、除 Terminal 外可折叠 | Chat / TODO / 文件栏均无折叠 | 未实现 | P1 |
| §6 | 完成判定：进程退出 vs agent 主动回写 | 取「`session/prompt` resolve 即完成」，无一致性校验 | 待产品决策 | — |

---

## 3. 与 43 条规格 D1–D5 的差距

| 编号 | 要求 | 现状差距 |
|---|---|---|
| D1 | 每条 TODO 一个会话流（消息/工具/命令/文件改动/错误），可回放历史 run | 消息是扁平流，不按 run 分组、不可回放；tool 只有 `title · status`，无参数/命令输出/diff/文件改动；无 Markdown/代码块/复制 |
| D2 | 最近 step 边界投递、投递回执、不支持时降级「已排队至下一轮」、默认目标为最新 active run、多条保序 | 对 in-flight prompt 再发 `session/prompt`，是否被接受未检测；失败只写 event 而 UI 仍显示「已注入」；无降级态、无回执、无多目标选择；queued 时消息不进 run |
| D3 | 暂停 / 继续 / 中止 / 重试（重试新 run） | 只有停止 / 重试；**无 pause / resume** |
| D4 | Agent 提问 → `等待输入` + 置顶提醒 → 回答后继续同一 run | 仅 ACP permission 会置 `waiting_input`（走 ApprovalModal）；普通提问不识别；Chat 无置顶/高亮；无“回答恢复同 run”路径 |
| D5 | 全局对话：任选 Agent 一对一、不绑定 TODO、可转成 TODO 并保留上下文 | 完全未实现；未选任务时是分派表单，每次发送必建 TODO |

关联条款同样缺失：

- `B1` 验收标准为空不得指派（dispatch 直接开跑）
- `C1` 只指派、暂不开跑（Chat 路必起 run）
- `C2` 广播（action 已存在，UI 无入口）
- `C3` 排队原因展示
- `K2/K3` Context Envelope 随任务下发，且注入内容在消息里可见
- `N2/N3/N4` @ 路由 / `/` 快捷操作 / 附件与版本
- `E2` 回写三项校验（状态 + 结论 + 产物）
- `Q3` token / 成本（run 上永远 0）

---

## 4. 实现层面的具体缺陷

| # | 缺陷 | 位置 | 影响 |
|---|---|---|---|
| 1 | 分派内容不入会话：`dispatch` 不写 user message | `main.mjs:303-326` | 新任务 Chat 第一屏只有 system「run started」，用户原话只存在标题 |
| 2 | 无 agent 时产生孤儿任务：先 `unshift(todo)`，再 `if (!agent) throw` | `main.mjs:313-316` | 异常时任务已落库、无 run |
| 3 | 发送失败丢输入：先 `setText("")` 再 await | `TaskChat.tsx:24-25` | IPC 抛错时用户文本丢失 |
| 4 | steer 的 `active` 判定与真实投递脱节 | `main.mjs:292-297` | `client.prompt` 失败仅记 event，UI 仍标「已注入」 |
| 5 | 流式追加不触发滚动；新消息强制拉到底 | `TaskChat.tsx:17-20` | 长消息不跟随；翻历史被打断 |
| 6 | 消息无虚拟化/分页，每个 chunk 全量广播 state | `main.mjs:224`、`db.mjs:67-89` | 长会话明显变慢 |
| 7 | 确认不可撤销 | `main.mjs:327-335` | 与 REQ §6 待确认项一致，已知取舍 |

---

## 5. 验收场景核对（`REQ-original.md` §4）

| 场景 | 结果 | 断点 |
|---|---|---|
| 1. Chat 说“在 `spin-publish` 用 pi 把首页标题改大” → 任务 → Terminal 起 pi → 运行中 → 文件预览看改动 → 待确认 → 确认 | ❌ 不通过 | 不解析 project；Terminal 不起 pi；预览看的是原目录而非 run worktree |
| 2. 运行中在 Terminal 直接输入纠正 → 当前 agent 回合收到 | ❌ 不通过 | Terminal 与 ACP 会话无关联 |
| 3. 两任务不同 project / Terminal / agent 并行 | ❌ 不通过 | 只有全局 project |
| 4. 完成后不确认仍为待确认；确认后就地已确认 | ✅ 通过 | `in_review` → `done`，同一条列表 |
| 5. 文件树点开产物 → 右侧预览 | ⚠️ 部分 | 预览能开文件，但根目录不是 run 的 worktree，产物文件通常不在其中 |

---

## 6. 优先级建议（按端到端场景收敛）

1. **P0 · 打通 project 维度**：任务级 `projectId/cwd`、Chat 内项目选择、`dispatch` 解析/绑定项目、文件树与终端按任务 cwd 打开。
2. **P0 · 统一执行通道**：任务 Terminal 内直接起 agent CLI 并由 harness 捕获输出，或把 ACP run 的会话绑定到该 Terminal 标签；两者只能留一条。
3. **P0 · 纠偏可靠化**：投递回执（step 边界/失败重试）、“已注入”与“已排队至下一轮”可区分、queued 态消息入队。
4. **P1 · 会话可用性**：run 分组与回放、tool 参数/输出/diff、Markdown、虚拟化。
5. **P1 · D4/D5**：提问识别与置顶、全局对话与「转成 TODO」。
6. **P1 · 收口**：结构化回写校验（结论/产物/退出码）、单入口化（移除 `NewTodo` 与行内派活，或明确降级为“草稿”）。

---

## 7. 一句话结论

现在 CHAT 是 **「任务详情 + 单 Agent 分派表单 + ACP 消息流查看器」**；原始需求要的是 **「唯一自然语言分派入口 + 任务绑定终端内 agent 会话的控制台」**。

三个最关键的断点：

1. **project 无法在 Chat 中指定**（全局单项目）；
2. **Chat 的 agent 不在 Terminal 里跑**（终端与 run 互不相通，目录还不一致）；
3. **纠偏没有可靠投递 / 回执 / 降级**（`injected` 是乐观标记）。
