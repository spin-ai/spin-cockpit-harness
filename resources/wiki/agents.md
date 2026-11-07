# Agent 与执行适配器

## Agent 是执行目标

一个 Agent = 名称 + CLI + 主机 + cwd + 别名 + 并发上限；Mission 模式额外有 `role`（worker / supervisor）。

- 在终端里启动 CLI 会自动登记 Agent；
- 也可以在 Chat 里点「＋ dsh」纳管一个无需终端的 dsh Agent；
- `@别名` 在项目内唯一，用来从 Chat 路由。
- supervisor 只读、只派给 worker；worker 才写代码。详见 [Super Agent / Mission](#/wiki/super-agent)。

## 适配器矩阵

| CLI | Chat 派活 | 说明 |
|---|---|---|
| `dsh` | ✅ ACP | `dsh --profile acp`；支持运行中纠偏 |
| `pi` / `claude` / `codex` / `opencode` | ❌ 仅终端 | 尚未接入 Chat 执行适配器；选中会明确报错 |

> 不静默回退：选了 `pi` 却实际跑 dsh 是错误行为，现在会直接提示。

## dsh ACP

![ACP 时序](./wiki/acp-sequence.png)

*图：一句话从 send 到 queueRun、ACP prompt、流式落库、审批与收尾。*

- 每个 run 一个独立 ACP client（stdio；远端走 SSH）。
- 握手：`initialize` → `session/new` → `session/set_config_option`（model / effort）→ `prompt`。
- 流式事件：`agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `plan`。
- 权限：`session/request_permission` 进入审批队列；可自动批准 / 拒绝。
- 完成：`prompt` resolve 即 run 结束；失败写错误分类与 inbox。

![MCP bridge](./wiki/mcp-bridge.png)

*图：stdio MCP bridge ↔ 主进程 HTTP /call；Mission 也复用这条链路。*

## 模型与审批

- 模型 / effort 在设置 → 执行里配置；新 run 生效。
- 审批策略：每次询问 / 自动批准 / 自动拒绝。
- 每个 Agent 有并发上限；全局并发与主机并发再叠加。

## 并发与队列

- 同一 cwd 同时只允许一个 run，避免互相覆盖。
- 排队原因会记录在 run 上：主机离线 / 等待全局并发 / 主机并发已满。
- worktree 让不同任务可以在同一仓库并行，但每个 run 仍有独立目录。

## 扩展方式

新增一个 CLI 适配器需要：

1. 在 `electron/main.mjs` 的 `EXECUTORS` 登记；
2. 实现启动、事件归一化、cancel（以及可选的 steer）；
3. 声明 `implemented: true` / `supportsSteer`。

Chat、TODO、设置页会自动读取适配器矩阵。
