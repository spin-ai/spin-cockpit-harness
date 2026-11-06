# Cockpit Harness v0.2.0-alpha.1 — Liftoff

首个公开 Alpha。Cockpit Harness 是一个多 Agent 编排工作台：**Chat 分派任务 → project 下开 Terminal → Agent 执行 → 看板看状态 → 确认后进 TODO LIST**。

> ⚠️ Alpha：数据库结构、IPC 与 UI 仍可能调整。升级前请备份本地数据。

## 下载

在下方 Assets 中选择对应平台：

- **macOS（Apple Silicon / arm64）**：`Cockpit Harness-0.2.0-alpha.1-arm64.dmg`
- **Windows（x64）**：`Cockpit Harness Setup 0.2.0-alpha.1.exe`
- **Linux（x86_64）**：`Cockpit Harness-0.2.0-alpha.1.AppImage`

安装前请确认平台；`SHA256SUMS.txt` 可用于校验。

### 安装提示

- **macOS**：构建未签名/未公证。首次打开如被拦截，右键 App → 打开，或执行：
  ```sh
  xattr -dr com.apple.quarantine "/Applications/Cockpit Harness.app"
  ```
- **Windows**：未签名，SmartScreen 可能提示；选择「更多信息 → 仍要运行」。
- **Linux**：
  ```sh
  chmod +x "Cockpit Harness-0.2.0-alpha.1.AppImage"
  ./Cockpit\ Harness-0.2.0-alpha.1.AppImage
  ```

## 这版包含

- Chat / TODO / Agent run 闭环，支持 steer、排队、停止、重试
- 终端多标签、递归窗格拆分、查找、右键菜单、链接、字号缩放、退出重启、输出回放
- dev server 预览与本地 HTML 共用的统一预览表面；渲染/源码、元素拾取注入 Chat
- Markdown 渲染、文件预览、资源管理器完整右键菜单
- 项目 / 收件箱 / 统计 / 主机 / 设置；统计范围切换与图表
- 命令面板全局搜索任务与会话；深浅色主题；窄视口适配
- 内置 dsh 单文件运行时（MIT），无需目标机器安装 dsh

## 已知限制

- 未实现：附件/图片粘贴、消息重新生成、文件树多选/拖拽、会话置顶/删除、run 日志详情、自定义快捷键
- macOS 仅提供 Apple Silicon 构建；Linux 为 x86_64
- 未做代码签名与自动更新

## 反馈

- Bug / 功能建议：[Issues](https://github.com/spin-ai/spin-cockpit-harness/issues)
- 安全问题：请按 [SECURITY.md](https://github.com/spin-ai/spin-cockpit-harness/blob/main/SECURITY.md) 私下报告

## License

MIT。第三方依赖与 dsh 运行时许可见 [THIRD_PARTY_NOTICES.md](https://github.com/spin-ai/spin-cockpit-harness/blob/main/THIRD_PARTY_NOTICES.md)。
