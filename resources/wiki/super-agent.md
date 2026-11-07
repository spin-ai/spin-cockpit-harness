# Super Agent / Mission

> Supervisor 不是更强的 worker，而是 Mission 级编排者：拆解目标 → 提交计划 → 委派子任务 → 汇总结果。

参考：`docs/ARTICLE-zhihu-super-agent.md`。

## 角色边界

| 维度 | Worker | Supervisor |
|---|---|---|
| 目标 | 完成一个子任务 | 完成一次 Mission |
| 输出 | 代码 / 文件 / 测试 / 结论 | 计划、委派、汇总 |
| 权限 | 可写（受审批约束） | 默认只读 |
| 生命周期 | 一个 run | 多轮 prompt，跨越子任务 |
| 产物宿主 | child Todo + Run | Mission + Delegation |
| 能否派活 | 否 | 只能派给 worker |

- 只做一层：`Supervisor → Worker`，不允许 Supervisor 派给自己或另一个 Supervisor。
- 主管不写代码；代码改动继续走 worker 的 run / worktree / 审批链路。

## 领域模型

```text
Mission（todos.kind = 'mission'）
 ├─ Mission Thread（threads.kind = 'mission'）
 ├─ Supervisor Run（runs.kind = 'supervisor'）
 │   ├─ mission_plans（计划 revision）
 │   └─ Delegations（合同）
 ├─ Child Todo A → Worker Run A（独立 worktree）
 ├─ Child Todo B → Worker Run B
 └─ Mission Summary → 人确认
```

一期不新建 `missions` 表：Mission 复用 `todos`，只加 `kind` / `mission_state` 等字段；新增 `mission_plans` 与 `delegations` 两张表。

- **Plan** 按 revision 保存，批准后不原地覆盖。
- **Delegation** 是主管与子任务之间的事实源，记录 child todo / run / agent / 验收 / 结果 / 分支。
- Mission 进度由 child Todo + Delegation 派生，不靠解析聊天记录。

## 状态机

```text
Mission
planning → plan_review → waiting_children → in_review → done
    └──────────┴──────────────┴──→ failed / cancelled / interrupted

Supervisor Run
queued → running → waiting_plan → waiting_children → completed

Delegation
proposed → queued → running → waiting_input → completed → accepted
              └────────┴──────────┴──────────┴→ rework / failed / cancelled
```

- `todos.status` 继续服务看板；`todos.mission_state` 表达 Mission 自己的生命周期。
- `waiting_children` 不混用 `waiting_input`：前者在等子任务，不计入 worker 并发；后者是 ACP 审批。

## 六条不变量

1. 一个 Mission 只能有一个当前计划（最新 `approved` 或 `draft`）。
2. 一个子任务最多一个当前 delegation；返工产生新 run，不重复建 child todo。
3. 只有 `approved` 的计划允许创建子任务。
4. Supervisor 不能派给自己，也不能派给另一个 Supervisor。
5. Mission 完成必须由人确认；主管只能提交 `in_review`。
6. 取消 Mission 必须级联取消 supervisor + 所有未终态 delegation / child run。

没有对应代码的不变量，等于没写。

## 计划：可审批的合同

Plan JSON 的核心是 `steps[]`：每步有 `key` / `title` / `brief` / `acceptance`。

- 模型提交后先校验：字段完整、key 唯一、依赖存在、没有自环。
- 未批准的计划不能创建任何子任务。
- Plan Card 让人只做三个动作：批准、编辑、退回。
- 主管 prompt 只写规则和边界，不靠“你是主管”这种自由发挥。

## 委派与回灌

- `task_delegate` 创建 child Todo + Delegation + worker run；计划必须已批准。
- 前向依赖写进 Delegation，不靠模型自觉排序。
- 只有 worker 能被派活；结果不可信，必须回到主管审核。
- child run 结束 → Main 更新 delegation → 给 supervisor 发一条紧凑事件，**不轮询**。
- 事件只带：子任务 id / 状态 / 摘要 / 分支 / 剩余数量；完整 transcript 用 `task_get` 按需读。
- ACP prompt 串行：supervisor handle 维护队列，一次只有一个 prompt 在飞。
- 每次 prompt 返回后由 Main 收敛状态，主管不需要“记得”自己处于哪一步。

## MCP：受控的手

| 工具 | 作用 | 约束 |
|---|---|---|
| `mission_plan` | 提交 / 修订计划 | 只能操作当前 Mission |
| `task_delegate` | 新增子任务 | 计划已批准；只能派 worker；不超上限 |
| `task_list` / `task_get` | 查看子任务 | 只能看当前 Mission |
| `task_review` | 接受 / 返工 / 取消 | 接受子任务 ≠ 确认 Mission |
| `task_steer` | 纠偏运行中的子任务 | 复用 `deliverSteer`，有投递回执 |
| `task_retry` | 重试失败子任务 | 新建 run，保留旧 run |
| `mission_finish` | 提交总结 + artifacts | 只能进 `in_review`；有未结束子任务时拒绝 |

没有 `shell`、`read_file`、`write_file`、`spawn_agent`。主管的工具面越小，编排越可预测。

安全边界：

1. 只监听 `127.0.0.1`，端口随机。
2. 每个 supervisor run 一个随机 token。
3. 请求里的 `missionId` 必须与 token 记录一致。
4. 请求体上限 2MB；Mission 结束 / 失败 / 取消时立即吊销 token。

## 双调度

Mission 模式必须与 dsh 原生 subagent / Agent Teams / workflow **二选一**：

- supervisor profile 里禁用 `subagent`、`subagent_fork`、`agent-team`、`workflow` 等入口；
- supervisor sandbox 设为 `read-only`。

否则模型可能绕过 `task_delegate` 直接起原生 subagent：Harness 看不到 child Todo，看板空着、统计少一半、收件箱没有子任务，而且不会报错。

## 失败、取消与重启

- 重启后不能假装还在跑：未完成 Mission → `interrupted`，supervisor run → `interrupted`，未终态 delegation → `failed`。
- 恢复不是复活进程：创建新的 supervisor run，明确告知已有计划和子任务，先 `task_list` / `task_get` 看现状。
- 取消 / 失败必须级联：supervisor + 所有未终态 child run / delegation / token。
- `mission_finish` 只是提交总结；人点「确认完成」才进入 `done`。

> Agent 可以建议「做完了」，但不能替人宣布「验收通过」。

## UI

- 不新增「Super 模式」页面，复用 Chat 和 TODO 看板。
- Mission 用 Mission 卡片 / 计划卡片 / 委派卡片表达状态。
- 输入框语义保持单一：计划未批准时发消息 = 修订计划；子任务运行中 = 纠偏；Mission 完成 = 仅记录。
- 统计按 supervisor / worker run 分开，Mission 级事件不混进普通任务成功率。
