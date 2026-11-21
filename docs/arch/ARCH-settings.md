> 层：架构 · 状态：已落地 · 核对：2026-11-14 · 覆盖：设置项、持久化、生效链路

# 设置（Settings）

> 参考：同类产品设置页的分组与行式表单、左侧分区导航 + 右侧卡片、搜索式入口、设置即保存。
> 本文描述 harness 里已落地的设置项、持久化与生效链路。新增设置照着第 6 节加即可。

---

## 1. 形态

```
导航栏「设置」/ ⌘,
┌──────────────┬──────────────────────────────────────────────┐
│ 设置          │  通用 / 外观 / 执行 / 终端 / 预览与元素 / 即时 │
│               │  通信 / 主机 / 统计 / 插件 / 数据 / 快捷键 /   │
│               │  关于                                          │
│ 通用          │  ┌ Card：标题 + 说明 ────────────────────┐   │
│ 外观          │  │ Row：标题 + hint        [ control ]    │   │
│ 执行          │  └───────────────────────────────────────┘   │
│ 终端          │  ...                                         │
│ 预览与元素    │                                              │
│ 即时通信      │                                              │
│ 主机          │  Agent 的运行位置：本机 / SSH、探测、并发     │
│ 统计          │  运行 / 成功率 / 耗时 / 排队 / 失败分类       │
│ 插件          │                                              │
│ 数据          │  本地库 / 导出 / 出网边界 / 清理                │
│ 快捷键        │                                              │
│ 关于          │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- **主机 / 统计是设置里的分区，不是顶层页**（2026-11-21）：rail 上不再有「统计」「主机」，两块内容以 `embedded` 方式嵌进设置正文（`Hosts` / `Stats` 自己不再渲染 `PageHeader`，只留一条右对齐工具条）。命令面板、旧 `defaultView=stats|hosts`、`harness:view` 旧入口都会落到「设置 → 对应分区」。
- **改动即时保存**：开关/下拉立即提交；文本与数字在 blur / Enter 时提交，避免每次按键写库。
- 保存后顶部显示「已自动保存」（2 秒）。
- 所有值经过主进程白名单 + 类型/范围校验，非法值回落到默认值。

## 1.4 顺序与文案（2026-11-21）

**分区顺序**（`SECTIONS`，导航按 `group` 分节；组间一条 hairline）：

| 组 | 分区 |
|---|---|
| 基础 | 通用、外观 |
| 运行 | 执行、主机、终端、预览 |
| 连接 | 即时通信 |
| 观察 | 统计 |
| 维护 | 插件、数据、快捷键、关于 |

排序原则：**天天改的在前，出问题才看的在后**。主机跟着「执行」走（都是「活在哪跑」），统计单独成组（只观察、不配置），插件/数据/快捷键/关于归「维护」。

**卡片顺序**：同一分区内按「先常用、再高级、最后只读」；只读内容（运行环境、Runtime 视图）放该分区最后，标题后缀「（只读）」。

**文案规则**（改设置时照这个写）：

| 位置 | 规则 | 例 |
|---|---|---|
| 分区 `desc` | 一句话，**不加句号**，逗号/顿号并列 | 「并发与审批、dsh 运行时、模型密钥、Mission 与角色」 |
| 卡片标题 | 2–6 字名词短语；只读卡加「（只读）」 | 「dsh 运行时」「运行环境（只读）」 |
| 行标题 | 名词短语 ≤ 8 字，技术名保留原文 | 「并发上限」「DSH_HOME」「推理强度（effort）」 |
| 行 `hint` | 一句话，**不加句号**；技术值前置，并列用「；」 | 「auto 只在 git 仓库建 worktree，always 强制要求 git…」 |
| `settings-note` | 完整句子，**带句号**；讲边界、风险、下一步 | 「改完无需重启：下一次 run 会带着这些变量启动 dsh。」 |
| 空态 | 一句话，不加句号 | 「Notes 会作为内置 first-party 插件自动出现」 |

术语：**Agent**（= 执行体，指 CLI + 工作目录）、**机器人 / bot**（人格 bot，只在 bot 相关处出现）、**运行 / run**、**主机**、**会话**（不用 thread）、**任务**（不用 todo）。英文保留原名：dsh、DSH_HOME、ACP、CLI、worktree、Webhook、Mission、Supervisor。

**布局**：控件宽度只有三档——下拉/短文本 200、数字 88、长文本 260；只读值用 `.set-row-value` 右对齐，和输入框同一条右边缘；`hint` 最大 56ch，超长换行不与控件抢宽度。

## 1.5 易用性

| 能力 | 行为 |
|---|---|
| 搜索 | 左栏顶部搜索框（`⌘F` 聚焦）：跨分区匹配标题 / 说明 / 键名；结果带分区标签，回车或点击 → 切分区并滚到该行，行高亮 1.6s |
| 逐项恢复默认 | 值偏离默认时行标题右侧出现「恢复默认」（hover 可见），点击只重置该项并显示「已自动保存」 |
| 本页恢复默认 | 页头右侧按钮，按 `SECTION_KEYS` 只重置当前分区（不碰其它分区） |
| 保存反馈 | 每次改动后页头显示「✓ 已自动保存」胶囊（不弹 toast） |
| 键盘 | `⌘F` 搜索、`Esc` 清空、分区列表 `↑/↓` 切换 |
| 默认值来源 | `Settings.tsx` 的 `DEFAULTS` 必须与 `electron/db.mjs` 的 `DEFAULT_SETTINGS` 保持一致 |

## 1.6 缺模型密钥的可操作错误

`run` 失败时若报错命中 `no api key` / `OPENAI_API_KEY` 这类关键字（`missingKeyInfo`，前后端口径一致）：

- Chat 的错误消息下方渲染**可操作卡片**：「未配置模型密钥 · <provider>」，列出要设置的环境变量名、两种配法，按钮
  - 「去设置里填」→ `harness:open-settings { section: "execution", focus: "dshEnv" }` → App 切设置页 → Settings 定位到「模型密钥 / 环境变量」并聚焦输入框
  - 「复制 export 前缀」
- 统计页失败行同样是可点入口（「配置密钥」）
- 设置 → 执行 → 「模型密钥 / 环境变量」：每行 `KEY=VALUE`，即时保存，下一次 run 生效（无需重启）
- 结构化的 `run.errorMeta = { envVars, provider }` 也会落库，便于后续做「错误 → 配置」引导

## 2. 设置项与生效点

| 分区 | 键 | 默认 | 生效位置 |
|---|---|---|---|
| 通用 | `defaultView` | `workspace` | 启动时 `App` 首屏 |
| 通用 | `defaultAgentId` | 自动按项目 | `newThreadRecord` / `ensureThreads` / `send` 的 agent 兜底 |
| 通用 | `enterToSend` | `true` | `TaskChat` 输入框（关闭后 ⌘/Ctrl+Enter 发送） |
| 通用 | `confirmStop` | `false` | `TaskPane` 停止按钮 |
| 外观 | `theme` | `system` | `document.documentElement[data-theme]`；system 监听 `prefers-color-scheme` |
| 外观 | `uiScale` | `0`（自动） | 主进程 `setZoomFactor`；`0` = 按窗口所在屏幕的**最长逻辑边**取 90 / 100 / 110 / 120 / 130%，拖到别的屏、改分辨率会重算；80–150 = 手动固定；⌘+ / ⌘- 手动步进，⌘0 回自动 |
| 外观 | `chatFontSize` | `13` | CSS 变量 `--chat-font-size`（消息体 + 输入框） |
| 执行 | `maxConcurrentRuns` | `0`（不限） | `tick()` 全局并发闸门，排队原因「等待全局并发」 |
| 执行 | `approvalPolicy` | `ask` | ACP `session/request_permission`：ask 弹窗 / allow / deny |
| 执行 | `dshEnv` | 空 | `parseEnvText()` 解析 `KEY=VALUE` 行，启动本地 dsh 时注入（远端不生效）；用于 `DEEPSEEK_API_KEY` 等 |
| 执行 | `dshBinary` / `dshHome` / `model` / `effort` | 空 = 环境默认 | 新建 `AcpClient` 与 `session/set_config_option`；Chat 的会话级模型覆盖此默认值 |
| 终端 | `shellPath` | 空 = `$SHELL` | `terminal:create`（失败回落默认 shell 并写事件） |
| 终端 | `terminalFontSize` / `terminalScrollback` | `12` / `5000` | xterm `options` 实时更新 + fit |
| 终端 | `autoDetectDevServerUrl` | `true` | pty 输出 URL 探测（`terminal:url`） |
| 预览 | `previewHomeUrl` | `http://localhost:5173/` | `PreviewSurface` 地址栏默认值 |
| 预览 | `elementScreenshots` | `true` | 元素拾取截图（`preview:pick`） |
| 预览 | `contextDetail` | `standard` | `formatContext`：compact 去掉组件/盒模型/样式/HTML |
| 预览 | `previewIgnoreCertErrors` | `false` | 预览会话 `setCertificateVerifyProc`：自签名 https dev server 下一次加载生效 |
| 预览 | `previewPermissionSites` | `""` | 站点权限 JSON（`{ origin: ["media", …] }`）；由预览页「允许并刷新」或设置页撤销写入 |
| 预览 | `previewAgentControl` | `true` | 是否给 run 挂 `cockpit_browser` MCP（`browser_*` 工具操作预览页） |
| 数据 | — | — | 打开数据目录、导出 `.db`、重置设置 |

## 3. 持久化

`electron/db.mjs`：

```sql
CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT);   -- 单行：('app', JSON)
```

- 读取：`state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(row) }`，旧库没有该表/行时自动得到默认值。
- `persist()` 与其它表一起整库重写；新增 `flush()` 供「导出备份」强制落盘（避免 120ms 防抖窗口）。
- `DEFAULT_SETTINGS` 从 `db.mjs` 导出，`resetSettings` 直接复用。

## 4. 主进程 API

| Action | 说明 |
|---|---|
| `setSettings(patch)` | 校验后合并；`maxConcurrentRuns` 变更立即 `tick()`；空草稿会话按 `defaultAgentId` 兜底 |
| `resetSettings()` | 恢复 `DEFAULT_SETTINGS` |
| `openDataDir()` | `shell.openPath(userData)` |
| `exportData()` | `flush()` 后复制 `harness.db` 到用户选择的位置 |

`snapshot()` 额外下发 `settings`、`dbPath`、`userDataPath`、`appVersion`，因此设置页不需要额外 IPC。

校验表（`SETTINGS_SPEC`）覆盖：枚举、布尔、数字范围、字符串长度、可空 ID。未知键被忽略。

## 5. 主题

- `App` 根据 `settings.theme` 写 `data-theme="light|dark"`；`system` 走 `matchMedia` 并监听变化。
- `styles.css` 末尾提供 `:root[data-theme="dark"]` 变量块 + 对历史硬编码浅色的定点覆盖（tag / tool 气泡 / preview / toast / 状态色等）。
- 终端保持深色；预览 webview 内容保持页面自身配色。
- **限制**：这是初版深色主题，覆盖了主要面板与常见组件；个别旧样式（大量硬编码浅色）可能仍有残留，后续应把硬编码统一收敛到变量。

## 6. 新增一个设置

1. `db.mjs`：`DEFAULT_SETTINGS` 加键与默认值。
2. `main.mjs`：`SETTINGS_SPEC` 加校验规则；在生效点读取 `store.state.settings.<key>`。
3. `src/types.ts`：`Settings` 接口加字段。
4. `src/components/Settings.tsx`：在对应分区加一行（`Row` + `Toggle` / `Select` / `TextSetting` / `NumberSetting`）。
5. 若需要渲染进程即时生效，把值从 `state.settings` 传到组件或写 CSS 变量（参考主题 / Chat 字号）。
6. 文档与快捷键表（如有）同步。

## 7. 验证

- `npx tsc --noEmit` / `npx vite build` / `node --check electron/{main,db,acp}.mjs`
- 单测（临时脚本）：
  - 新库写入 `theme=dark / chatFontSize=15 / defaultAgentId` → `flush()` → 重开一致；
  - 无 `settings` 表的旧库 → 自动回落 `DEFAULT_SETTINGS`。
- 手工：切主题（含跟随系统）、改字号、关 Enter 发送、改并发上限后任务排队原因、审批策略 allow/deny、导出备份、重置设置。

## 8. 明确未做（参考产品里有，但不在本期）

| 同类产品能力 | 现状 |
|---|---|
| 账号与登录 / 用量与计费 | 未做（本地单用户） |
| 通知偏好、声音、免打扰 | 未做（任务状态与审批弹窗） |
| 集成（GitHub / Slack / Linear） | 未做 |
| 自动更新 / 签名 | 未做 |
| URL 深链 `?tab=` | 未做（分区导航 + 搜索足够） |
| 多用户 / 角色权限 | 未做（单用户） |
| 语言切换（i18n） | 未做（仅中文） |
| Agent 级独立设置页 | 暂由「执行」全局默认 + Agent 记录承担 |
