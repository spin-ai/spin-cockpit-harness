# Security Policy

## Supported versions

当前仅维护最新的 **Alpha** 版本。旧版本不保证安全更新。

| Version | Supported |
|---|---|
| `0.2.0-alpha.x` | ✅ |
| 更早版本 | ❌ |

## Reporting a vulnerability

**请不要在公开 Issue 中报告安全问题。**

请通过 GitHub 的私密漏洞报告：

<https://github.com/spin-ai/spin-cockpit-harness/security/advisories/new>

报告时请尽量包含：

- 影响版本 / 平台
- 复现步骤或 PoC
- 影响范围（本地文件、IPC、预览 webview、Agent 执行等）
- 是否能在无用户交互下触发

维护者会尽力在 72 小时内确认，并在修复后与你协调披露时间。

## Scope

Cockpit Harness 是本地优先的 Electron 应用，重点关注：

- 渲染进程 / preload / IPC 的权限边界
- 文件操作是否被限制在项目根目录内
- 预览 webview 的 sandbox / nodeIntegration / preload 隔离
- Agent 输出被当作 HTML/Markdown 渲染时的注入风险
- 本地 SQLite / 用户数据目录的读写

## 不在 scope 内

- 第三方 Agent CLI（`dsh` 等）本身的安全问题，请向对应项目报告
- 用户主动粘贴/执行的命令造成的本机影响
- 未签名开发构建在 macOS/Windows 上的系统警告
