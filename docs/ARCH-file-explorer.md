# 资源管理器（File Explorer）

> 参考：ORCA `src/renderer/src/components/right-sidebar/file-explorer/`（行右键菜单、背景菜单、新建/重命名、Finder 显示、复制路径、终端打开、自动刷新）。
> 本文记录右侧栏资源管理器已落地的能力、文件操作 IPC 与安全边界。

---

## 1. 能力

| 能力 | 交互 |
|---|---|
| 展开 / 折叠 | 点击目录行、`→` / `←`、全部折叠 |
| 打开预览 | 点击文件 / 右键「预览」；在**终端区**作为标签打开（不再挤在 280px 右侧栏），新建文件后自动打开 |
| Markdown / HTML | 默认「渲染」，可切「源码」；Markdown 用 `marked` + DOMPurify（支持标题锚点跳转），HTML 在 sandboxed `<webview>` 里用 `file://` 渲染（相对资源可解析） |
| 名称筛选 | 顶部搜索框，匹配当前已加载的树 |
| 显示点文件 | 工具栏眼睛按钮 |
| 刷新 | 工具栏刷新；窗口重新聚焦时自动刷新（有行内编辑/菜单时不打断） |
| 新建文件 / 文件夹 | 工具栏 `+文件` / `+文件夹`、空白处右键；行内输入，Enter 提交 / Esc 取消 |
| 重命名 | 行右键「重命名」或 `F2`；行内输入，Enter 提交 / Esc 取消 |
| 复制副本 | 行右键「复制副本」（`name copy.ext`，同名自动追加序号） |
| 删除 | 行右键「删除」或 `Delete` / `Backspace`；进系统废纸篓（`shell.trashItem`） |
| 在 Finder 中显示 | 行右键 / 预览头部按钮 |
| 在终端中打开 | 目录右键；会打开一个新的终端标签（`harness:open-terminal-at`） |
| 复制路径 / 相对路径 | 行右键 |
| 预览操作 | 预览头部：渲染/源码切换、刷新、Finder 显示、复制相对路径、关闭；切回标签时自动重读文件 |

## 2. Markdown / HTML 渲染

- Markdown：`marked` 解析 → `DOMPurify.sanitize`（禁用 script / iframe / form 等）→ 渲染；标题自动补 id，README 的 `#目录` 锚点可以平滑滚动。
- HTML：用 `<webview partition="preview" sandbox=yes>` 加载 `file://` 地址，相对图片 / CSS 可正常解析；脚本在独立进程里跑，拿不到 `window.harness`。
- 源码模式：原始文本直接展示（等宽），方便对照 agent 改了哪里。
- 刷新 / 切回标签会重新读文件；HTML 会重新加载 webview。

## 3. 右键菜单

- **文件**：预览、在终端打开所在目录、Finder 显示、复制路径、复制相对路径、重命名、复制副本、删除
- **目录**：新建文件、新建文件夹、在终端中打开、Finder 显示、复制路径、复制相对路径、重命名、复制副本、删除；已展开时额外有「折叠此目录」
- **空白处**：新建文件、新建文件夹、刷新、全部折叠、显示/隐藏点文件

菜单是 `position: fixed`，贴边会自动向内收；滚动 / 点击外部 / Esc / 窗口失焦都会关闭。

## 4. IPC / preload

| 通道 | 说明 |
|---|---|
| `files:list` / `files:read` | 已有：列目录、读文本/图片 |
| `files:create` | `{ rel, kind, name }`；kind=`file`/`folder`；同名报错 |
| `files:rename` | `{ rel, name }`；禁止重命名项目根目录 / 覆盖同名 |
| `files:duplicate` | `{ rel }`；目录递归复制，文件 `copyFileSync` |
| `files:trash` | `{ rel }`；`shell.trashItem`（可恢复） |
| `files:reveal` | `{ rel }`；`shell.showItemInFolder` |

`preload.cjs` 对应暴露 `filesCreate / filesRename / filesDuplicate / filesTrash / filesReveal`；`src/global.d.ts` 有类型。

**安全边界**：所有 rel 都经 `filesInside(base, rel)` 校验，必须落在当前项目/worktree 根目录内；根目录本身不允许 rename/duplicate/trash。名称拒绝 `.`、`..` 和路径分隔符。

## 5. 与 ORCA 的差距

| ORCA 能力 | 现状 |
|---|---|
| 多选 / 框选 / 批量操作 | 未做（单行操作） |
| 拖拽移动、拖入上传 | 未做 |
| 虚拟滚动（超大目录） | 未做；当前按已加载目录渲染 |
| Git ignored 文件开关 / git 状态色 | 未做（仅隐藏点文件） |
| 在浏览器中打开 HTML / 下载远端文件 | 未做（远端执行整块未落地） |
| 行内“新建/重命名”输入框 | 已做 |
| 右键菜单 / 背景菜单 | 已做 |
| Finder 显示 / 复制路径 / 终端打开 | 已做 |
