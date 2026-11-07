# 工作流

> 一条任务从 Chat 里的一句话，走到 TODO LIST 里的「已确认」。

## 早上九点，你打开工作区

昨天留下的两个任务还在「待确认」。你没有先去看终端，也没有翻聊天记录，而是在 TODO LIST 里点开其中一个，接着昨天的会话继续问。

这就是工作流想解决的问题：**状态不靠人记，任务自己往前走。**

## 派活不是发消息，是创建状态

在未派活的会话里，普通消息默认交给当前 Agent。发送之后，系统先落消息，再创建 TODO + queued run：

```text
send(threadId, text)
  → 解析 @mention / project / agent
  → 创建 todo（首次派活）
  → queueRun()
  → tick() 放行
  → startRun()
```

![send 状态机](./wiki/send-state.png)

*图：send() 的六种去向。失败时用户原话仍在会话里，不会产生孤儿任务。*

如果消息里带 `@别名`，就路由到对应 Agent 或项目；如果从预览里拾取了元素，则把结构化界面上下文一起带进 prompt。

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

![调度器](./wiki/scheduler.png)

*图：排队不是装饰。排队原因、并发约束和 run 的状态都落在同一套数据里。*

## 运行中继续说话，就是纠偏

任务跑起来之后，Chat 不会变成只读的日志窗口。你仍然可以在同一个输入框里补一句：

> 标题再小两档，保留品牌蓝。

这条消息不是“再发一个任务”，而是走 steer：

1. 先写一条 user 消息，投递状态为 `pending`。
2. 通过同一个 ACP client 再发一次 `session/prompt`。
3. 成功 → `injected`；失败 → `failed`，可点击「重发」。
4. run 结束时仍未回执 → 一律标记 `failed`，不留下假的「已注入」。

投递回执看起来只是三个小字，但它决定用户是否相信系统。**没有回执的乐观，最后都会变成“用户以为成功了，其实没有”。**

## worktree：并行不是多开几个窗口

如果项目是 git 仓库，每个 run 会得到独立的 worktree 和分支：

```text
harness/<task>-<run>-<stamp>
```

这样两个任务可以同时改同一个仓库，而不会互相覆盖。文件预览跟随当前 run 的真实 worktree，所以你在右侧看到的就是 Agent 正在改的那份文件。

非 git 目录则直接在原目录执行，不会伪造 worktree。

## Mission：当任务多到需要“主管”

当你有五个任务、三个 Agent，问题会从“执行”变成“组织”：谁拆任务、谁盯进度、谁汇总结果？

Mission 模式让人只做三件事：批准计划、看进度、最终确认。主管负责拆解和委派，子任务仍然是普通 TODO/run，可以单独暂停、确认或取消。

![Mission 状态机](./wiki/mission-state.png)

*图：Mission / Supervisor Run / Delegation 三套状态机；主管只读，worker 才改代码。*

领域模型、六条不变量和 MCP 工具见 [Super Agent / Mission](#/wiki/super-agent)。

## 验收与回写

- run 完成 → 任务进入「待确认」，并写 inbox。
- 人确认后才进入「已确认」；这是唯一的完成信号。
- 失败 / 取消会保留错误信息与 run 记录，方便重试或排查。

Agent 可以建议「做完了」，但不能替人宣布「验收通过」。
