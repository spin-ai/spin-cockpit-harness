# 终端易用性（Terminal UX）

> 参考：reference `src/renderer/src/components/terminal-pane/*`、`TerminalSearch.tsx`、`TerminalContextMenu.tsx`、`useTerminalFontZoom.ts`、`terminal-search-options.ts`。
> 本文记录 harness 在 `src/components/TerminalPanel.tsx` 里落地的终端易用性能力、IPC 变更与明确未做的部分。

---

## 1. 目标

harness 的 Terminal 是「Agent 干活 + 人直接敲命令」的同一个 pane。原实现只有多标签和 `＋ 终端`，日常使用有四个明显摩擦：

1. 输出找不到（没有查找、没有回到底部）。
2. 标签多了没有快捷切换，关闭只能点 ×。
3. 复制粘贴、清屏、重启只能靠 shell 里的命令。
4. Agent 启动 banner 在终端挂载前就打印完，首屏是空的。

本次按 reference 的终端交互补齐这些点，同时保持实现规模可控（不引入分屏 / 守护进程 / 会话恢复）。

## 2. 能力清单

| 能力 | 交互 | 实现 |
|---|---|---|
| 标签切换 | `⌃Tab` / `⇧⌃Tab`、`⌘⇧[` / `⌘⇧]`、`⌘⇧1…9` | `TermTab` 的 capture keydown → `cycleTab` / `onGotoTab` |
| 新建 / 关闭 | `⌘T` / `⌘W`、`＋`、标签 ×、中键 | `addTab` / `close`；在终端内截获 App 的同名快捷键，避免执行两次 |
| 标签重命名 | 双击标签，Enter 提交、Esc 取消 | `renaming` 状态 + `renamed` 标记（重命名后不再跟随 shell 标题） |
| 标签标题 | 跟随 shell 的 OSC 0/2 标题（如正在跑的命令） | `term.onTitleChange` → `patchTab` |
| 后台完成提示 | 后台标签收到 bell 时亮琥珀色提示点，切回后清除 | `term.onBell` + `attention` |
| 标签过多 | 标签条纵向滚轮转横向、激活标签自动滚入视野 | wheel listener + `scrollIntoView` |
| 查找 | `⌘F` / 工具栏放大镜；增量高亮、Enter / ⇧Enter 跳转、Esc 关闭、区分大小写、正则 | `@xterm/addon-search` + `TermSearch`（配色见 `SEARCH_DECORATIONS`） |
| 复制 / 粘贴 | `⌘C`（有选区才拦截，无选区仍发 `^C`）、`⌘V`、右键菜单 | Electron `clipboard` IPC；粘贴走 `term.paste()`，保留 bracketed paste |
| 右键菜单 | 复制 / 粘贴 / 全选 / 查找 / 清屏 / 新建 / 关闭 | `TermMenu`（贴边自动收进窗口） |
| 清屏 | `⇧⌘K` | `term.clear()` |
| 字号缩放 | `⌘+` / `⌘-` / `⌘0`；缩放后工具栏出现 `Npx` 复位按钮 | 面板级 `zoom` delta，持久化到 `localStorage["cmh.term.zoom"]`，上限 8–32px |
| 链接 | `http(s)` / `mailto` 可点击，用系统浏览器打开 | `@xterm/addon-web-links` + `shell:openExternal`（仅白名单 scheme） |
| 拆分窗格 | `⌘D` 向右、`⇧⌘D` 向下（递归嵌套）；拖拽分隔条调比例；`⌘⌥←/→/↑/↓` 按几何方向移动焦点；右键菜单 / 命令面板同入口 | `Tab.root` 二叉树 + `SplitSurface` 绝对定位布局；新窗格继承当前窗格 cwd；预览标签可拖入 pane 边缘 |
| 关闭窗格 | `⌘W` 关闭当前窗格，最后一个窗格时关闭整个标签 | `closeFocusedPane` 删除叶子并折叠空的 split |
| 预览标签 | 预览与终端共用一条标签栏，且**只有唯一一个预览标签**：打开文件 = 文件模式（渲染/源码），地址栏「URL」或 `打开预览 :PORT` = 地址模式（dev server / 远程页）；可双击重命名、`⌘W`/中键关闭；命令面板「打开预览（文件 / dev server / URL）」；工具栏不再单列「＋ 预览」 | `Tab.kind = "preview"`（`rel` 有值即文件模式）+ `PreviewSurface`（同一 webview 生命周期）；切到后台标签会自动取消拾取，避免挂在隐藏 webview 上 |
| 文件预览（Markdown） | 双击文件树即打开，默认**富文本**渲染（marked + DOMPurify）；头部「富文本 / 源码」切换；**目录**按钮（ListIcon）在左侧停靠，只收录真实标题（跳过代码围栏），点击跳转并高亮；源码模式可直接编辑，`⌘S` 或「保存」写盘，保存后富文本与目录立即更新 |
| 文件预览（HTML） | 头部「预览 / 编辑」切换；编辑为源码 textarea + 保存（`⌘S`），保存后 webview 自动重载；其它文本/图片文件保持只读预览 |
| 回到最新 | 向上滚动时右下角出现悬浮按钮 | `term.onScroll` → `scrolledUp` |
| 退出态 | 进程退出后浮层显示退出码，可「重新启动」（纯 shell 标签）或关闭 | `terminal:exit` + `incarnation` 重建 xterm |
| 尺寸自适应 | 拖分隔条 / 收起侧栏 / 窗口缩放后重新 `fit` | `ResizeObserver` + rAF 节流 |
| 首屏不丢输出 | 挂载前 pty 已经打印的 banner 会回放 | 主进程 buffer + `terminal:attach` |

快捷键完整列表同步在 设置 → 快捷键。

## 3. 关键实现

### 3.1 输出回放（为什么需要）

Agent 从工具栏下拉启动时，流程是：

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

- `.term-icon-btn` / `.term-zoom-chip`：工具栏小控件（查找、字号复位）；
- `.term-search`：查找浮层；
- `.term-menu*`：右键菜单（`position: fixed`，贴边自动收）；
- `.term-jump-bottom`：回到底部按钮；
- `.term-exited`：退出浮层；
- `.term-rename`：标签重命名输入框；
- `.term-split-canvas` / `.term-pane-leaf` / `.term-gutter`：窗格绝对定位与分隔条；
- `.term-pane-actions`：聚焦窗格右上角的拆分按钮。

终端保持深色，不跟随 `data-theme`（与预览一致）。

## 6. 明确未做

| reference 能力 | 现状 / 原因 |
|---|---|
| 拖拽 pane 跨标签移动 / 等宽等高 / 布局持久化 | 未做：已支持递归拆分、预览拖入 pane、比例拖拽；剩余是跨标签移动与持久化 |
| 关闭时确认「命令仍在运行」 | 未做：需要前台进程探测（reference 用 pid / 前台进程采样） |
| 会话恢复 / 休眠唤醒 / 守护进程 | 未做：pty 生命周期跟随窗口，重启应用即结束；拆分布局也不持久化 |
| 命令完成通知（OSC 133 / hook） | 未做：目前只利用 bell 做标签提示 |
| 文件路径链接点击 → 编辑器 | 未做：只处理 URL；文件跳转仍在右侧资源管理器 |
| 快速命令（quick commands） | 未做：可从命令面板派生的后续项 |
| 拖拽文件到终端（插入路径） | 未做：reference 会转义路径写进 pty |

## 7. 验证

```sh
npx tsc --noEmit
npm run build
node --check electron/main.mjs
node --check electron/preload.cjs
```

手工回归：

1. 从 `＋ Agent` 启动任一 CLI，首屏应出现完整 banner（回放生效）。
2. `⌘F` 搜索历史输出，Enter / ⇧Enter 跳转，Esc 关闭。
3. 多标签下 `⌃Tab` / `⌘⇧1…9` 切换，双击重命名后 shell 标题不再覆盖。
4. `⌘C` 有选区复制、无选区仍能中断前台命令；`⌘V` 粘贴多行。
5. `⌘+ / ⌘- / ⌘0` 缩放后重启应用仍保持。
6. `exit` 退出 shell → 浮层「重新启动」可用；Agent 标签只显示关闭。
7. 拖分隔条 / 收起 TODO 栏，`stty size` 或 `tput cols` 应与可视宽度一致。
8. 点击输出里的 `http://localhost:PORT` 用系统浏览器打开。
9. `⌘D` / `⇧⌘D` 递归拆分，原窗格输出（如 `echo MARK`）不丢；拖分隔条比例变化，嵌套拆分只影响对应容器。
10. `⌘⌥←/→/↑/↓` 在窗格间移动焦点；`⌘W` 只关当前窗格，最后一个窗格时关标签；切走再切回标签，拆分布局与各 pty 保持。
