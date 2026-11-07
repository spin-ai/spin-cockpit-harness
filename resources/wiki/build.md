# 构建与发布

## 开发

```sh
npm install
npm run dev          # Vite + Electron
# 或
npm run build && npm start
```

前置：本机已安装 dsh 并配置好模型；启动时会自动探测 `dsh / pi / claude / codex / opencode`。

## 打包

```sh
npm run dist         # 当前平台的原生产物
npm run pack         # 只打目录，便于调试
npm run dist:system  # 不内置 dsh，依赖目标机器安装
```

产物在 `release/`。macOS 默认 dmg，Windows 默认 NSIS，Linux 默认 AppImage。

## 内置 dsh

默认构建从 PyPI 的 `deepseek-harness-runtime-bin` 平台 wheel 取 dsh 单文件运行时（pkg SEA，自带 Node 与依赖），复制到 `resources/dsh`，再打进 `Contents/Resources/dsh`。

```sh
npm run bundle:dsh
npm run smoke:dsh    # --version + ACP initialize + session/new
```

运行时优先级：

```text
设置里的可执行文件 > 内置 dsh > 系统 PATH
```

模型配置与凭据不打包；SSH 远端 run 使用远端自己的 dsh。

## 跨平台

```sh
npm run dist:mac
npm run dist:win            # x64 NSIS
npm run dist:linux          # 当前架构 AppImage
npm run dist:linux:x64
npm run dist:linux:arm64
```

- Windows 可以在 macOS 交叉打包（node-pty 使用 win 预编译）。
- Linux 的 node-pty 必须在 Linux 上重建；CI 使用原生 runner。
- macOS 产物需要签名 / 公证后才能正式分发。

## CI

`.github/workflows/build.yml` 在原生 runner 上执行：

```text
macos-14 / ubuntu-24.04 / windows-2022
  npm ci
  npx tsc --noEmit
  npm run bundle:dsh
  npm run smoke:dsh
  npm run dist
  upload artifacts
```

## 常用命令

```sh
npm run smoke:dsh     # 内置 dsh 冒烟
npm run typecheck     # tsc --noEmit
node scripts/e2e-smoke.mjs  # UI 冒烟（需要调试端口）
```
