# 主机与统计（Hosts & Stats）

> 参考：ORCA「主机 = 运行位置选择器 + 账号额度」（`docs/assets/cmp/orca-ways-to-run.png`、`orca-usage.jpg`）、Multica「机器 × 工具 = Runtime + caps 探测 + 在线心跳 + 用量/错误分类」（`mul-machine.webp`、`mul-runtimes-list.webp`、`mul-exec-log.webp`）。
> 对比结论见 [`CMP-modules-orca-multica.md`](CMP-modules-orca-multica.md) A/Q 两节。本文只描述**本仓库已落地**的口径与链路。

---

## 0. 两条硬原则

1. **主机页是「运行位置 + 健康」，不是管理台**：不做常驻守护进程、不做 SSH 密钥管理 UI、不做端口转发；`ssh + dsh --profile acp` 每次 run 新建连接，天然没有长连接可重连。
2. **统计页只说真话**：执行器没上报 token 就显示「未上报」，**绝不写 0**；不做费用折算（无数据源 + 定价会过期）。

---

## 1. 数据模型

### hosts（`electron/db.mjs`）

| 字段 | 说明 |
|---|---|
| `kind` | `local` / `ssh`；本机是一等公民（`h-local`，不可移除） |
| `caps` | 探测结果 JSON：`[{cli, path, version}]`，空数组 = 未探测或未探测到 |
| `lastProbe` / `latencyMs` | 上次探测时间与往返耗时；`null` = 从未探测（≠ 0ms） |
| `maxConcurrency` | 该主机的 run 并发上限，`0` = 不限 |
| `defaultCwd` | 远端默认工作目录（远端不建 worktree，必须是绝对路径） |
| `probeError` | 最近一次探测失败原因（含「远端目录不存在」） |

### runs（统计的唯一事实来源）

| 字段 | 采集点 |
|---|---|
| `createdAt` | `queueRun()` 入队时刻 |
| `startedAt` / `endedAt` / `durationMs` | `startRun()` / 完成 / 失败 / 停止三处收尾 |
| `queueWaitMs` | `startedAt - createdAt` |
| `hostId` | `queueRun` 从 agent 带上；`startRun` 以真实 host 覆盖 |
| `tokensIn` / `tokensOut` / `tokens` | `applyRunUsage()` 读 ACP `PromptResponse.usage`（容错多种命名） |
| `usageSource` | `acp` = 上报过；`unknown` = 未上报（页面显示「未上报」） |
| `errorClass` | `classifyError()`：`auth` / `rate_limit` / `timeout` / `other` |
| `exitCode` | 执行器退出码（有则记） |
| `queueReason` | 排队原因：主机离线 / 等待全局并发 / 主机并发已满 |

原始 usage JSON 额外写一条 `run.usage` 事件（截断 180 字符），便于换执行器时排查。

---

## 2. 主机页

```
● local  本机  127.0.0.1                       在线
  dsh 1.2.3 · claude 2.1.0 · pi 1.4              ← caps（探测得到）
  负载 1/2 · 延迟 4ms · 2 分钟前探测 · 3 Agent
  ─────────────────────────────────────────────
  [Agent 列表 + 运行位置下拉] [重新探测] [并发 N] [编辑] [移除]
```

- **心跳只在页面可见时跑**：进入 `主机` 页立即 `probeHosts`，停留期间每 60s 一次，离开即停（`Views.tsx` 的 `useEffect`）。
- **连续 2 次失败才标离线**（`probeFails` Map，内存级）：一次抖动不该把队列全卡住。
- **一次 ssh 往返完成探测**：`sh -lc` 批量输出 `cli|名字|路径|版本`，再附加 `cwd_ok / cwd_missing`，避免逐个 CLI 建连。
- **本机探测不走 ssh**：`probeLocalHost()` 用 `which` + `--version`，含内置 dsh 回落；每次启动刷新一次。
- **改运行位置**：`setAgentHost` 把 Agent 移到另一台主机；目标为远端时必须已有绝对路径 `defaultCwd`，否则报错（避免跑到错误的目录）。
- **主机并发**：`Host.maxConcurrency` 接入 `tick()`，超限时 `run.queueReason = 主机并发已满`。

### 派活联动

`TaskChat` 顶部黄条：当前 Agent 的主机离线时提示「派活会排队」，并给「改用本机」一键切换 —— 主机状态必须能影响 UI 决策，否则这个页面就是装饰。

---

## 3. 统计页

- **范围**：顶部「全部项目 / 单项目」选择；切换后 KPI / 趋势 / 分组 / 失败列表一起重算，避免把当前项目数据误读成全量。
- 每日趋势带成功/失败图例与空态；「今天」明确标为 24h。

口径：**运行健康**，四张 KPI。

| KPI | 计算 | 数据缺失时 |
|---|---|---|
| 成功率 | `completed / (completed + failed)` | `—`（无已完成 run） |
| 中位耗时 | `p50(durationMs)` | `—` |
| 排队 p50 | `p50(queueWaitMs)` | `—` |
| Token | 已上报 run 的 `Σ tokensIn / Σ tokensOut` | 显示「未上报」，并标注 `已上报/已完成` 计数 |

- **时间范围**：今天 / 7 天 / 30 天 / 全部（默认 7 天，按 `createdAt` 过滤）。
- **趋势**：按天分桶（今天按 2 小时、全部最多 14 天），成功 / 失败堆叠。
- **失败分类**：4 类计数，点分类筛选下方失败列表。
- **分组**：按 Agent / 项目 / 主机切换，条形宽度 = run 数，右侧是成功率与中位耗时。
- **失败下钻**：点行 → `selectTodo` → 跳到对应 Chat 会话。
- **导出 CSV**：当前范围的全部 run（含 usageSource，便于核对「未上报」）。

---

## 4. 生效点一览

| 行为 | 文件 |
|---|---|
| 表结构与迁移（`ALTER TABLE` 增量） | `electron/db.mjs` |
| `queueRun` / `startRun` / 完成 / 失败 / 停止 收尾 | `electron/main.mjs` |
| `probeHost` / `probeLocalHost` / `parseProbeOutput` / `hostView` | `electron/main.mjs` |
| `applyRunUsage` / `classifyError` | `electron/main.mjs` |
| 主机并发闸门 | `tick()` |
| actions：`addHost` `probeHost` `probeHosts` `removeHost` `setHostMax` `setAgentHost` | `electron/main.mjs` |
| 页面 | `src/components/Views.tsx`（`Hosts` / `Stats`） |
| 离线提示 | `src/components/TaskChat.tsx` |
| 指标格式化 | `src/ui.ts`（`fmtMs` / `p50` / `pct` / `tokens` / `ERROR_CLASS`） |

---

## 5. 明确不做

| 不做 | 原因 |
|---|---|
| 费用 / 定价折算 | 无写入源，定价会过期 |
| 守护进程 / 一次性 token 安装 | 破坏「安装即用」，且当前 `ssh + dsh` 已验证可用 |
| SSH 密钥管理 / 端口转发 / 自动重连 | 每 run 新建 ssh，无长连接 |
| 工具权限矩阵、多租户、活动流 | 单用户场景无收益 |
| 常驻心跳 | 只在主机页可见时探，避免后台 ssh 噪音 |
