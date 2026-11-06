# Cockpit Harness 架构方案（4+1 视图）

> 对应需求 `docs/REQ-multi-agent-workspace.md`（76 条）· 参考 `docs/reference-main` 与 `docs/deepseek-harness`
>
> **结论**：自研 Electron 壳 + **dsh 作为执行层（ACP）** + **定向复用 reference 源码模块**。
> reference 一次性 pin 版本、不跟上游；dsh 用协议依赖、不读它的 Cordis 插件树。

## 0. 决策摘要

| 决策 | 选择 | 理由 |
|---|---|---|
| 宿主 | 自研 Electron + React + TS | 产品形态是编排控制台，不是 IDE |
| 执行 | **dsh `--profile acp`**，每 run 一个会话 | 会话/工具/审批/技能成熟，事件结构化 |
| reference | **vendor 指定模块**（MIT，pin commit） | 复用 worktree/终端/Agent 启动/看板 UI，不 fork 整个仓 |
| 存储 | 本地 SQLite（WAL） | 单文件、可备份、并发够用 |
| 远程 | `ssh host 'dsh --profile acp'` + git worktree | MVP 不写守护进程，协议跑在 SSH stdio 上 |
| 不做 | 代码编辑器、域面板、多租户 | 域面板归 IDE；一期单人 |

---

## 1. 逻辑视图

### 1.1 分层

```
┌──────────────────────────────────────────────────────────┐
│ UI（Renderer）                                            │
│ 看板 / 任务详情 / 会话 / 收件箱 / 统计 / 主机              │
└───────────────▲──────────────────────────────────────────┘
                │ IPC（类型化 RPC）
┌───────────────┴──────────────────────────────────────────┐
│ Application（Main）                                       │
│ TodoService · RunService · Scheduler · InboxService       │
│ ContextBridge · ApprovalService · AuditService            │
└───────▲───────────────▲──────────────▲───────────────────┘
        │               │              │
┌───────┴──────┐ ┌──────┴──────┐ ┌─────┴──────────┐
│ Domain       │ │ Executor    │ │ Integrations   │
│ Todo/Run/    │ │ ACP Client  │ │ Git/Worktree   │
│ Agent/Host   │ │ ProcessSup  │ │ SSH · IDE link │
└───────┬──────┘ └──────┬──────┘ └─────┬──────────┘
        │               │              │
┌───────┴───────────────┴──────────────┴───────────────────┐
│ Infrastructure：SQLite · 文件系统 · 日志 · 密钥库          │
└──────────────────────────────────────────────────────────┘
```

**依赖规则**：Domain 不依赖 Electron、不依赖 dsh/reference；Executor 与 Integrations 只通过接口被 Application 调用；UI 只依赖 IPC 契约。

### 1.2 模块职责

| 模块 | 职责 | 复用来源 |
|---|---|---|
| `core/domain` | Todo/Run/Agent/Host 状态机与不变量 | 自研 |
| `core/scheduler` | 队列、并发上限、同目录串行、依赖阻塞 | 自研 |
| `core/executor` | ACP 会话生命周期、事件映射、取消/重试 | ACP 协议；reference `src/main/acp` 参考 |
| `core/worktree` | 创建/复用/清理 worktree，run 绑定 | reference `src/main/git/*worktree*`、`src/shared/worktree/*` 改写 |
| `core/terminal` | pty 拉起 Agent、输出尾部、steer 写入 | reference `src/main/terminal/*` 改写 |
| `core/agent-launch` | CLI 探测、启动参数、resume、审批预设 | reference `src/main/agent-launch/*`、`src/shared/agent-launch/*` |
| `core/inbox` | 决策/失败/待验收提醒、已读/归档 | 自研 |
| `core/audit` | 命令、注入、时长、token/成本 | 自研 |
| `core/context` | Envelope 缓存、pin/stale、深链 | 自研（IDE 侧发布） |
| `ui/board` | 看板、卡片、拖拽、筛选 | reference `workspace-board` 交互参考 |
| `ui/kit` | 按钮/弹层/表格/终端/diff | reference `src/renderer/src/components/ui/*` 选摘 |

### 1.3 领域模型与不变量

```
Host  1 ── n Agent 1 ── n Run n ── 1 Todo
Todo  1 ── n Run 1 ── n Message / Artifact
```

- **Run 必须绑定** `todo + agent + host`，不漂移。
- **状态机**：`queued → running → (waiting_input) → completed | failed | cancelled`；Todo 侧由用户/Agent 推进。
- **回写**：Run 结束必须写 `结论 + artifact`，否则 Todo 标黄、不得进 `done`。
- **同一 cwd 串行**：并发排队，原因可见（超并发 / 等待目录 / 依赖未完成）。
- **Context 只做事件与快照**：不持久化数据实体；IDE 离线标 `stale`。

### 1.4 关键接口

**ACP（执行层）**：`initialize` → `session/new(cwd)` → `session/prompt` → `session/update`* →（`session/request_permission`）→ `session/cancel` / `session/close`。协议 v2，锁 dsh 版本。

**Agent CLI（回写层）**：

```
todo list/show/claim/status/comment/ask
run log --tail
artifact link <todo> <url>
context get/set
```

**IDE 交接**：`yieldmind-ide://open?path=&selection=&todo=`；`POST /api/context` 接收 Envelope。

### 1.5 需求映射（简表）

| 需求 | 主模块 |
|---|---|
| A 主机/Agent | `agent-launch` + `HostRegistry` + 心搏 |
| B TODO/看板 | `domain.todo` + `ui/board` + `scheduler` |
| C 分派/广播 | `scheduler` + `worktree` + 多个 ACP 会话 |
| D 会话/纠偏 | `executor` + `ui/session` + 审批 |
| E 回写/收件箱/审计 | `inbox` + `audit` + `artifact` |
| F 远程 | `ssh` 传输 + 同一 ACP 客户端 |
| G 布局 | 固定四区 + 可缩放侧栏 + 保存布局 |
| K/M IDE 交接 | `context` + 深链 + 只读预览 |

---

## 2. 进程视图

### 2.1 进程拓扑

```
Electron Main（控制面）
├── SQLite（WAL）
├── Scheduler（单线程事件循环 + 定时器）
├── ExecutorSupervisor
│   ├── run A → dsh --profile acp（子进程，stdio）
│   ├── run B → ssh host → dsh --profile acp（管道）
│   └── git worktree / pty 子进程
└── Renderer（1 个，UI）

外部：IDE（深链/Context 上报）、Git、SSH
```

- 每个 run 一个 dsh 进程，**故障隔离**；后续可做每主机池化。
- UI 不直接持有子进程；Main 统一管理生命周期与背压。
- 所有事件先落库再推送（SSE/IPC），保证刷新可恢复。

### 2.2 一次 run 的时序

```
UI / Scheduler          Executor              dsh(ACP)            SQLite
    │ start run            │                     │                  │
    │─────────────────────>│ spawn+initialize     │                  │
    │                      │────────────────────>│                  │
    │                      │ session/new(cwd)     │                  │
    │                      │────────────────────>│                  │
    │                      │ session/prompt       │                  │
    │                      │────────────────────>│                  │
    │                      │<── session/update ──│  (流式消息/工具)  │
    │<── event/message ────│── append ──────────────────────────────>│
    │                      │<── request_permission│                  │
    │<── approval ─────────│── allow/deny ───────>│                  │
    │                      │<── prompt result ────│                  │
    │<── run.finished ─────│── writeback ───────────────────────────>│
```

### 2.3 并发与队列

- 每 Agent `max` 并发；超限排队。
- 同 `cwd` 串行（文件锁 + DB 标记）；跨 worktree 并行。
- 广播：一个 Todo → N 个 worktree + N 个会话，产物并列。
- 停机恢复：队列持久化；`running` 重启后标记中断，可重试（不伪造完成）。

### 2.4 失败与恢复

| 故障 | 处理 |
|---|---|
| dsh 进程崩溃 | run=failed，保留日志，允许重试（新 run） |
| SSH 断线 | 重连后 resume/新会话；不重复执行 |
| 审批超时 | run=waiting_input，进收件箱 |
| 应用重启 | 队列恢复；运行中标记 interrupted |
| 磁盘/DB 错误 | 只读降级，禁止派活 |

### 2.5 安全

- 每 Agent：工具白名单 + `allow/ask/deny` 审批。
- 危险命令走 ACP `request_permission`，UI 决策并审计。
- SSH 凭据进系统密钥库；日志脱敏；注入与命令全量审计。

---

## 3. 开发视图

### 3.1 仓库结构

```
apps/desktop/          Electron main / preload / renderer
packages/core/         domain + scheduler + services（纯 TS）
packages/executor/     ACP client、进程监管、事件映射
packages/integrations/ git/worktree、ssh、ide-link
packages/ui/           board / detail / session / inbox / stats
vendor/reference/           pin commit 的复用模块 + NOTICE
docs/                  需求与架构
```

### 3.2 构建与测试

- pnpm workspace + TS strict + Vite（renderer）+ electron-vite。
- SQLite：`better-sqlite3`（主进程）；迁移脚本随包。
- 测试分层：Domain 单测；ACP 契约测试（本地 mock 模型）；worktree 集成测试；UI 冒烟（Playwright）。
- 离线可跑：mock provider；不需要外部 key。

### 3.3 reference 复用策略（MIT，一次性）

| 复用 | 方式 | 改造 |
|---|---|---|
| `agent-launch/*` + `shared/agent-launch/*` | 拷入 `vendor/reference/agent-launch` | 去 Electron IPC，换成接口 |
| `git/*worktree*`、`shared/worktree/*` | 拷入 `vendor/reference/worktree` | 去 store 依赖，保留命令与边界 |
| `main/terminal/*` + `renderer/.../terminal/*` | 拷入 `vendor/reference/terminal` | 换成我们的通道 |
| `main/acp/*` | 选摘会话/事件/审批 | 只保留协议与状态机 |
| `sidebar/workspace-board/*`、`components/ui/*` | 拷 UI 组件 | 接我们的数据模型 |

规则：**pin 一个 commit，记录 NOTICE；不 merge 上游**。需要安全修复时只 cherry-pick 单文件。

### 3.4 dsh 依赖策略

- 依赖**版本**（安装包内置或首启下载），不读源码。
- 只依赖 ACP v2；升级前跑契约测试（会话、流、审批、取消、resume）。
- 失败回退：`dsh --profile headless` 或原生 CLI；不阻塞产品启动。

---

## 4. 物理视图

### 4.1 本地部署

```
macOS / Windows / Linux
└── Cockpit Harness.app
    ├── Electron Main + Renderer
    ├── SQLite  ~/Library/Application Support/Cockpit Harness/harness.db
    ├── 日志 / 缓存 / 截图
    └── 内置 dsh（或首启下载，校验签名）
外部依赖：git；可选 IDE
```

### 4.2 远程部署

```
Harness ──ssh──> host
                 ├── dsh（同版本，校验）
                 ├── git
                 └── ~/Documents/Cockpit Harness/worktrees/<repo>/<run>
```

无守护进程；SSH 通道上跑 ACP stdio。断线重连 60s 内；离线队列保留。

### 4.3 数据与产物

- SQLite：Todo/Run/Message/Event/Inbox/Audit；WAL。
- 产物：`userData/artifacts/<run>/`（预览缩略 + 元数据）。
- IDE：只存深链与 Context 快照；数据实体在 IDE 侧。
- 备份/迁移：单文件 + 版本号；导出 JSON。

### 4.4 分发

- 三平台安装包；macOS 公证、Windows EV、自动更新。
- 包体 ≤ 200MB（Electron + Monaco diff + 内置 dsh 可选外置）。
- 版本与 IDE 解耦。

---

## 5. 场景视图

### S1 早会派活（A/B/C）

生成计划 → 看板卡片 → 选 Agent → 创建 worktree → ACP `new/prompt` → 状态流回卡片。

### S2 运行中纠偏（D2）

卡片发现动作不对 → 会话发消息 → 若 run 运行中，`session/prompt` 进入同一会话（排队/步边界）→ 回执「已注入」；否则新评论。

### S3 收工回写（E2/E3）

Agent 结束 → 校验结论 + artifact → Todo `in_review` → 收件箱 → 采纳/打回；打回生成新 run。

### S4 广播对比（C2）

同一 Todo → N 个 worktree/会话 → 产物并列（diff/预览）→ 采纳一个，其余标记放弃。

### S5 远程执行（F）

添加主机（安装命令 + token）→ `ssh` + dsh 检查 → 派活 → 断网 30s → 重连不重复执行。

### S6 IDE 交接（K/M）

IDE 选中 → `POST /api/context` → 派活默认携带 → 产物出预览 → 深链回 IDE 并保留选中。

---

## 6. 里程碑与风险

| 阶段 | 内容 | 周期 |
|---|---|---|
| M0 | 壳 + SQLite + 四区 UI + 设置 | 1 周 |
| M1 | ACP 单机闭环：派活/流式/审批/回写/worktree | 2 周 |
| M2 | 队列/广播 + 收件箱 + 审计 + 统计 | 2 周 |
| M3 | SSH 远程 + 重连 + IDE 深链/Context | 2 周 |
| M4 | 打包/签名/更新 + 首启 | 1 周 |

**风险**：dsh 仍是 developer preview（锁版本 + 契约测试）；ACP 审批/steer 语义需实测；reference 模块与 IPC 解耦工作量；worktree 边界（锁/清理/冲突）。
