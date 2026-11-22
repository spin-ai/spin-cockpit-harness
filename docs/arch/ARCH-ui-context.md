> 层：架构 · 状态：已落地 · 核对：2026-11-22 · 覆盖：预览拾取 → Agent 上下文

# UI 上下文：预览页拾取元素 → 注入 Agent

> 目标：Agent 在终端里改前端时，用户能打开页面、点中一个元素，把「这个元素」连同选择器/样式/截图交给 Agent，而不是靠嘴描述。
> 关联：`docs/product/REQ-original.md` 第 6 条（HTML 预览）、`REQ-multi-agent-workspace.md` K1–K3（Context Bridge）、会话模型见 [`ARCH-chat-thread.md`](ARCH-chat-thread.md)。

---

## 1. 操作流程

1. Agent 在终端里起 dev server（`npm run dev`）。
2. harness 从 pty 输出自动识别 `http://localhost:<port>`，Terminal 栏出现「打开预览 :5173」，点一下即作为**终端标签页**打开（与 pty 标签并列，可切换/关闭，也可在地址栏手动改）。没有识别到地址时，点工具栏「＋ 新建 → 新建预览页」也能打开，默认地址来自设置 → 预览。
3. 点「拾取元素」→ 页面进入 DevTools 式 inspect：悬停高亮、带尺寸/标签提示。
4. 点中目标元素 → 生成 `ElementContext`，插入 Chat 输入框上方的 chip。
5. 在 Chat 里补一句「改成品牌蓝、字号 40px」→ 发送。
6. 该任务有运行中 run 则走 steer（带投递回执）；没有则新起一次 run。Agent 收到的 prompt 里带 `<ui-context>` 块。

## 2. 架构

```
Renderer
  TerminalPanel  标签栏（pty 标签 + 预览标签）
    ├─ SplitSurface（pty 标签内的窗格拆分树）
    └─ PreviewSurface（kind=preview 的网页标签 / HTML 文件标签）
         <webview src=... partition="preview">   ← 独立进程，无 preload
         「拾取元素」→ window.harness.previewPick(wcId)
Main
  preview.mjs
    guestOf: 只接受 getType() === "webview"
    attach: webContents.debugger.attach("1.3")
    Overlay.enable / setInspectMode(searchForNode)
    Overlay.inspectNodeRequested → backendNodeId
      → DOM.resolveNode → Runtime.callFunctionOn(collect)
      → Page.captureScreenshot(clip)
    → ElementContext
Renderer
  App.pendingContext → TaskChat chip → send({ context })
Main
  send: 存到 message.context；steer 直接拼进 prompt；run 在 startRun 收集
```

### 2.1 为什么用 `<webview>` + CDP

- `<webview>` 参与 DOM 布局，不需要同步 `WebContentsView` 的 bounds/层级，MVP 成本最低。
- 高亮/点选/截图只有 CDP 的 `Overlay` 域能稳定做到（自己注入脚本无法覆盖所有页面）。
- 已知取舍：`webviewTag` 是 Electron 的 deprecated API；后续要迁移到 `WebContentsView` + bounds 同步，`preview.mjs` 的 CDP 部分可原样复用。

### 2.2 安全边界（重要）

| 措施 | 原因 |
|---|---|
| `guestOf` 校验 `webContents.getType() === "webview"` | 防止把调试器挂到主窗口自己身上（那等于任意执行） |
| webview 不挂 preload、`nodeIntegration=no`、独立 `partition="preview"` | 页面拿不到 `window.harness`，不能读写本地库 |
| 截图写到 `app.getPath("userData")/ui-context/` | 不污染项目/run 的 worktree，也不进入 git 状态 |
| 拾取只读 DOM/样式，不做写操作 | 预览仍保持只读边界（编辑仍归 IDE/Agent） |

### 2.3 远端主机：`ssh -L` 隧道（`preview-tunnel.mjs`）

Agent 跑在远端主机（`Host.kind === "ssh"`）时，dev server 在**那台机器**上：本机 `<webview>` 连不到，远端 IP 也经常连不到（Vite 默认只 bind `127.0.0.1`，再加上防火墙）。所以远端一律走本地回环隧道；路由判定在主进程，渲染层只认「地址栏里的远端地址」。

```
PreviewSurface（地址栏 = 远端原始地址，如 http://localhost:5173/）
  └─ previewTunnel(hostId, url) ──▶ main: openTunnel()
        ssh -N -L 127.0.0.1:<随机空闲端口>:<目标主机>:<目标端口> user@addr
        ├─ 只绑 127.0.0.1：局域网 / 本机其它程序都访问不到
        ├─ 目标为回环 / 0.0.0.0 → 远端自己的 127.0.0.1（Vite 只 bind localhost 时才连得上）
        ├─ 目标为内网 IP / mDNS / 该主机地址 → 原样转发
        └─ 公网地址（example.com 等）→ 不建隧道，直接加载
  ◀── { url: http://127.0.0.1:<port><path>, remote: <远端原地址> }
  webview 加载隧道地址；地址栏 / 拾取上下文 / 「系统浏览器打开」都映射回 remote
```

- **主机来源**：`App` 取当前会话的 host —— 运行中 run 的 `hostId` → 最近一次 run → Agent 的 `hostId`；只有 `kind === "ssh"` 才启用隧道。同一个 `workdir`（远端绝对路径）作为源码相对化的 `rootHint`。
- **生命周期**：隧道按 `主机|地址|端口 + 目标 host:port` 复用并带引用计数；换地址 / 关标签 / 退出应用都会释放。异常断开（断网、sshd 重启）通过 `preview:tunnel:closed` 回到渲染层显示原因，不自动重连（避免刷 ssh 日志）。
- **错误直给**：`sshHint()` 把 stderr 翻成能照做的一句话（免密未配置 / 主机名解析失败 / SSH 连不上 / 远端端口没服务）；页面级失败再补一句「隧道已建，但远端该端口没服务」。
- **拾取不受影响**：CDP 依然挂在 webview 上，只是 `ctx.url` 在 IPC 边界用 `toRemoteUrl()` 换回远端地址 —— 否则 Agent 会拿着 `127.0.0.1:随机端口` 去改本机。
- **前提**：远端主机必须已能免密 `ssh`（与 `Host` 心跳探测、ACP 远端运行同一套前提）；隧道不处理密码交互。

### 2.4 预览会话：持久登录、站点权限、自签名证书

预览页是一个**长期在用的浏览器**，不是一次性沙箱：登录态要跨重启、摄像头/麦克风要能按站点授权、自签名 https 要能放行。

| 项 | 实现 | 说明 |
|---|---|---|
| 会话分区 | `persist:preview`（`main.mjs` `PREVIEW_PARTITION`） | 有 `persist:` 才落盘；不带前缀是内存会话，重启即掉登录 |
| 站点权限 | `configurePreviewSession()`：`setPermissionRequestHandler` + `setPermissionCheckHandler` | 策略在 `preview-permissions.mjs`（纯函数）：`ALWAYS_ALLOWED`（全屏 / 指针锁 / 写剪贴板）直接给；`ASKABLE`（摄像头 / 麦克风 / 位置 / 通知 / 读剪贴板 / MIDI / 跨站存储 / 开外部应用）按站点白名单；`UNSUPPORTED`（USB / 串口 / 蓝牙 / 屏幕共享 / 文件系统）**永远拒绝**，因为没有选择器 UI，允许了也是假允许 |
| 授权流 | 被拒 → `preview:permission` 事件 → 预览顶部一条「页面请求「摄像头 / 麦克风」· 允许并刷新」→ 写入 `previewPermissionSites` → 硬刷新重新申请 | 通知按 `wcId+origin+permission` 4 秒节流，避免页面轮询把渲染层刷屏 |
| 撤销 | 设置 → 预览与元素 → 站点权限（`preview:permissions:list / revoke`） | 只列已授权的 `origin · 能力`，点一下撤销 |
| 证书 | `setCertificateVerifyProc`：默认 `-3`（Chromium 默认校验），设置里开「忽略证书校验」才 `0` | 自签名 dev server 常见；改设置后下一次加载生效 |
| 登录弹窗 | `setWindowOpenHandler` 放行 http(s)，子窗口共用 `persist:preview` 且无 preload / 无 Node | 不放行的话，OAuth / `target=_blank` 登录流程直接被拒 |
| 设备选择器 | `setDevicePermissionHandler(() => false)` | 与 `UNSUPPORTED` 一致：HID / USB / 串口不做 |

> 取舍：站点权限没有做「本次允许」——只做持久授权 + 撤销。理由是一次性授权在这个产品里没有记忆点，反而让人反复点弹窗。

### 2.5 Agent 驱动预览（browser_* 工具）

预览页不只是给人看的：普通（非 Mission）ACP run 也会挂一个浏览器工具 MCP，让模型能自己导航、点、输入、截图。

```
startRun（仅本地 run；远端连不到本机回环）
  └─ browserMcpServers(run) → token 写进 browserTokens
       mcpServers += { name: "cockpit_browser", args: [browser-mcp-bridge.mjs],
                       env: COCKPIT_BROWSER_URL / COCKPIT_BROWSER_TOKEN }
dsh ─stdio(MCP)─▶ browser-mcp-bridge.mjs ─HTTP(Bearer token)─▶ main: /call ─▶ browser-tools.mjs ─CDP─▶ 预览 webview
```

| 工具 | 作用 | 关键约束 |
|---|---|---|
| `browser_state` | url / title / loading / 能否前进后退 | 先看一眼再操作 |
| `browser_open` | 在同一个预览页里导航 | 只收 http / https / file；`javascript:` / `data:` / `chrome:` 一律拒 |
| `browser_read` | 读正文或某容器文本（≤6000 字符） | 输入框返回 `value` |
| `browser_click` | 滚动到可视区后派发真实鼠标事件 | 元素不存在 / 尺寸为 0 给可读错误 |
| `browser_type` | 聚焦后 `Input.insertText`；未落地时回落 setter + `input` 事件 | React 受控组件也能收到 |
| `browser_wait` | 轮询 `querySelector`（≤30s） | 轮询而非 MutationObserver，避免跨页泄漏 |
| `browser_screenshot` | 视口 / 整页截图 | 落 `userData/preview-shots/`，返回绝对路径 |
| `browser_back/forward/reload` | 历史与刷新 | — |

- **目标页**：渲染层在标签激活且 `dom-ready` 后 `preview:active` 上报 webContentsId；工具只操作**用户正看着的那一个**预览页（`guestOf` 校验必须是 webview guest）。
- **开关**：设置 → 预览与元素 → 「Agent 可操作预览」（`previewAgentControl`，默认开）。关掉就不再挂这个 MCP server。
- **token 生命周期**：每次 run 一个随机 token，run 收尾 `releaseBrowserTokens(runId)`。
- 没打开预览页时工具返回「请先在工作区打开预览页…」，不静默失败。

### 2.6 预览面板自带的三件事：控制台 / 截图 / 录屏

对齐「工作区浏览器」的日常刚需，都不用另开 DevTools 或系统工具：

| 能力 | 实现 | 说明 |
|---|---|---|
| 控制台 | `did-attach-webview` 里接 `console-message` → `preview:console` → `PreviewSurface` 底部面板 | 环形 200 条；`error` 计数做成按钮角标；`level` 兼容结构化 `event.level`（字符串）与旧签名（数字）；Electron 自身的安全告警过滤掉；换页面清空 |
| 截图 | `preview:capture` → `browserScreenshot()`（CDP `Page.captureScreenshot`）→ 落 `userData/preview-shots/` + `clipboard.writeImage` | 和 Agent 的 `browser_screenshot` 共用一条实现，避免两套坐标 / 缩放口径 |
| 录屏 | 主进程 `capturePage()` 约 4fps 抓帧 → `preview:record:frame` → 渲染层 canvas + `MediaRecorder` → `preview:record:save` 写 `userData/recordings/*.webm` | 无音频、最长 60 秒；帧宽 >1280 下采样控制体积；`MediaRecorder` 编码在渲染层（主进程不引编码库）；主进程只保留 `setInterval` + 背压（上一帧没抓完就跳过） |

**取舍**：录屏走「JPEG 帧 + MediaRecorder」而不是主进程编码，是因为跨平台装 ffmpeg 不现实；代价是没有音频、帧率低（4fps），但足够做「给团队/给 Agent 看改成了什么样」的短片段。

## 3. 数据协议

```ts
interface ElementContext {
  kind: "dom-element";
  url: string;
  selector: string;          // 唯一 CSS 路径（id 优先，最多 2 个 class + nth-of-type）
  tag: string;
  text: string;              // 截断 200
  outerHTML: string;         // 截断 2000
  box?: { x: number; y: number; width: number; height: number };
  styles?: Record<string, string>;  // 白名单计算样式
  component?: string | null; // React fiber 组件名（开发态可用）
  source?: { file?: string; line?: number } | null; // data-ym-src 优先，其次 React _debugSource
  screenshot?: string | null; // 绝对路径
}
```

注入到 prompt 的形态（`electron/ui-context.mjs#formatContext`）：

```text
<ui-context url="http://localhost:5173/" selector="#app > main > h1.hero" source="src/pages/Home.tsx:42">
元素：<h1> 文本「hello」
组件：HeroTitle
位置尺寸：x=120 y=210 w=640 h=56
计算样式：display=block; color=rgb(17,24,39); font-size=32px
HTML：<h1 class="hero">hello</h1>
截图（绝对路径）：/Users/…/ui-context/ctx-m3k2.png
</ui-context>
```

消息本身仍只显示用户那句话，chip 在气泡上方单独渲染（K3：注入内容在消息里可见）。

## 4. 注入路径（复用单一 send 状态机）

| 会话状态 | context 的去向 |
|---|---|
| 草稿会话 + 无 `@别名` | **有 context 即视为派活**（不需要写 @），建任务 + 排队 |
| 草稿会话 + `@别名` | 按别名派活，context 随消息进本轮 run |
| `running` / `waiting_input` | steer：`prompt = 文本 + "\n\n" + <ui-context>`，消息上标投递回执 |
| `queued` | 挂到该 queued run，`startRun` 时拼进 prompt |
| 无 run、未确认 | 新起 run，context 进 prompt |
| 已确认 | 仅记录（不新建 run） |

`startRun` 收集 `runId === run.id` 的 user 消息里的 context，统一渲染成「界面上下文：…」。

## 5. 代码地图

| 文件 | 变更 |
|---|---|
| `electron/preview.mjs`（新） | CDP attach / inspect / collect / screenshot / cancel / detach；只允许 webview guest |
| `electron/preview-tunnel.mjs`（新） | 远端预览 `ssh -L`：`tunnelTarget` / `isPrivateHost` / `openTunnel`（复用 + 引用计数）/ `closeTunnel` / `toRemoteUrl` / `sshHint`；不 import electron，可直接单测 |
| `electron/ui-context.mjs`（新） | `formatContext`、`parseSourceAttr`（纯函数，可单测） |
| `electron/main.mjs` | `preview:pick / cancel / detach` IPC；`webviewTag: true`；`send` 接收 `context`；`startRun` / steer / retry 拼 `<ui-context>`；`preview:tunnel:open / close`；`before-quit` 关全部隧道 |
| `electron/db.mjs` | `messages.context`（JSON）列 + 迁移 + 持久化 |
| `electron/preload.cjs` | `previewPick / previewCancel / previewDetach` |
| `src/components/PreviewSurface.tsx` | **统一预览表面**：网页地址栏 / 本地 HTML 路径、渲染/源码、webview、「拾取元素」、刷新/Finder/复制；同一标签只保留一个 webContents；远端主机时用隧道地址加载、地址栏仍显示远端地址 |
| `src/components/TerminalPanel.tsx` | 预览作为标签页（`Tab.kind=preview`）与 pty 标签并列；终端保持挂载（切回不丢 pty） |
| `src/components/TaskChat.tsx` | composer 上方的 context chip；消息气泡里的只读元素标记；`send` 带 context |
| `src/App.tsx` | `pendingContext`；切会话时清空，避免串任务；`previewHost`（远端主机 + 远端 workdir） |
| `src/types.ts` | `ElementContext`、`Message.context` |
| `src/styles.css` | `.term-tabs` / `.preview-*` / `.composer-ctx` / `.msg-ctx` / `.ctx-tag` |

## 6. 已知限制（下一步）

| 项 | 现状 | 计划 |
|---|---|---|
| dev server URL | ✅ 已从 pty 输出自动识别（地址栏可改） | 多服务并行已按终端区分；未来按 run 绑定 |
| 元素 → 源文件 | `data-ym-src` 优先，其次 React 开发态 `_debugSource` | 非 React 项目需手写 `data-ym-src` 或加编译插件 |
| 截图进 Agent | 只给绝对路径（ACP 目前发 text） | 若 dsh 支持 image content block，再把图片作为附件 |
| 多元素 | 一次一个 | chip 列表 + 批量注入 |
| `webviewTag` | deprecated | 迁移 `WebContentsView` + bounds 同步 |
| Esc 取消 | 依赖前端提示；CDP 层有超时/取消接口 | 在 webview 内监听 Esc 后调用 `previewCancel` |
| 远端预览 | ✅ `ssh -L` 隧道（回环 / 内网地址；公网地址直连）；隧道失败时给可操作原因 | 密码登录 / 跳板机（`ProxyJump`）仍需自己写在 SSH config 里 |
| 远端文件预览 | 文件树 / `filesRead` 仍按本地路径读 | 需要远端 FS 通道，与预览分开做 |

## 7. 源码映射怎么来的

| 优先级 | 来源 | 适用 |
|---|---|---|
| 1 | 元素或最近的祖先带 `data-ym-src="src/x.tsx:42"` | 任意框架；最可靠，可手写或用编译插件注入 |
| 2 | React fiber 的 `_debugSource`（开发态） | React + Vite dev，通常无需接入 |
| 3 | 组件名 + selector + 文本 | 兜底，Agent 自己 grep |

`root`（当前任务的工作目录/worktree）用于把 `_debugSource` 的绝对路径转成项目相对路径；不在 root 下则保留绝对值。

## 8. 验证

- `node --check electron/preview.mjs electron/ui-context.mjs electron/preview-tunnel.mjs electron/main.mjs`
- `npm test -- preview-tunnel`：地址 → 隧道目标、私网判定、key 复用、ssh 报错文案（不建连，不需要远端机器）
- `npm test -- browser-tools`：URL / selector 校验、文本裁剪、bridge 协议（起子进程 + 假端点跑 initialize / tools/list / tools/call）
- `npm test -- preview-permissions` / `verify:preview-doc`：站点权限策略、docx / xlsx 转换与 LibreOffice 版式转换
- `npx tsc --noEmit` / `npx vite build`
- 纯函数测试：`formatContext` 输出、空样式过滤、`data-ym-src` 解析
- DB 测试：新库 context 往返；10 列旧 messages 表迁移后自动加 `context` 列

手动验收：

1. 打开 `http://localhost:<port>` → 页面正常渲染，`刷新` 可用。
2. 点「拾取元素」→ 页面高亮跟随鼠标 → 点中后 Chat 出现 chip（含 selector / 源文件）。
3. 不写 `@` 直接发送 → 创建任务并排队；prompt 里能看到 `<ui-context>`。
4. 运行中再拾取并发送 → 消息出现「投递中 / 已注入」，Agent 收到带元素的补充指令。
5. 切到别的会话 → chip 自动清空，不会串任务。
6. 远端主机（Agent 运行位置 = ssh）：打开 `http://localhost:<port>` → 地址栏右侧出现「隧道 · <主机>」，页面正常渲染；「拾取元素」后 chip 里的 url 是远端地址，不是 `127.0.0.1:<随机端口>`。
7. 远端 dev server 没起 / 免密没配 → 预览区直接显示原因，而不是白页 `ERR_CONNECTION_REFUSED`。

## 9. 回滚

- 只在主进程新增 `preview.mjs` / `ui-context.mjs`，删除这些文件与 `preview:*` IPC 即可；
- `messages.context` 是新增可空列，旧版本忽略即可，不影响历史数据。
