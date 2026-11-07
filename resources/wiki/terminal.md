# 终端与预览

## 真实 pty

- `node-pty` 启动真实 shell（zsh / bash / PowerShell）。
- 每个标签独立 pty；关闭标签会结束进程树。
- 支持字号缩放、查找、链接打开、右键菜单、退出后重启。
- 终端输出在挂载前会缓存并回放，避免首屏空白。

## 标签与拆分

- `⌘T` 新建终端，`⌘W` 关闭当前窗格。
- `⌘D` 向右拆分，`⇧⌘D` 向下拆分。
- 拆分窗格共享二进制布局；拖拽分隔条调整比例。
- 预览标签可以拖进任意一半窗格。

## 预览

- 文件预览：文本 / 图片 / HTML，跟随当前 run 的 worktree。
- dev server 预览：终端打印的 localhost 地址会自动识别。
- 预览作为终端标签存在，不打断 pty 会话。

## 元素拾取 → UI 上下文

1. 在预览页点击「拾取元素」。
2. 通过 CDP 选中 DOM，优先读取 `data-ym-src` / React `_debugSource`。
3. Chat 输入框出现元素 chip（selector / 源文件 / 截图）。
4. 发送时注入结构化 `<ui-context>`；运行中即作为 steer 送达。
5. 截图写入 `userData/ui-context`，不污染项目 worktree。

## 使用建议

- 把预览和终端放在同一个分屏里，边跑边看。
- 终端里的 Agent 与 Chat 的 ACP run 是两条通道；需要 Chat 纠偏时用 Chat 输入。
- 终端专用 CLI（pi / claude / codex / opencode）在终端里使用，不经过 Chat 适配器。
