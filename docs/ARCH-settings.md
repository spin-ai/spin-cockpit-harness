# 设置（Settings）

> 参考：ORCA `src/renderer/src/components/settings/*`（General / Appearance / Agents / Terminal / Notifications / Shortcuts / Advanced 的分组与行式表单）、Multica `packages/views/settings/*`（左侧分区导航 + 右侧卡片、搜索式入口、设置即保存）。
> 本文描述 harness 里已落地的设置项、持久化与生效链路。新增设置照着第 6 节加即可。

---

## 1. 形态

```
导航栏「设置」/ ⌘,
┌──────────────┬──────────────────────────────────────────────┐
│ 设置          │  通用 / 外观 / 执行 / 终端 / 预览与元素 / 数据  │
│ 通用          │  ┌ Card：标题 + 说明 ────────────────────┐   │
│ 外观          │  │ Row：标题 + hint        [ control ]    │   │
│ 执行          │  └───────────────────────────────────────┘   │
│ 终端          │  ...                                         │
│ 预览与元素    │                                              │
│ 数据          │                                              │
│ 快捷键        │                                              │
│ 关于          │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- **改动即时保存**：开关/下拉立即提交；文本与数字在 blur / Enter 时提交，避免每次按键写库。
- 保存后顶部显示「已自动保存」（2 秒）。
- 所有值经过主进程白名单 + 类型/范围校验，非法值回落到默认值。

## 2. 设置项与生效点

| 分区 | 键 | 默认 | 生效位置 |
|---|---|---|---|
| 通用 | `defaultView` | `workspace` | 启动时 `App` 首屏 |
| 通用 | `defaultAgentId` | 自动按项目 | `newThreadRecord` / `ensureThreads` / `send` 的 agent 兜底 |
| 通用 | `enterToSend` | `true` | `TaskChat` 输入框（关闭后 ⌘/Ctrl+Enter 发送） |
| 通用 | `confirmStop` | `false` | `TaskPane` 停止按钮 |
| 外观 | `theme` | `system` | `document.documentElement[data-theme]`；system 监听 `prefers-color-scheme` |
| 外观 | `chatFontSize` | `13` | CSS 变量 `--chat-font-size`（消息体 + 输入框） |
| 执行 | `maxConcurrentRuns` | `0`（不限） | `tick()` 全局并发闸门，排队原因「等待全局并发」 |
| 执行 | `approvalPolicy` | `ask` | ACP `session/request_permission`：ask 弹窗 / allow / deny |
| 执行 | `dshBinary` / `dshHome` / `model` / `effort` | 空 = 环境默认 | 新建 `AcpClient` 与 `session/set_config_option` |
| 终端 | `shellPath` | 空 = `$SHELL` | `terminal:create`（失败回落默认 shell 并写事件） |
| 终端 | `terminalFontSize` / `terminalScrollback` | `12` / `5000` | xterm `options` 实时更新 + fit |
| 终端 | `autoDetectDevServerUrl` | `true` | pty 输出 URL 探测（`terminal:url`） |
| 预览 | `previewHomeUrl` | `http://localhost:5173/` | `PreviewPanel` 地址栏默认值 |
| 预览 | `elementScreenshots` | `true` | 元素拾取截图（`preview:pick`） |
| 预览 | `contextDetail` | `standard` | `formatContext`：compact 去掉组件/盒模型/样式/HTML |
| 数据 | — | — | 打开数据目录、导出 `.db`、清空收件箱、重置设置 |

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
| `clearInbox()` | 只清通知 |

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

| ORCA / Multica 能力 | 现状 |
|---|---|
| 账号与登录 / 用量与计费 | 未做（本地单用户） |
| 通知偏好、声音、免打扰 | 未做（收件箱固定规则） |
| 集成（GitHub / Slack / Linear） | 未做 |
| 自动更新 / 签名 | 未做 |
| 设置搜索、URL 深链 `?tab=` | 未做（分区导航足够小） |
| 多用户 / 角色权限 | 未做（单用户） |
| 语言切换（i18n） | 未做（仅中文） |
| Agent 级独立设置页 | 暂由「执行」全局默认 + Agent 记录承担 |
