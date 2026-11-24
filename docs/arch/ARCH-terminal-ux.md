> 层：架构 · 状态：已落地 · 核对：2026-11-24 · 覆盖：终端易用性 / pane 拆分 / 回放 / 两面切换

# 终端易用性（Terminal UX）

> 参考：常见终端实现的搜索、右键菜单、字号缩放与 pane 布局。
> 本文记录 harness 在 `src/components/TerminalPanel.tsx` 里落地的终端易用性能力、IPC 变更与明确未做的部分。
> 目标执行 / 视图模型见 [`ARCH-workbench-execution.md`](ARCH-workbench-execution.md)（部分落地）：Terminal 与 Chat 由 Carrier 决定原生面，关闭 Tab 只 detach 不再取消 Run；本文其余部分描述当前实现。

---

## 1. 目标

harness 的 Terminal 是「Agent 干活 + 人直接敲命令」的同一个 pane —— 导航里这一页叫**工作台**（英文 Workbench），pane 内部仍是终端。原实现只有多标签和一个「新建终端」按钮，日常使用有四个明显摩擦：

1. 输出找不到（没有查找、没有回到底部）。
2. 标签多了没有快捷切换，关闭只能点 ×。
3. 复制粘贴、清屏、重启只能靠 shell 里的命令。
4. Agent 启动 banner 在终端挂载前就打印完，首屏是空的。

本次按常见终端的交互补齐这些点，同时保持实现规模可控（不引入分屏 / 守护进程 / 会话恢复）。

## 2. 能力清单

| 能力 | 交互 | 实现 |
|---|---|---|
| 标签切换 | `⌃Tab` / `⇧⌃Tab`、`⌘⇧[` / `⌘⇧]`、`⌘⇧1…9` | `TermTab` 的 capture keydown → `cycleTab` / `onGotoTab` |
| 新建 / 关闭 | `⌘T` / `⌘W`、标签栏 `＋`（菜单）、标签 ×、中键 | `addTab` / `close`；在终端内截获 App 的同名快捷键，避免执行两次 |
| 标签重命名 | 双击标签，Enter 提交、Esc 取消 | `renaming` 状态 + `renamed` 标记（重命名后不再跟随 shell 标题） |
| 标签标题 | 跟随 shell 的 OSC 0/2 标题（如正在跑的命令） | `term.onTitleChange` → `patchTab` |
| 后台完成提示 | 后台标签收到 bell 时亮琥珀色提示点，切回后清除 | `term.onBell` + `attention` |
| 标签过多 | 标签条纵向滚轮转横向、激活标签自动滚入视野 | wheel listener + `scrollIntoView` |
| 查找 | `⌘F` / 右键「查找…」；增量高亮、Enter / ⇧Enter 跳转、Esc 关闭、区分大小写、正则 | `@xterm/addon-search` + `TermSearch`（配色见 `SEARCH_DECORATIONS`） |
| 复制 / 粘贴 | `⌘C`（有选区才拦截，无选区仍发 `^C`）、`⌘V`、右键菜单 | Electron `clipboard` IPC；粘贴走 `term.paste()`，保留 bracketed paste |
| 右键菜单 | 复制 / 粘贴 / 全选 / **快捷命令…** / 查找 / 清屏 / **重置终端显示** / 拆分 / **均分窗格** / 预览 / 接管 / **重命名标签** / **复制终端 ID** / 新建 / 关闭 | `TermMenu`（贴边自动收进窗口）；「均分窗格」把整棵树的比例递归置 0.5；「重置」只 `term.reset()`，不重启 shell |
| 清屏 | `⇧⌘K` | `term.clear()` |
| 字号缩放 | `⌘+` / `⌘-` / `⌘0`；`⌘0` 复位（不再有 `Npx` chip） | 面板级 `zoom` delta，持久化到 `localStorage["cmh.term.zoom"]`，上限 8–32px |
| 链接 | `http(s)` / `mailto` 可点击，用系统浏览器打开 | `@xterm/addon-web-links` + `shell:openExternal`（仅白名单 scheme） |
| 文件路径链接 | 输出里的 `src/foo.ts:12` 这类带目录的路径可点，**在文件预览标签里打开**（只认项目内路径，`..` 与项目外绝对路径直接忽略） | `term.registerLinkProvider`（正则 `路径(:行)?(:列)?`）+ `openFilePreviewTab`；hover 提示「在文件预览里打开」 |
| 快捷命令 | 右键「快捷命令…」：一键把常用命令写进当前 pty；可编辑 / 删除；每条带**范围**（本项目 / 全部项目）与**发送后回车**开关（关掉只填命令行） | `src/components/TerminalQuickCommands.tsx`：`localStorage["harness.terminal.quickCommands.v1"]`（按项目路径分组，`*` 为全局），发送 = `terminalInput(id, content + (appendEnter ? "\r" : ""))`，不经过主进程、不新增 State 字段 |
| 拆分窗格 | `⌘D` 向右、`⇧⌘D` 向下（递归嵌套）；拖拽分隔条调比例；`⌘⌥←/→/↑/↓` 按几何方向移动焦点；右键菜单 / 命令面板同入口 | `Tab.root` 二叉树 + `SplitSurface` 绝对定位布局；新窗格继承当前窗格 cwd；预览标签可拖入 pane 边缘 |
| 关闭窗格 | `⌘W` 关闭当前窗格，最后一个窗格时关闭整个标签（只关视图：pty 继续，输出回 buffer，可从「后台与最近」恢复） | `closeFocusedPane` 删除叶子并折叠空的 split；卸载走 `terminal:detach` |
| 预览标签 | 预览与终端共用一条标签栏，且**只有唯一一个预览标签**：打开文件 = 文件模式（渲染/源码），地址栏「URL」或 `打开预览 :PORT` = 地址模式（dev server / 远程页）；可双击重命名、`⌘W`/中键关闭；命令面板「打开预览（文件 / dev server / URL）」；**没有工具栏**：新建终端 / 新建预览页 / 任务详情 / 起 Agent 全部收进标签栏末尾的 `＋` 菜单 | `Tab.kind = "preview"`（`rel` 有值即文件模式）+ `PreviewSurface`（同一 webview 生命周期）；切到后台标签会自动取消拾取，避免挂在隐藏 webview 上 |
| 文件预览（Markdown） | 双击即打开，**TipTap / ProseMirror 富文本编辑器**（对齐 ORCA，不再用 contentEditable+execCommand）：工具栏 H1–H3 / B / I / S / 行内代码 / 列表 / 引用 / 代码块 / 表格 / 分割线 / 链接 / 撤销重做、选中态高亮；**Markdown 输入规则**由 StarterKit 提供（`# ` `## ` `### ` 标题、`- ` 列表、`1. ` 有序、`> ` 引用、``` 代码块）；空段落输入 `/` 打开块插入菜单；`⌘S` 保存 → `getHTML()` + turndown+gfm 转 Markdown（表格用自定义规则转 pipe 表）；`⌘K` 链接、`⌘⇧M` 切源码；TOC 跟随实时内容更新；空文档有 placeholder 提示 |
| 文件预览（HTML） | 三段「预览 / 可视化 / 源码」：① 预览=webview 只读；② **可视化=GrapesJS 画布**（懒加载，右/左面板可拖组件、改文字、调样式；保存时 `getHtml()/getCss()` 重新拼完整文档，`<head>` 里的 title/meta/script 原样保留，样式写进唯一的 `<style data-grapes>`，重复保存不会叠加）；③ 源码=textarea + ⌘S。离开可视化若有未保存修改会确认；其它文本/图片保持只读 |
| 回到最新 | 向上滚动时右下角出现悬浮按钮 | `term.onScroll` → `scrolledUp` |
| 退出态 | 进程退出后浮层显示退出码，可「重新启动」（纯 shell 标签）或关闭 | `terminal:exit` + `incarnation` 重建 xterm |
| 尺寸自适应 | 拖分隔条 / 收起侧栏 / 窗口缩放后重新 `fit` | `ResizeObserver` + rAF 节流 |
| 首屏不丢输出 | 挂载前 pty 已经打印的 banner 会回放 | 主进程 buffer + `terminal:attach` |
| 任务详情 | 标签栏里的一个「任务详情」标签（id 固定，不重复开）：显示选中任务的描述全文、验收清单、最近运行（耗时 / token / 错误）、环境（cwd / 分支 / Agent / 终端数）、产物；TODO 行内「详情」直接切过去 | `Tab.kind = "task"`（id `task`）+ `openTaskTab()`；pty 标签照常常驻，`TaskDetail` 读 `state`，不再单独建表 |
| 任务与终端绑定 | 点 TODO **默认落到 Chat**（面板收起时先展开，同「问清楚」）；终端槽位按运行时决定：终端型任务（`agent.chatRuntime=terminal` 或 `run.runtime=terminal` / 有 `terminalId`）聚焦已绑定标签并切到「终端」视图，ACP 任务停在「任务」详情；**任何情况都不新建**终端标签 | `App.selectTodo` 派发 `harness:focus-chat`；`TerminalPanel` 的 `[todo?.id]` effect 只 `setActive` + `openTaskTab()`。终端标签只由 `harness:terminal-adopt`（终端 run 启动）或工具栏「接入 #KEY」产生 —— **禁止**在选中路径上 `addTab`（否则点一条 TODO 就多一个空 shell，跨项目还会再叠一个） |

快捷键完整列表同步在 设置 → 快捷键。

## 3. 关键实现

### 3.1 输出回放（为什么需要）

Agent 从标签栏 `＋` 菜单里的「起 Agent」启动时，流程是：

```
renderer: createTerminal()  ──►  main: pty.spawn()  ──►  shell/Agent 立刻打印 banner
renderer: 挂载 <TermTab>（下一帧）──►  onTerminalData 订阅
```

订阅建立之前的输出原本直接丢失，导致「选了个 Agent，终端一片空白」。现在主进程为每个 pty 维护：

```js
info = { attached: false, buffer: "", exited: false, exitCode: null }
```

- `attached === false`：输出追加到 `buffer`（截断到 512KB）。
- `terminal:attach`：一次性返回并清空 buffer，同时把 `attached` 置为 true。
- 之后输出只走 `terminal:data` 事件。
- 渲染进程先订阅、再 attach；attach 返回前收到的实时 chunk 暂存，回放完再写，保证顺序。

### 3.2 快捷键为什么要 capture

xterm 在 textarea 上自己处理 keydown，部分组合会 `preventDefault`。标签切换 / 查找 / 缩放不能等冒泡，所以在 `.term-instance` 上注册 **capture** 监听：

- 先于 xterm 处理，处理完 `preventDefault + stopPropagation`；
- App 层的 `⌘T / ⌘W`（window bubble）不会再触发，避免一次按键建/关两个标签；
- 焦点在搜索框（`INPUT`）时直接放行，保留原生编辑快捷键。

### 3.3 应用菜单（Electron 默认菜单的冲突）

Electron 默认菜单自带的加速键会和终端抢：`⌘W` 关窗口、`⌘+/-/0` 缩放整个 webContents、`⌘R` 重载应用、`⌘A` 只作用于 textarea。`electron/main.mjs` 用 `installMenu()` 重新设置了一个最小菜单：

- 去掉 File > Close Window、View > Reload、View > Zoom；
- 去掉 Edit > Select All（⌘A 交给终端缓冲区；`App` 另外给 input/textarea 补了 ⌘A 全选）；
- 保留 Edit > Copy / Paste（xterm 监听原生 copy/paste 事件，Bracketed Paste 正常）；
- 保留 DevTools / 全屏 / 窗口菜单。

### 3.4 终端拆分（pane tree）

- **模型**：`Tab.root` 是一棵二叉树。`pane` 叶子 = 一个 pty；`split` 节点 = `dir(row/col) + ratio + a/b`。
- **渲染**：`computeLayout()` 把树换算成百分比矩形，所有窗格用绝对定位铺在 `.term-split-canvas` 里，分隔条按 split 边界绝对定位。
  - 关键点：已有窗格始终是同一个 React 节点（`key = pane.id`），**拆分不会重建/丢失原 pty**；拆分后 xterm 通过 `ResizeObserver` 重新 fit。
- **交互**：新窗格自动获得焦点；点击窗格切换焦点；窗格边框 / 窗格数 tag 提示当前焦点。
- **限制**：拆分布局只存在内存里（应用重启不恢复）；暂不支持拖拽 pane 跨标签移动、等宽/等高按钮。
- **预览 pane**：把预览 tab 拖到任意 terminal pane 的左/右/上/下边缘，或右键终端「在右侧打开预览」，即可让预览与 pty 并排；拖入后原预览 tab 被移除，预览作为 `PaneState.kind=preview/file` 留在 split tree 中。

### 3.5 退出与重启

- 主进程 `term.onExit` 保留 buffer，发 `terminal:exit { id, exitCode, signal }`。
- 标签页显示退出浮层；纯 shell 标签可用 `⌘R` / 按钮重启（`incarnation + 1`，卸载旧 xterm 并新建 pty）。
- 带 `command` 的 Agent 标签不提供重启，避免重复创建 Agent 记录。

## 4. IPC / preload 变更

| 通道 | 方向 | 说明 |
|---|---|---|
| `terminal:attach` | invoke | 返回挂载前输出 `{ data, url, exited, exitCode }` 并切换实时推送 |
| `terminal:exit` | main → renderer | 进程退出（`exitCode` / `signal`） |
| `clipboard:read` / `clipboard:write` | invoke | 主进程 Electron clipboard，避免 renderer 权限差异 |
| `shell:openExternal` | invoke | 只允许 `http(s)` / `mailto`，其余返回 false |

`preload.cjs` 对应暴露 `attachTerminal / onTerminalExit / clipboardRead / clipboardWrite / openExternal`。

## 5. 样式

`src/styles.css` 终端段新增：

- `.term-strip` / `.term-strip-actions`：终端唯一一行标签栏（标签在左，`＋` 与窗格控制在右）；
- `.term-search`：查找浮层；
- `.term-menu*`：右键菜单（`position: fixed`，贴边自动收）；
- `.term-jump-bottom`：回到底部按钮；
- `.term-exited`：退出浮层；
- `.term-rename`：标签重命名输入框；
- `.term-split-canvas` / `.term-pane-leaf` / `.term-gutter`：窗格绝对定位与分隔条；
- `.term-pane-actions`：聚焦窗格右上角的拆分按钮。

终端保持深色，不跟随 `data-theme`（与预览一致）。

## 6. 明确未做

| 参考能力 | 现状 / 原因 |
|---|---|
| 拖拽 pane 跨标签移动 / 等宽等高 / 布局持久化 | 未做：已支持递归拆分、预览拖入 pane、比例拖拽；剩余是跨标签移动与持久化 |
| 关闭时确认「命令仍在运行」 | 未做：需要前台进程探测（参考实现用 pid / 前台进程采样） |
| 会话恢复 / 休眠唤醒 / 守护进程 | 未做：pty 生命周期跟随窗口，重启应用即结束；拆分布局也不持久化 |
| 命令完成通知（OSC 133 / hook） | 未做：目前只利用 bell 做标签提示 |
| 拖拽文件到终端（插入路径） | 未做：参考实现会转义路径写进 pty |
| 任务详情里直接改任务 | 未做：详情是只读的，编辑仍在 TODO 行（双击 / 「编辑」），避免两处编辑态打架 |

### 3.5 快捷命令为什么不进主进程

ORCA 的 quick commands 存在仓库级配置里（要跨机器同步）。harness 只在一台机器上跑，快捷命令属于「手感偏好」而不是可审计的执行语义，所以：

- 存 `localStorage`，按项目绝对路径分组，`*` 是全局桶；
- 发送走的是**和手打完全一样**的 `terminalInput`，因此 Agent 正在跑的会话、接管态、拆分窗格都自然适用，不需要额外的权限判断；
- 不做「命令执行结果」的状态机：run 的语义仍归 TODO / run，终端只是通道。

## 7. 验证

```sh
npx tsc --noEmit
npm run build
node --check electron/main.mjs
node --check electron/preload.cjs
```

手工回归：

1. 从「＋ 新建 → 起 Agent」启动任一 CLI，首屏应出现完整 banner（回放生效）。
2. `⌘F` 搜索历史输出，Enter / ⇧Enter 跳转，Esc 关闭。
3. 多标签下 `⌃Tab` / `⌘⇧1…9` 切换，双击重命名后 shell 标题不再覆盖。
4. `⌘C` 有选区复制、无选区仍能中断前台命令；`⌘V` 粘贴多行。
5. `⌘+ / ⌘- / ⌘0` 缩放后重启应用仍保持。
6. `exit` 退出 shell → 浮层「重新启动」可用；Agent 标签只显示关闭。
7. 拖分隔条 / 收起 TODO 栏，`stty size` 或 `tput cols` 应与可视宽度一致。
8. 点击输出里的 `http://localhost:PORT` 用系统浏览器打开。
9. `⌘D` / `⇧⌘D` 递归拆分，原窗格输出（如 `echo MARK`）不丢；拖分隔条比例变化，嵌套拆分只影响对应容器。
10. `⌘⌥←/→/↑/↓` 在窗格间移动焦点；`⌘W` 只关当前窗格，最后一个窗格时关标签；切走再切回标签，拆分布局与各 pty 保持。

## 接管（terminal takeover）

一条 pty 同时只归一个使用者。`terminalControl` 记 `terminalId → "user"`：

- `terminalTakeControl`：人接管。期间 **Chat 的纠偏投递直接失败**（`delivery: failed` + 系统消息「终端已被你接管」），**不排队**——排队会让人的操作和 Agent 的输出交错；
- `terminalReleaseControl`：交回。往对应 thread 写一条「你接管期间它看不到输出，接下来要重新看当前输出再动手」——不假装连续；
- 标签上出现 ✋（`.term-control`），右键菜单变成「交回终端给 Agent」；
- 不做的事：屏幕截帧、鼠标键盘注入（那是桌面电脑的语义，本项目执行面是终端 / ACP，见 `product/COMPARE-rakazo.md` §1.2）。


---

## 7. 一次运行的两面：对话 / 终端（2026-11-22）

同一个 run 有两种呈现面，过去只有一只眼睛能看：ACP 跑出来的正文进 `messages`（富文本），pty 跑出来的只有终端字节流。现在两面都挂在 **run** 上，不再挂在「选中的任务」上。

| 面 | 挂载点 | 数据 |
|---|---|---|
| 对话 | 终端窗格的第一个标签（`CHAT_TAB_ID`，不落盘） | `run.result`（`resultSource = acp_text`）+ `messages` |
| 终端 | 普通标签（pty） | `run.terminalId` 对应的 pty 缓冲区 |

**产出落库**：`queueRun` 建 run 时带 `result / resultSource / resultAt / resultTruncated`；`setRunResult()` 在三种收尾处写入——ACP 完成（`lastAgentText`）、pty 结算（`info.recent`，`pty_tail`）、失败（`error`）。上限 8KB，超了标 `resultTruncated`，UI 上写「只保留尾部」。**终端尾巴不得冒充报告正文**：来源不同，UI 必须标出来。

**两面互相迁移**（不再加第二个开关）：

- 运行记录点一行 → 对话面聚焦这次 run（`focusRunId` → `RunFocusCard`）；
- 对话面的产出卡片「在终端里继续」→ 打开这次 run 绑定的 pty。

**一面还是两面的切换（2026-11-24）**：终端标签栏右侧只留**一组** `对话 | 终端`（`.term-face`，20px，只显示当前 run 的两面），
不再有「在对话里继续」这条文字链——那是同一次运行的第二个入口，违反「一个动作只有一个常驻入口」。

- 判定：`pairTaskId` = 对话面取当前任务、终端面取标签 / 终端记录的 `todoId`；`pairThreadId` 由它反查 thread；
  `pairTerminalTab` 是这个任务已打开的 pty 标签。两者都没有时不渲染这一组。
- 切「对话」：先钉住同一条 run（`onContinueInChat(taskId)` → `focusRunId`），再切面 → 打开就落在这次运行的产出卡上。
- 切「终端」：激活**已存在**的标签；不会新建、不会重排标签或列表。
- 点终端标签时反方向同步：按标签 `taskId`（或终端记录的 `todoId`）反查 thread，若和当前对话不同则 `onFocusThread(threadId)`。
  效果是不再出现「对话在看 #12、终端是 #13 的 shell」。
- ACP 执行没有终端面：`终端` 按钮置灰并写清原因，不伪造标签。

**Agent 开启方式**：设置 → 执行 → 「Agent 开启方式」（对话 / 终端），落 `agent.chatRuntime`（`updateAgent` 接受该字段，主管强制 ACP）。这是「这条 Agent 的对话用哪种面」的默认值，改完对下一次派活生效。

## 8. 退出时拆 pty（2026-11-22 崩溃）

现象：开着终端退出应用，主进程 `SIGABRT`，CrashReporter 里是
`node::Environment::CleanupHandles() → uv__async_io → Napi::ThreadSafeFunction::CallJS → Napi::Error::ThrowAsJavaScriptException → __cxa_throw → abort`
（`pty.node` 里的 `SetupExitCallback` 那个 TSFN）。崩完单实例锁会留下一个没窗口的进程，下次 `open` 起不来。

原因：`before-quit` 里只 `term.kill()`（SIGHUP 子进程），**没有关读流**。fd 还开着 → 退出过程中 pty 继续推数据 / 触发 exit 回调 → 往已经进入清理的 V8 环境里回调 → napi 抛 C++ 异常 → terminate。

修法（`electron/main.mjs`）：

1. `destroyPty(term)`：先 `removeAllListeners()`，再 `destroy()`（关读流 + SIGHUP）——只 `kill()` 不够；
2. `before-quit` 跑两趟：第一趟只拆 pty 并 `event.preventDefault()`，200ms 后再 `app.quit()`，让 exit 回调在 JS 环境还在时落地；第二趟做原有结算（run 标 `interrupted` / 终端结算 / 关 store）。
