# UI 上下文：预览页拾取元素 → 注入 Agent

> 目标：Agent 在终端里改前端时，用户能打开页面、点中一个元素，把「这个元素」连同选择器/样式/截图交给 Agent，而不是靠嘴描述。
> 关联：`docs/REQ-original.md` 第 6 条（HTML 预览）、`REQ-multi-agent-workspace.md` K1–K3（Context Bridge）、会话模型见 [`ARCH-chat-thread.md`](ARCH-chat-thread.md)。

---

## 1. 操作流程

1. Agent 在终端里起 dev server（`npm run dev`）。
2. harness 从 pty 输出自动识别 `http://localhost:<port>`，Terminal 栏出现「打开预览 :5173」，点一下即作为**终端标签页**打开（与 pty 标签并列，可切换/关闭，也可在地址栏手动改）。没有识别到地址时，点工具栏「＋ 预览」也能打开，默认地址来自设置 → 预览。
3. 点「拾取元素」→ 页面进入 DevTools 式 inspect：悬停高亮、带尺寸/标签提示。
4. 点中目标元素 → 生成 `ElementContext`，插入 Chat 输入框上方的 chip。
5. 在 Chat 里补一句「改成品牌蓝、字号 40px」→ 发送。
6. 该任务有运行中 run 则走 steer（带投递回执）；没有则新起一次 run。Agent 收到的 prompt 里带 `<ui-context>` 块。

## 2. 架构

```
Renderer
  TerminalPanel  标签栏（pty 标签 + 预览标签）
    ├─ SplitSurface（pty 标签内的窗格拆分树）
    └─ PreviewPanel（kind=preview 的标签）
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
| `electron/ui-context.mjs`（新） | `formatContext`、`parseSourceAttr`（纯函数，可单测） |
| `electron/main.mjs` | `preview:pick / cancel / detach` IPC；`webviewTag: true`；`send` 接收 `context`；`startRun` / steer / retry 拼 `<ui-context>` |
| `electron/db.mjs` | `messages.context`（JSON）列 + 迁移 + 持久化 |
| `electron/preload.cjs` | `previewPick / previewCancel / previewDetach` |
| `src/components/PreviewPanel.tsx`（新） | 地址栏、webview、「拾取元素」、错误/结果提示 |
| `src/components/TerminalPanel.tsx` | 预览作为标签页（`Tab.kind=preview`）与 pty 标签并列；终端保持挂载（切回不丢 pty） |
| `src/components/TaskChat.tsx` | composer 上方的 context chip；消息气泡里的只读元素标记；`send` 带 context |
| `src/App.tsx` | `pendingContext`；切会话时清空，避免串任务 |
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

## 7. 源码映射怎么来的

| 优先级 | 来源 | 适用 |
|---|---|---|
| 1 | 元素或最近的祖先带 `data-ym-src="src/x.tsx:42"` | 任意框架；最可靠，可手写或用编译插件注入 |
| 2 | React fiber 的 `_debugSource`（开发态） | React + Vite dev，通常无需接入 |
| 3 | 组件名 + selector + 文本 | 兜底，Agent 自己 grep |

`root`（当前任务的工作目录/worktree）用于把 `_debugSource` 的绝对路径转成项目相对路径；不在 root 下则保留绝对值。

## 8. 验证

- `node --check electron/preview.mjs electron/ui-context.mjs electron/main.mjs`
- `npx tsc --noEmit` / `npx vite build`
- 纯函数测试：`formatContext` 输出、空样式过滤、`data-ym-src` 解析
- DB 测试：新库 context 往返；10 列旧 messages 表迁移后自动加 `context` 列

手动验收：

1. 打开 `http://localhost:<port>` → 页面正常渲染，`刷新` 可用。
2. 点「拾取元素」→ 页面高亮跟随鼠标 → 点中后 Chat 出现 chip（含 selector / 源文件）。
3. 不写 `@` 直接发送 → 创建任务并排队；prompt 里能看到 `<ui-context>`。
4. 运行中再拾取并发送 → 消息出现「投递中 / 已注入」，Agent 收到带元素的补充指令。
5. 切到别的会话 → chip 自动清空，不会串任务。

## 9. 回滚

- 只在主进程新增 `preview.mjs` / `ui-context.mjs`，删除这些文件与 `preview:*` IPC 即可；
- `messages.context` 是新增可空列，旧版本忽略即可，不影响历史数据。
