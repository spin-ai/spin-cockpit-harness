# 工作流

## Chat 是唯一分派入口

- 未派活的会话：普通消息默认派给当前 Agent，并创建任务 + run。
- `@project` 指定项目，`@agent` 指定执行体；只写 `@project` 时使用该会话的默认 Agent。
- 运行中发消息 = 纠偏（steer）：先落 `pending`，再显示 `已注入` 或 `投递失败 · 重发`。
- 任务已确认后，消息只记录，不再起 run。
- 输入框为空时，`↑` / `↓` 可回溯当前会话的历史输入。

## 任务生命周期

```text
todo → queued → running → in_review → done
                  │           │
                  ├─ waiting_input（审批 / 等待输入）
                  ├─ failed → todo / retry
                  └─ cancelled → todo
```

- **排队**：受全局并发、主机并发、Agent 并发、同 cwd 串行约束。
- **worktree**：cwd 是 git 仓库时，每个 run 独立 worktree + 分支，避免并行互相污染。
- **确认**：待确认任务可以在 TODO 行内确认；确认后原地进入「已确认」。
- **重试**：新建 run，保留旧 run 和产物，方便对比。

## 纠偏（steer）

1. 发送时先写一条 user 消息，投递状态为 `pending`。
2. 通过同一个 ACP client 再发一次 `session/prompt`。
3. 成功 → `injected`；失败 → `failed`，可点击「重发」。
4. run 结束时仍未回执 → 一律标记 `failed`，不留下假的「已注入」。

## 项目与 worktree

- 项目 = 本地目录；切换项目会同步任务、终端、文件树和会话。
- git 仓库：自动 worktree 隔离，分支名为 `harness/<task>-<run>-<stamp>`。
- 非 git 目录：直接在目录里执行；不会伪造 worktree。
- 文件预览跟随 run 的真实 cwd，优先运行中的 worktree。

## Mission / Super Agent

![Mission 流程](./wiki/mission-flow.png)

*图：Mission → Plan 审批 → 子任务 → 审核 → 汇总。*

- Mission 是把一个目标拆成多个子任务，由 supervisor 统一推进；supervisor 只读，只有 worker 改代码。
- 计划必须先由人批准，未批准不能创建子任务；子任务仍然是普通 TODO/run，可以单独暂停、确认或取消。
- 子任务结束通过 Delegation 事件回灌主管；主管提交总结后只能进入「待确认」，由人最终确认。
- 领域模型、状态机、六条不变量与 MCP 工具见 [Super Agent / Mission](#/wiki/super-agent)。

## 验收与回写

- run 完成 → 任务进入「待确认」，并写 inbox。
- 人确认后才进入「已确认」；这是唯一的完成信号。
- 失败 / 取消会保留错误信息与 run 记录，方便重试或排查。
