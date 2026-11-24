> 层：架构 · 状态：部分落地 · 核对：2026-11-24 · 覆盖：Bot ↔ 终端 / 对话的双向通道、为什么不做全量 CLI、窄通道的范围与安全边界

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
| `harness ask --text "…" [--timeout 300]` | 需要人确认时发起审批 | 桌面 `ApprovalModal`（允许 / 拒绝）；CLI 轮询到决定后返回 | 不能自批；超时（30–900 秒）自动收掉并告知；run 回 `running` |

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

### 4.3 ACP 侧的 MCP

ACP（dsh）不是 shell，给它单独挂一个 MCP：

```text
harness_whoami / harness_note / harness_report
  → electron/harness-mcp-bridge.mjs（stdio MCP）
  → POST 127.0.0.1/call（同一个 token 服务）
```

- 只在**本地** ACP run 挂载；远端 run 连不到本机回环，不挂。
- token 仍然按 run 下发，run 结束（`finally`）撤销。
- 与 pty 的三条 CLI 命令共用同一个主进程服务，不复制权限逻辑。

### 4.4 远端（SSH 主机）

远端不能直接访问本机 `127.0.0.1`，所以用**反向隧道 + 远端 shim**：

```text
本机 bridge 127.0.0.1:<localPort>
  └─ ssh -N -R 127.0.0.1:0:127.0.0.1:<localPort> <host>   # 拿 remotePort
       └─ 远端 env: COCKPIT_AGENT_URL=http://127.0.0.1:<remotePort>
                    PATH 前置 $HOME/.cockpit-harness/bin
```

- **远端 shim**：POSIX shell，只依赖 `curl` + `base64`；正文用 base64 传，避免 shell 拼 JSON。首次在主机上安装到 `$HOME/.cockpit-harness/bin/harness`（`ssh` + base64 写入，不落本机脚本）。
- **远端 pty run**：本地 pty 包 `ssh -tt`，远端命令 `cd <cwd> && env <bridge env> <agent cli>`；输出、停止、结算仍走现有 pty 路径。
- **手动远端 shell**：终端「＋」菜单按主机列出「新建终端 · <host>」；`terminal:create` 接受 `hostId`，远端命令 `cd <defaultCwd> && exec "$SHELL" -l`；`terminals.host_id` 落库，Pane / 标签落盘恢复都带它，重启仍回同一台。
- **远端 ACP run**：`AcpClient` 支持 `sshEnv`，ssh 远端命令变成 `env <assignments> dsh --profile acp`；远端有 `node` 时把 `harness-mcp.mjs` 装到 `$HOME/.cockpit-harness/bin` 并挂成 MCP（其他本机 MCP 仍不挂远端）。
- 反向隧道优先用 `-R 0` 让服务端分配端口；老版本退回 `49300–49307` 固定端口段，转发失败直接判失败。
- 没有 `curl` / `base64` / 反向隧道失败：agent 仍能跑，只是没有 `harness`；事件与提示不假装成功。
- token 仍按 run 下发、run 结束 / 终端退出即撤销；隧道进程按 run / 终端关闭。
- 同一 SSH 主机首次安装 shim 会缓存；主机改名 / 换地址会重新安装。

**安全边界**：远端 agent 与本地 agent 处在同一个「受管 run」信任层；token 只存在内存，且会出现在远端进程环境 / 参数中（同机同用户可见）。不接受远端 agent 发任意 action；`ask` 仍只能请人决定。

### 4.5 与内置 bot 的关系

内置 bot 的工具表**不含** `harness` / `exec` / 任意 shell；它和终端交互靠的是下面这五个带授权前缀的工具，每一个都只能作用在「它自己的活」上：

| 方向 | 工具 | 档位 | 作用范围 / 拒绝条件 |
|---|---|---|---|
| Bot → 终端（纠偏） | `worker_send` | dispatch / work | 正在跑的 run（自己名下或交接工作区里）；pty 直接写入，ACP 作为下一次 prompt |
| Bot → 终端（直接敲一行） | `terminal_write`（2026-11-24） | **work** | 交接工作区里的终端，或自己名下 run 的终端；人在接管（`controlBy=user`）时拒绝；终端已退出时说明；不新建 / 不 kill / 不接受任意路径 |
| Bot → 对话 | `task_say`（2026-11-24） | dispatch / work | 自己的任务 / 交接工作区 / 绑定项目；写进会话（`〔bot〕…`），**不打断**运行的 run（纠偏走 `worker_send`） |
| 终端 / 对话 → Bot | `harness note` / `report` | — | 同一句话落 `bot_turns(decision=noted, from=<agent>)`（2026-11-24），下一轮进 system 的背景段，1 小时外不再喂 |
| 终端 → 人 | `harness ask` | — | 桌面审批；不能自批 |

两条边界仍然成立：

1. **不照搬全量 CLI**：`terminal_write` 不是「给 bot 一个 shell」，它没有新开终端、没有工作目录选择、没有 `kill`，且必须先有**人**做过的交接（`bot_workspaces`）或 bot 自己起的 run；
2. **署名分开**：执行体说的话是 `noted`（谁回的、回给谁），bot 自己说的话是 `answered / replied / task_say`。两者混在一起时，「是谁决定的」就查不出来了。

---

## 5. 还没做（下一步）

| 缺口 | 说明 |
|---|---|
| ~~ACP 侧 harness MCP~~ | 已做：`harness_whoami / note / report`（本地 run；远端不挂） |
| ~~远端终端~~ | 已做：远端 pty run + SSH 反向隧道 + 远端 shim；远端 ACP 走 `sshEnv`，有 node 时也挂 harness MCP；手动远端 shell 已进终端「＋」菜单 |
| **双向 peer mail / inbox** | `note` 现在已经同时落成 bot 回合（`noted`）并进下一轮背景；还缺跨 run / 跨机 / 离线的收件箱（群内有 `bot_peer_mail`，全局没有） |
| **远端终端** | token 只在本机回环；SSH 终端需要隧道或远端 serve |
| **多选项 / 带上下文的审批** | 现在只有允许 / 拒绝；还没有多方案选择、附件、审批历史页。ACP 原生 permission 仍更完整 |
| **CLI 子命令扩展** | 故意只保留 3 条；每加一条都要重新判断是否可用 `actions` 里的安全子集 |
| **bot 侧新增写终端 / 说话工具** | 只有 `terminal_write` / `task_say` 两条，且都限定在「交到它手上的活」；不做 `terminal_create` / `terminal_kill` / 任意 `run_command` |

---

## 6. 验收

| 判据 | 落点 |
|---|---|
| 参数解析：未知命令 / 缺值 / note 无正文报错 | `tests/agent-bridge.test.mjs` |
| 垫片：Unix sh / Windows cmd 都带 `ELECTRON_RUN_AS_NODE=1` 与正确引号 | 同上 |
| 截断不产生半截 | 同上 |
| CLI 脚本存在且读 token | 同上 |
| 主进程 token 服务：whoami / note / report 仅三种命令 | 手动：起一条 pty agent，执行 `harness whoami` / `note` / `report`，在会话与 run 结果里看到 |
| 回话到 bot：`note` 落 noted 回合、进 system 背景段、1 小时后不再喂 | `tests/bot/bridge.test.mjs` |
| 指挥面授权：`terminal_write` 只对交到手上的终端 / work 档；`task_say` 只对自己的活 | `tests/bot/tools.test.mjs` + 手动 |
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
