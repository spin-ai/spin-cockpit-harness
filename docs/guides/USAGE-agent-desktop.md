> 层：指南 · 状态：已落地 · 核对：2026-11-17 · 覆盖：桌面操作 MCP（agent-desktop）的安装、权限与开启方式

# 用 agent-desktop 让 Agent 操作桌面

> 上游：<https://github.com/vercel-labs/agent-desktop>（Apache-2.0，Rust + npm 包）。
> 它读的是**系统可访问性树**（macOS AX / Windows UIA / Linux AT-SPI），不是截图匹配；CLI 本身没有模型，循环在 Agent 里。

## 1. 它提供什么

- `snapshot`：把一个窗口的可访问性树返回成 JSON，每个可交互元素带 `@<snapshot>:<ref>` 引用
- `click / type / set-value / select / toggle / scroll / press …`：对 ref 执行动作，**默认 headless**（不动鼠标、不抢焦点）
- `mcp`：把全部命令作为 MCP 工具（`desktop_snapshot`、`desktop_click` …，本机 1.3.1 是 75 个）挂给 Agent

## 2. 安装（外部依赖，不进安装包）

```bash
npm install -g agent-desktop      # 或 brew install agent-desktop
agent-desktop status              # 看平台 / 权限 / 支持的面
agent-desktop --version
```

macOS 权限：

- **辅助功能**（必须）：`agent-desktop permissions --guide` 会打开系统设置并说明把哪个 App 拖进去
- **屏幕录制**（可选）：只有 `screenshot` 需要；本集成只用可访问性树，不需要

本机实测（2026-11-17）：`accessibility=granted`，`screen_recording=denied`，`snapshot --window-id …` 返回 25 个 ref。

## 3. 在 Harness 里开启

设置 → 执行 → **桌面操作（agent-desktop）** → 打开开关。

- 开启后，本地 run（worker 与 Mission supervisor）的 ACP `session/new` 会多一个 MCP：
  `{ name: "agent_desktop", command: "<npm 全局 bin>/agent-desktop", args: ["mcp"] }`
- CLI 找不到时不会挂载（不会让整次 run 失败）：只按 `settings.agentDesktopEnabled` + 可执行文件是否存在决定
- 关闭后新 run 不再挂载；已经在跑的 run 不受影响

### 3.1 执行层提示（开启后自动注入）

开关打开时，worker run 的 prompt 里会多一段「桌面操作」规则（不重复工具清单，只给纪律）：

- 先 `desktop_snapshot` 拿 `@snapshot:ref`，再 `desktop_click` / `desktop_type`；**ref 只属于那次快照**，UI 变了必须重拍
- 默认 headless（不动鼠标、不抢焦点）；不需要截图，读可访问性树
- 拿不到窗口先 `desktop_list_windows`，用 `window_id` 限定（同名 Electron 应用尤其需要）
- 快照可能含私人内容：不贴日志、不外传、不写进提交信息
- 规则不确定时调 `desktop_skills_get`（`desktop` / `platform`），和二进制版本一致

Mission supervisor **不注入**这段（它不操作桌面，代码改动交给 worker）。

## 4. 隐私与边界

- 快照、剪贴板、截图、命令输出都可能包含**私人桌面内容**：不要贴进公开日志/issue。
- 这是「Agent 能读你屏幕上任何窗口」的能力，默认**关闭**；只在受控环境开。
- 远端主机 run 不挂载（CLI 在远端没装）。
- 面板里只有「可见窗口」能被快照；同名的 Electron 应用容易重名，优先用 `agent-desktop list-windows` 拿 `--window-id`。

## 5. 验证

```bash
agent-desktop status                     # accessibility 应为 granted
agent-desktop list-windows               # 找目标窗口 id（只打印 app_name，不打印标题）
agent-desktop snapshot --window-id <id> -i --compact | head -c 300
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | agent-desktop mcp | head -c 300
```

## 6. 明确未做

- 不打包 agent-desktop（体积 + 原生二进制 + 权限提示都不适合塞进 Electron 包）
- 不给它单独 UI（没有「桌面操作面板」；Agent 通过 MCP 工具调用）
- 不做截图/录屏（`desktop_screenshot` 仍可用，但需要用户自己授予屏幕录制权限）
- 不做跨主机（远端 run 不挂载）
