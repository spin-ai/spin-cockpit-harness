> 层：架构 · 状态：部分落地 · 核对：2026-11-23 · 覆盖：Bot ↔ Terminal 的通信方式、为什么不做全量 CLI、窄通道的范围与安全边界

# Arch · Agent Bridge（Bot ↔ Terminal）

> 需求条目：[`../product/REQ-bot-workspace.md`](../product/REQ-bot-workspace.md) US-W18 / SR-W11。
> 上游：[`ARCH-bot-workspace.md`](ARCH-bot-workspace.md)（交接 / 运行 / 终端）、[`ARCH-workbench-execution.md`](ARCH-workbench-execution.md)（Run / Terminal 归属）、[`ARCH-bot.md`](ARCH-bot.md)（内置 bot 的工具表）。
> 参照：`third-part/orca @ 1ab037e`（MIT，本地只读副本，不入库）。

## 0. 结论先说

**不需要照搬 ORCA 的全量 CLI。**

ORCA 的 `orca ...` 本质是**runtime 的 RPC 客户端**：bot 是跑在 bot home 里的 agent CLI，它和 terminal 里的 worker 都通过 CLI 调同一个 runtime（`src/cli/runtime/client.ts` 走 WebSocket）。CLI 不是「bot 和 terminal 之间」的专线，而是「所有 agent 对 runtime 说话」的入口。

我们的 runtime 是 Electron 主进程，内置 bot 已经有**更直接、更安全**的入口：function calling → `botReadTool` → 主进程动作。再加一层 CLI 只会多一条子进程 + token 通道，解决不了内置 bot 的问题。

**真正缺的是终端里的 pty agent**：它只有 shell，没有 IPC / MCP。所以本轮只加一条**窄通道**：

```text
pty agent ── harness whoami / note / report ──> 主进程 token 服务
```

三条命令，token 只覆盖**这次 run / 这条终端**，不暴露 action bus、不能跑任意命令、不能绕过审批。

---

## 1. ORCA 是怎么做的

| 事实 | 源码锚点（`third-part/orca @ 1ab037e`） |
|---|---|
| bot 的 system prompt 明确告诉它用 `orca` CLI 做事 | `src/main/bots/bot-preamble.ts` 的 `BOT_TOOLS` / `botRules` |
| CLI 命令包括 `bot reply`、`bot item`、`worktree ps`、`orchestration send`、`automations ...` | 同上；`src/cli/` 下的 commands |
| CLI 不是直接改文件，而是连 runtime | `src/cli/runtime/client.ts`（WebSocket transport）、`src/cli/runtime/connection/websocket-transport.ts` |
| bot / terminal agent 看的是同一个 runtime 状态 | `bot-preamble` 的 `worktree ps` / `bot work list` / `bot list` 都是 runtime 读 |

所以 ORCA 的「通信」不是 bot 往 pty 写字节，而是**双方都写进 runtime 的共享状态**，CLI 只是写入方式。

---

## 2. 我们本来有什么

| 方向 | 现在的方式 | 覆盖度 |
|---|---|---|
| Bot → Terminal / Run | `task_create` / `run_start` 起 run；`worker_send` 往 pty 写或 ACP prompt；`work_list` / `run_log` 读状态与尾部 | ✅ 已够用 |
| Terminal → Bot | run 结束 `settleTerminalRun` / ACP 结算 → `bots().report()` 回流；`todo_update --comment` 写任务会话 | ◐ 只有「结束时」和「人手动写」 |
| 终端 agent 主动说话 | 没有通道 | ❌ 本轮补 |

**关键判断**：内置 bot 不在 shell 里，它的工具表已经能覆盖 Bot → Terminal；缺的是反方向——pty 里的 agent 想中途说一句 / 报个结论，没有入口。

---

## 3. 为什么不做全量 CLI

| 方案 | 问题 |
|---|---|
| 把内置 bot 改成 CLI 客户端 | 多一层子进程、token、路径解析；内置 bot 已经能直接调动作，收益为负 |
| 把 `actions` 全量暴露给 CLI | 等于给终端里任意进程一个「改设置 / 装插件 / 改文件」的入口；违反审批不变量 |
| 用 CLI 代替 MCP | ACP agent 原生支持 MCP（我们已有 wiki / mission / browser bridge）；再包一层 CLI 是重复 |
| 不给终端任何入口 | pty agent 只能靠退出码和终端尾部；中途问题、结论都只能靠人肉看屏幕 |

**取舍**：MCP 优先给 ACP；CLI 只做 shell 的最小回调。两条通道共享同一个 token 范围原则，不共享一套全量命令。

---

## 4. 窄通道实现

### 4.1 三条命令

| 命令 | 作用 | 写哪里 | 不能做什么 |
|---|---|---|---|
| `harness whoami` | 当前 run / 任务 / agent / cwd | 只读 | — |
| `harness note --text "…"` | 中途进度、疑问、需要人看的信息 | 当前任务会话里一条 `〔agent〕…` system 行 | 不能改 run 状态、不能改任务、不能给别的 run 写 |
| `harness report --text "…"` | 这次运行的结论 | `run.result`（`resultSource = agent_cli`）+ 一条「agent 汇报」；pty 退出时的尾部**不会覆盖**它 | 不能把 run 标完成 / 失败；结算仍由 pty 退出 / ACP 结束做 |

`--text-file <path>` 用于多行文本；超过 4000 字截断，末尾标省略号。没有 token 时 CLI 明确报「这条终端不在受管 run 里」，不假装成功。

### 4.2 通道与鉴权

```text
pty spawn
  ├─ 生成一次性 token（绑定 terminalId / runId / todoId / cwd，24h 过期）
  ├─ PATH 前置 userData/bin，写入 `harness` 垫片
  └─ 注入 COCKPIT_AGENT_URL / COCKPIT_AGENT_TOKEN / COCKPIT_CLI

harness ... → POST 127.0.0.1:<random>/call（Bearer token）
  → 主进程解析 token → 只允许 whoami / note / report
  → note: 当前任务 thread；report: 当前 run 的 result
```

- **只监听 `127.0.0.1`**；端口随机；token 随机 20 bytes。
- token 只存在内存，pty 退出 / 关标签即撤销；24h 兜底过期。
- CLI 垫片只在**受管 agent 终端**注入；手动 shell 不注入。
- `note` / `report` 正文出站前走 `redactSecrets`；不写进 SOUL/MEMORY。
- 仍然**没有**任意 shell、改文件、改设置、审批动作。

### 4.3 与内置 bot 的关系

内置 bot 的工具表**不含** `harness` / `exec` / `terminal`；它仍然通过 `worker_send`、`task_create`、`run_start` 和 `run_log` 和终端交互。窄通道只给 pty 里的 agent，不反向扩大 bot 的能力面。

---

## 5. 还没做（下一步）

| 缺口 | 说明 |
|---|---|
| **ACP 侧的通用 harness MCP** | dsh 已能挂 MCP；下一步可把 `work_list` / `note` / `report` 也做成 MCP tools，让 ACP agent 不依赖 shell |
| **双向 peer mail / inbox** | 现在 `note` 只是「写给当前任务会话」，不是给某个 bot 的收件箱；跨 run、离线的消息还没有 |
| **远端终端** | token 只在本机回环；SSH 终端需要隧道或远端 serve |
| **审批类回传** | agent 不能通过 CLI 请求批准 / 选方案；仍走 UI 审批 |
| **CLI 子命令扩展** | 故意只保留 3 条；每加一条都要重新判断是否可用 `actions` 里的安全子集 |

---

## 6. 验收

| 判据 | 落点 |
|---|---|
| 参数解析：未知命令 / 缺值 / note 无正文报错 | `tests/agent-bridge.test.mjs` |
| 垫片：Unix sh / Windows cmd 都带 `ELECTRON_RUN_AS_NODE=1` 与正确引号 | 同上 |
| 截断不产生半截 | 同上 |
| CLI 脚本存在且读 token | 同上 |
| 主进程 token 服务：whoami / note / report 仅三种命令 | 手动：起一条 pty agent，执行 `harness whoami` / `note` / `report`，在会话与 run 结果里看到 |
| 手动 shell 没有 `harness` 注入 | 手动：新建普通终端，`harness whoami` 应报无 token |

---

## 7. 代码位置

| 面 | 文件 |
|---|---|
| CLI 参数 / 截断 / PATH 垫片（纯函数） | `electron/agent-bridge.mjs` |
| `harness` CLI（HTTP 客户端） | `electron/agent-cli.mjs`（打包进 `asarUnpack`） |
| token 服务 / 三个命令 / 环境注入 | `electron/main.mjs`（`startAgentBridge` / `agentBridgeEnv` / `issueAgentToken`） |
| 打包 | `package.json` 的 `asarUnpack` |
| 用例 | `tests/agent-bridge.test.mjs` |
