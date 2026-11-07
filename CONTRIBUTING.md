# Contributing

感谢你愿意参与 Cockpit Harness。当前项目处于 **Alpha** 阶段，接口、数据库结构和 UI 仍可能调整；提交前请先开 Issue 讨论较大的改动。

## 开发环境

- Node.js **>= 22**（推荐 24 LTS）
- npm **>= 10**
- 平台构建依赖：
  - macOS：Xcode Command Line Tools
  - Linux：`build-essential`、`python3`、`libarchive-tools`、`fakeroot`
  - Windows：Visual Studio Build Tools（含 C++ 组件）
- 可选：本机安装 `dsh`（`dsh --version` 可用），或使用 `npm run bundle:dsh` 下载单文件运行时

```sh
npm ci
npm run dev          # Vite + Electron
npm run dev:web      # 只跑渲染层
```

## 提交前检查

```sh
npm run typecheck
npm run build
node --check electron/main.mjs
node --check electron/db.mjs
node --check electron/acp.mjs
node --check electron/mcp-bridge.mjs
node --check electron/plugins/host.mjs
node --check electron/plugins/runtime.mjs
node --check plugins/notes/main.mjs
npm run verify:mission
npm run verify:plugins
```

涉及 dsh 执行/PTY 的改动，请额外运行：

```sh
npm run bundle:dsh
npm run smoke:dsh
```

## 代码约定

- 渲染层：React 19 + TypeScript；避免引入新的状态库，优先沿用 `App` 的 state + action 模式。
- 主进程：`electron/main.mjs` 负责 IPC 与状态机；数据库 schema 变更必须同时更新 `electron/db.mjs` 的迁移。
- 终端/xterm、文件操作、预览 webview 的改动请说明安全边界（路径必须在项目根目录内）。
- UI 沿用现有的 token / CSS 变量，深浅色主题都要验证；窄宽度（1180px）下不能横向溢出。
- 不要提交 `release/`、`dist/`、`node_modules/`、`resources/dsh/` 二进制或任何密钥。

## PR 流程

1. Fork 并以 `feat/<topic>` / `fix/<topic>` 开分支。
2. 一个 PR 只做一件事；附截图或录屏（UI 改动必须）。
3. 描述里写清：背景、改动、验证方式、已知限制。
4. 等待 CI（`.github/workflows/build.yml`）通过。
5. 维护者合入；较大的功能请先在 Issue 里对齐范围。

## 安全

安全问题**不要**开公开 Issue，请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可

提交即表示你同意以 [MIT License](LICENSE) 授权你的贡献。
