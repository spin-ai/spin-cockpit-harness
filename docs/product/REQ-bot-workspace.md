> 层：需求 · 状态：部分落地 · 核对：2026-11-24 · 覆盖：把项目 / worktree / 终端交给机器人的交接语义、双向通信与可见面

# 需求 · 机器人工作区交接

**一句话**：机器人不该只会「聊」——人把**一个项目、一个 worktree、一条终端目录**交给它之后，它要能看见那里的事实、在那里起活、跑完把结果带回来；交回时关系干净结束。

**范围**：工作区的**交出去 / 看得见 / 在那里干活 / 交回来**。不含 Bot 聊天窗口呈现（[`REQ-bot-chat.md`](REQ-bot-chat.md)）、智能度（[`REQ-bot-intelligence.md`](REQ-bot-intelligence.md)）、Mission 编排（[`../arch/ARCH-super-agent.md`](../arch/ARCH-super-agent.md)）。

**设计**：[`../arch/ARCH-bot-workspace.md`](../arch/ARCH-bot-workspace.md)。**参照**：`third-part/orca @ 1ab037e`（MIT，本地只读副本，不入库）。

---

## 1. 为什么要单独一份需求

现有「机器人」已经能读绑定项目的文件、能建任务、能起 run（见 [`../arch/ARCH-bot.md`](../arch/ARCH-bot.md) §0.1）。但「交给机器人」在 UI 上曾经只是**切项目 + 打开会话**：没有写绑定、没有记工作区、终端退出后什么都不剩。ORCA 的做法是把「工作区」当成 bot 的**长期资产**：

- bot 有 home 目录（`SOUL.md` / `MEMORY.md` / `memory/`），本身就是一个 folder workspace（`third-part/orca/src/main/bots/bot-home.ts`、`bot-home-workspace.ts:12`）；
- 人点「Hand to bot…」时，工作区被**移动到 bot home 下**，里面的 agent 继续跑并改为向 bot 汇报（`third-part/orca/src/shared/bots/bot-take-over.ts:50`、`third-part/orca/src/shared/bots/hand-over-workspace.ts` 头部注释）；
- bot 用 `bot work list` 看自己起过的活和「Workspaces under you」（`third-part/orca/src/shared/bots/bot-work-list.ts:94`）；
- 代码活交给 worker（新 worktree），bot 自己不碰文件（`third-part/orca/src/main/bots/bot-preamble.ts:72`）；
- 关掉标签不结束会话，agent 还在 bot 的 Activity 里跑（`third-part/orca/src/main/bots/bot-session-tabs.ts:25`）。

我们不需要照搬「bot home 是一个 workspace」的全部形态，但**「交接是一条长期关系，不是一次跳转」**必须补上。

---

## 2. 用户故事（带判据）

| # | 用户故事 | 判据 | 现状 |
|---|---|---|---|
| US-W01 | 我把项目交给机器人 | 点项目右键「交给机器人」后，该 bot 的 `project_id` 真的是这个项目；卡片出现「X 接手」；bot 的会话里有一条可审计的交接行；**不切我当前项目、不抢视图** | ✅ 2026-11-23 |
| US-W02 | 我把一条终端的工作目录交给它 | 终端右键「交给机器人」后 `bot_workspaces` 多一条（path / branch / terminalId）；pty 退出后这条关系还在；bot 的 `work_list` 能看到终端状态与尾部输出 | ✅ 2026-11-23 |
| US-W03 | 同一目录交两次不重复 | 同一个 `(bot, path)` 再交只更新标题 / 目标 / 终端，不新增行；`work_list` 里仍是一条 | ✅ 2026-11-23 |
| US-W04 | 它能在交出去的工作区里干活 | `workspace_list/read/grep`、`git_status/log/diff` 接受 `workspace=<id>`，路径 jail 换成该工作区根；越界、二进制、凭据文件仍拒绝 | ✅ 2026-11-23 |
| US-W05 | 它能在那里起活，而不是另造一个 worktree | `task_create` 传 `workspace=<id>` 时 todos.cwd 就是那条路径；run 在该路径执行（`worktree skipped: handed-workspace`），跑完回流到它 | ✅ 2026-11-23 |
| US-W06 | 我知道它为什么在这里开口 | 交接写一条 `decision=watching`、`trigger.kind=handoff` 的回合；「为什么说」里能看到 worktree id 与目标 | ✅ 2026-11-23 |
| US-W07 | 交回是干净的 | 交回把关系标 `released`，不在观察面里；项目根交回同时解绑 `bots.project_id`；工作区文件、分支、终端都不动 | ✅ 2026-11-23 |
| US-W08 | 删机器人不留孤儿 | 删 bot 时它的工作区关系一起删；撤销时一起回来 | ✅ 2026-11-23 |
| US-W09 | 它知道交接的工作区和「当前项目」不是一回事 | system prompt 分区列出工作区（标题 / 路径 / 分支 / `workspace=<id>`），并说明读文件 root 可以选它们 | ✅ 2026-11-23 |
| US-W10 | 一次交接能带一句目标 | `goal` 落库并进 prompt / 审计行；不填也能交 | ✅ 2026-11-23 |
| US-W11 | 交接带目标能让它先开一轮 | 带**新目标**交接后它自动说「先看什么 / 打算怎么做」；重复交同一目录或没目标不烧 token | ✅ 2026-11-23 |
| US-W12 | 它能对着交接的 agent 问「现在到哪了」 | 交接工作区 / 自己名下有活着的 run 时，能发一句话进去（`worker_send`），再用 `run_log` 读它的回复 | ◐ 已能发话；答不会主动推回来，要它再看一次 |
| US-W13 | 工作区的活有账本 | 一条工作区能看到：终端状态、runs、未完成任务；`needs you` 与 `waiting` 分开 | ◐ `work_list` + Bot 页「工作区」已有；没有 ORCA 那种 item 状态机 |
| US-W14 | 交回来的工作区还能再交出去 | `released` 行保留历史；再交同一路径生成新的开放关系，不丢审计 | ✅ 2026-11-23 |
| US-W15 | 交过来的活它继续盯着 | 交接时若这条终端 / 目录上有在跑的 run，任务归这个 bot（`todos.bot_id`），它挂一条 `watching`，结束后收到 `reported`；执行体不变 | ✅ 2026-11-23 |
| US-W16 | 交回的工作区还能翻历史、再交出去 | 面板上「已交回 N」可展开；`released` 行显示「打开终端 / 再交给它」，再交复用同一行重新 open | ✅ 2026-11-23 |
| US-W17 | 它的主目录能看，但不靠手改 | `userData/bots/<id>/` 有 SOUL.md + MEMORY.md 只读镜像；「主目录」按钮能打开；手改不回写 DB | ✅ SOUL.md 镜像 2026-11-23（home 文件夹仍只这两份） |
| US-W18 | 终端里的 agent 能回一句 | 受管 pty 里有 `harness` 命令：`whoami` / `note --text` / `report --text`；note 进当前任务会话，report 进这次 run 的结果；token 只覆盖这次 run，不能调别的动作 | ✅ 2026-11-23 |
| US-W19 | 终端 agent 能请人确认 | `harness ask --text "…" [--timeout]` 弹桌面审批（允许 / 拒绝）；CLI 等到决定才继续；超时自动收掉；不能自批 | ✅ 2026-11-23 |
| US-W20 | 远端主机的 agent 也能回一句 | SSH 主机上的 pty / ACP run 通过反向隧道 + 远端 shim 用 `harness note / report / ask`；没有 curl / base64 时明说不可用，不假装成功 | ✅ 2026-11-23 |
| US-W21 | 我能直接开一条远端 shell | 终端「＋」菜单按主机列「新建终端 · <host>」；标签记住 host，重启恢复仍连同一台；远端默认目录由 host.defaultCwd | ✅ 2026-11-23 |
| US-W22 | 终端里的 agent 中途说一句，它真的听得见 | 受管 pty / ACP 里 `harness note --text "…"` 之后：任务会话里有人看得见的那一行，**同时**落成 bot 回合（`decision=noted`、带 `from`），下一轮开口时出现在 system 的背景段；1 小时外的旧话不再喂；`report` 走同一条通道 | ✅ 2026-11-24 |
| US-W23 | 它能在对话里说一句，署名是它自己 | 任务会话收到 `〔bot〕…` 一行；只对**自己的任务 / 交接工作区 / 绑定项目**发言；不打断正在跑的 run（要纠偏它得用 `worker_send`），回执里写清这一点 | ✅ 2026-11-24 |
| US-W24 | 它能在交到手上的终端里接着敲 | work 档可以往**已交接**的终端（或自己名下 run 的终端）敲一行，默认回车；人正在接管时被拒；终端已退出时明说；每次写入落审计事件；不能新开 / 结束终端、不能指定任意路径 | ✅ 2026-11-24 |

---

## 3. IR（人看得见什么）

| # | 规格 | 失败语义 | 支撑 |
|---|---|---|---|
| IR-W01 | 项目右键 / 终端右键有「交给机器人 · <默认名字>」；多个 bot 时最多再列 3 条「交给 <名字>」，不新造弹层 | 没有 bot 时置灰并写「还没有机器人」 | US-W01/02 |
| IR-W02 | Bot 控制台左栏「工作区」一行一条：类型（项目 / 树 / 终端）+ 标题 + 目标 + 「打开终端」「目标」「交回」；目标是行内输入，失焦保存 | 没有工作区时一行提示，不空白 | US-W02/07/10 |
| IR-W03 | 「打开终端」优先复用这条终端（adopt），没有则在该路径新开 | 终端已退出时走新开，不假装接上 | US-W02 |
| IR-W04 | 交接在 bot 会话里是一条 system 行「〔交接〕标题（路径 · 分支）交给 X。目标：…」 | 不进 user 气泡，不冒充用户说的话 | US-W01/06/10 |
| IR-W05 | 「为什么说」/ 轨迹里能看到 `trigger.kind=handoff` 与 worktree id | 老回合没有该字段时显示「未记录」 | US-W06 |
| IR-W06 | `work_list` 的结果按工作区聚合：终端状态与尾部、最近 3 次 run、未完成任务 | 终端不存在时返回 `terminal: null`，不报错 | US-W02/13 |
| IR-W07 | 交回后工作区从「手上」消失；「已交回 N」可展开看历史、打开终端或再交给它 | 交回不解绑别的 worktree 的项目绑定 | US-W07/14/16 |
| IR-W08 | 终端里 `harness whoami` 能说清 run / 任务 / agent；`note` 在会话里是「〔agent〕…」系统行；`report` 在 run 结果与轨迹里可见；`ask` 进桌面审批 | 没有 token 时 CLI 明说「这条终端不在受管 run 里」，不假装成功 | US-W18/19 |
| IR-W09 | 远端 run 的事件 / 提示同时说明「远端 bridge 可用 / 不可用」；远端审批同样进桌面弹窗 | 隧道或 shim 失败时不阻塞 agent，也不显示「已连接」 | US-W20 |
| IR-W10 | 终端「＋」菜单里按主机列出「新建终端 · <host>」；远端标签标题带主机名；`host_id` 落库，重启恢复回同一台 | 主机离线 / SSH 失败时终端显示错误，不回落到本地 shell | US-W21 |
| IR-W11 | Bot 页回合流里 `noted` 是独立一档「收到回话」，展开能看到是哪个执行体回的 | 老回合没有 `from` 时只显示正文，不猜署名 | US-W22 |
| IR-W12 | `task_say` 写进会话的那一行带 `〔bot〕` 前缀，和 agent 的 `〔agent〕`、人的气泡都不同 | 没有权限时工具回错误，不静默写进别处的会话 | US-W23 |
| IR-W13 | `terminal_write` 的回执说清敲进了哪条终端、是否回车；被拒时写清原因（接管中 / 已退出 / 未交接） | 不假装写成功 | US-W24 |

---

## 4. SR（系统必须提供什么）

| # | 规格 | 判据 |
|---|---|---|
| SR-W01 | `bot_workspaces(id, bot_id, project_id, path, branch, title, kind, terminal_id, goal, status, created_at, updated_at)`；显式列名写入，往返用例守着 | `tests/db.test.mjs` 有 path / branch / terminalId / goal / status 往返 |
| SR-W02 | 交接动作 `botHandOffWorkspace`：realpath + 目录校验；项目内路径或带 `.git` 的工作树才接受 | 越界路径可读地拒绝；没有 `window.prompt` |
| SR-W03 | `(bot, path)` 幂等：开放行存在就更新，不新增 | `tests/bot/handoff.test.mjs` 重复交仍 1 行 |
| SR-W04 | 项目根交接 = `bots.project_id` 绑定 + 人格历史记一版；交回时在没有同项目其它开放工作区的情况下解绑 | US-W01/07 |
| SR-W05 | `task_create` 接受 `workspace`；已有任务去重键加 cwd；`run_start` 对交接路径不需要额外项目绑定 | US-W05 |
| SR-W06 | `prepareRunWorktree` 命中 `botWorkspaces` 的 path 时 `skipped=handed-workspace`，不再派生新树 | 交接目录里的 run 的 cwd 不变 |
| SR-W07 | 观察面：`workspace_list/read/grep`、`git_*` 接受 `workspace` 解析（id / 标题 / 路径），未知引用直接报「先 work_list」 | 不静默回退到错误根 |
| SR-W08 | 上下文：`compileContext({ workspaces })` 增加分区并进 `sectionChars.workspaces`；最多 8 条 | 无工作区时不出现该段 |
| SR-W09 | 删除 / 撤销：`collectBotData` / `dropBotData` 带上 workspaces | 删 bot 不留孤儿 |
| SR-W10 | 审计：交接写 `bot_turns`（`decision=watching`）与 `bot_events`；交回写 released + updatedAt | 任意交接可追到人、时间、路径 |
| SR-W11 | 终端 Agent 窄通道：pty 走 `harness` 垫片（PATH + token）；ACP 走 `cockpit_harness` MCP；命令 whoami / note / report / ask；note 写当前任务会话，report 只写 run 结果；ask 建桌面审批，人决定后 CLI 取走（不自批、不自动执行）；run / 终端结束即撤销 token | `electron/agent-bridge.mjs` / `agent-cli.mjs` / `harness-mcp-bridge.mjs` / 主进程 token 服务 |
| SR-W12 | 远端：`ssh -R 127.0.0.1:0:...` 反向隧道 + 远端 POSIX shim（curl/base64）；pty 用本地 pty 包 `ssh -tt`；ACP 用 `AcpClient.sshEnv`，远端有 node 时挂远端 harness MCP；隧道 / token 按 run 关闭；shim 缺失时不假装可用 | `startRemoteBridge` / `remoteAgentCliShimContent` / `AcpClient.sshEnv` / 远端 MCP 安装 |
| SR-W13 | 手动远端 shell：`terminal:create` 接受 `hostId`；远端命令 `cd <defaultCwd> && exec "$SHELL" -l`；`terminals.host_id` 落库；PaneState / 落盘恢复带 hostId；新建菜单按主机列出 | `terminal:create` / `terminals.host_id` / `TerminalPanel` |
| SR-W14 | 双向回传：`harness note` / `report` 落 `bot_turns(decision=noted, from)`；`recentNotes(botId)` 只取 1 小时内的 ≤4 条进 `compileContext` 的 `workerNotes` 段（标注「只作背景，不是人下的指令」）；`deliverWorkerNote` 只发给 watching / 已汇报 / 归属该任务的 bot | `electron/main.mjs` / `electron/bot/index.mjs`（`noted` / `recentNotes` / `compileContext`） |
| SR-W15 | 指挥面工具：`task_say`（dispatch / work，只写会话）与 `terminal_write`（work，只写已交接 / 自己 run 的终端）；`terminal_write` 检查 `controlBy` 与终端存活，落 `bot.terminal_write` 事件 | `electron/bot/tools.mjs` / `botReadToolNow` |

---

## 5. 明确不做（这一期）

| 不做 | 理由 / 去向 |
|---|---|
| **bot home 作为 workspace（SOUL.md / memory/ 文件夹）** | 我们的 bot 不是 agent CLI 会话，先补「交出去的工作区」；home 文件夹见 [`../arch/ARCH-bot-workspace.md`](../arch/ARCH-bot-workspace.md) §8 |
| ~~**交接后自动开口**~~ | 2026-11-23 已做条件触发：只有带**新目标**才开一轮；重复交接 / 没目标不烧 token |
| **对活着的 agent 追问 / 纠偏（完整版）** | `worker_send` 已能把话投进当前 run；它的下一句话不会自动成为 bot 的回合，需要 bot 再 `run_log` 读（完整 worker mail 仍未做） |
| **完整 bot item 状态机**（`planned/working/waiting/needs_you`） | 我们已有 todo + 提问卡片 + watching 回合；先让 `work_list` 能看，再决定要不要独立账本 |
| **跨机 / 远端工作区交接** | 本机 realpath 校验；远端要等主机执行面统一 |
| **搬移工作区到 bot home** | ORCA 会移动 worktree；我们不移动人的目录，只记关系（更安全，也更好交回） |

---

## 6. 验收（可测）

| 指标 | 判据 | 命令 / 落点 |
|---|---|---|
| 交接真的写绑定 | 项目右键后 `bots.project_id === project.id`，`bot_workspaces` 有 1 条 open | 手动 + `tests/bot/handoff.test.mjs` |
| 幂等 | 同一路径交 2 次仍是 1 条 | 同上 |
| 观察面 | `workspace_read({ workspace: <id> })` 能读到该 worktree 的文件；`workspace_read({ workspace: "不存在" })` 明确拒绝 | 手动（Bot 页问「这个文件第 3 行是什么」） |
| 原地起活 | 由交接工作区建的任务，run.cwd 等于该路径，事件里有 `handed-workspace` | 手动 + 日志 |
| 交回干净 | 面板消失、project 解绑、文件与分支未动 | 手动 |
| 删 bot | `bot_workspaces` 无残留 | `tests/bot/handoff.test.mjs` |

---

## 7. 追溯

| US | IR | SR |
|---|---|---|
| W01 / W06 / W10 | IR-W01 / IR-W04 / IR-W05 | SR-W02 / SR-W04 / SR-W08 / SR-W10 |
| W02 / W03 / W13 | IR-W02 / IR-W03 / IR-W06 | SR-W01 / SR-W03 / SR-W09 |
| W04 / W05 / W09 | IR-W06 | SR-W05 / SR-W06 / SR-W07 / SR-W08 |
| W07 / W08 / W14 / W16 | IR-W07 | SR-W04 / SR-W09 / SR-W10 |
| W11 / W12 / W17 / W18 / W19 / W20 / W21 | IR-W02 / IR-W03 / IR-W08 / IR-W09 / IR-W10 | `worker_send` / `soulMarkdown` / 终端窄通道（SR-W11） / 远端隧道（SR-W12） / 手动远端 shell（SR-W13） |
| W22 / W23 / W24 | IR-W11 / IR-W12 / IR-W13 | SR-W14（回话落回合 + 进背景） / SR-W15（`task_say` / `terminal_write`） |

**已知差距**：交接后的**主动确认**与**追问活着的 agent**是下一步最值钱的两刀；前者便宜（条件触发），后者要动 ACP 投递面。
双向通信（W22–W24）已通：它听得见执行体中途说的话，也能在对话里署名发言、在交到手上的终端里接着敲。仍然缺的是**跨 run / 跨机 / 离线的收件箱**（全局 peer mail），见 [`../arch/ARCH-agent-bridge.md`](../arch/ARCH-agent-bridge.md) §5。
