# 终端与预览

> 终端不是“能显示输出”的黑框。它得能开多个、拆开、搜索、重启，还要和 Chat、预览、文件树共用同一个项目目录。

![五列工作台](./wiki/layout.png)

*图：TODO / Chat / Terminal / 文件 / 导航同屏联动。终端默认吃掉剩余宽度，但随时可以收起。*

## 为什么是真实 PTY

`node-pty` 启动的是真实 shell（zsh / bash / PowerShell），不是把命令输出重定向到一个 `<pre>` 里。你可以在里面跑 `vim`、`top`、`npm run dev`，也可以直接输入命令。

每个标签独立 pty，关闭标签会结束进程树。终端输出在组件挂载前会先缓存，挂载后一次性回放，避免首屏空白。

## 一个终端的日常

- `⌘T` 新建终端，`⌘W` 关闭当前窗格。
- `⌘D` 向右拆分，`⇧⌘D` 向下拆分；拆分是二叉树，不会重建已有 xterm。
- `⌃Tab` / `⌘⇧[ ]` / `⌘⇧1…9` 切换标签。
- `⌘F` 查找，Enter / ⇧Enter 跳转。
- `⌘C` 有选区时复制，没有选区时仍把 `^C` 发给 shell。
- 右键菜单：复制 / 粘贴 / 全选 / 查找 / 清屏 / 新建 / 关闭。
- `⌘+` / `⌘-` / `⌘0` 调整字号。
- 链接用系统浏览器打开；进程退出后纯 shell 标签可以重启。

这些细节不改变能力边界，但决定它是不是每天愿意用的工具。

## 预览是终端的一个标签

预览不是另一个模式，而是标签条里的一种标签：

- **文件预览**：文本 / 图片 / Markdown / HTML，跟随当前 run 的 worktree。
- **Markdown**：富文本 / 源码切换、目录、相对文档链接跳转。
- **HTML**：预览 / 可视化 / 源码三段；可视化是 **GrapesJS 画布**（拖组件、改文字、调样式），`⌘S` 回写完整 HTML。
- **dev server**：终端打印的 localhost 地址会自动识别，点一下就在预览标签里打开。

预览标签可以拖进拆分窗格；切标签 / 源码渲染切换 / 刷新都不会重载 webContents，登录态和页面状态还在。

## 元素拾取：让 Agent 看见界面

Agent 改前端时，最痛苦的是沟通：

> “把首页那个大标题改大一点，颜色换成品牌蓝。”

“那个”是哪个？多大？哪个蓝？

预览里点「拾取元素」后，页面进入 DevTools 式 inspect。点中元素，生成结构化上下文：

```text
<ui-context url="http://localhost:5173/" selector="#app > main > h1.hero" source="src/pages/Home.tsx:42">
元素：<h1> 文本「hello」
组件：HeroTitle
位置尺寸：x=120 y=210 w=640 h=56
计算样式：display=block; color=rgb(17,24,39); font-size:32px
HTML：<h1 class="hero">hello</h1>
截图（绝对路径）：/Users/…/ui-context/ctx-m3k2.png
</ui-context>
```

![元素拾取链路](./wiki/ui-context.png)

*图：CDP 拾取 → ElementContext → Chat chip → `<ui-context>` 注入 prompt；只允许 webview guest。*

Chat 输入框上方会出现元素 chip（selector / 源文件 / 截图），发送时注入当前会话；任务运行中则作为 steer 送达。

源码定位优先级：

1. `data-ym-src="src/x.tsx:42"`（最可靠，可手写或用编译插件注入）
2. React 开发态 `_debugSource`
3. 组件名 + selector + 文本（兜底）

## 安全边界

- 调试器只挂 `webview` guest，不挂主窗口。
- webview 不挂 preload，`nodeIntegration=no`，使用独立 `partition="preview"`。
- 页面拿不到 `window.harness`，不能读写本地数据库。
- 拾取只读 DOM / 样式，不做写操作。

**给 Agent 开能力的时候，先想清楚它能不能反过来控制宿主。**


## 终端优先 / 元数据

- 工具栏「＋ Agent」不先建任务，直接在当前 cwd 起原生 CLI；之后可「接入」选中任务。
- 终端记录持久化：项目、任务、run、agent、cwd、状态、exitCode、最近输出。
- 未绑定任务的运行中终端会出现在 Chat 全局进展、场景页和 TODO 的「终端 Agent」区。
- worktree 策略按场景配置 `auto / always / never`；任务行可打开或清理。
