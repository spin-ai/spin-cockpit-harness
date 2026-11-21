> 层：架构 · 状态：已落地 · 核对：2026-11-14 · 覆盖：资源管理器与文件操作 IPC

# 资源管理器（File Explorer）

> 参考：同类产品资源管理器的行右键菜单、背景菜单、新建/重命名、Finder 显示、复制路径、终端打开、自动刷新。
> 本文记录右侧栏资源管理器已落地的能力、文件操作 IPC 与安全边界。

---

## 1. 能力

| 能力 | 交互 |
|---|---|
| 展开 / 折叠 | 点击目录行、`→` / `←`、全部折叠 |
| 打开预览 | 点击文件 / 右键「预览」；在**终端区**作为标签打开（不再挤在 280px 右侧栏），新建文件后自动打开 |
| Markdown / HTML | 默认「渲染」，可切「源码」；Markdown 用 `marked` + DOMPurify（支持标题锚点跳转），HTML 在 sandboxed `<webview>` 里用 `file://` 渲染（相对资源可解析）；HTML 渲染支持**拾取元素**注入 Chat（与网页预览同一套 `previewPick`） |
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
| 格式支持 | HTML / Markdown / 图片 / 音视频 / PDF / 文本；二进制与超大文件给原因而不是乱码，见 2.5 |

## 2. Markdown / HTML 渲染

- Markdown：`marked` 解析 → `DOMPurify.sanitize`（禁用 script / iframe / form 等）→ 渲染；标题自动补 id，README 的 `#目录` 锚点可以平滑滚动。
- HTML：用 `<webview partition="preview" sandbox=yes>` 加载 `file://` 地址，相对图片 / CSS 可正常解析；脚本在独立进程里跑，拿不到 `window.harness`。
- **同一个 HTML 标签只保留一个 webContents**：切标签、切「源码/渲染」都不会重建/重新加载；刷新按钮原地 `webview.reload()`，只有换文件或换根目录才重置。文件读取也保留旧内容，避免切换时闪空白。
- **HTML 渲染 = 网页预览同一套能力**：webview 就绪后可以直接「拾取元素」，走 `previewPick(webContentsId, root)`，和 dev server 预览共用 CDP inspect / 源码映射 / 截图，拾取结果直接进 Chat composer。
- 源码模式：原始文本直接展示（等宽），方便对照 agent 改了哪里。
- 刷新 / 切回标签会重新读文件；HTML 会重新加载 webview。

## 2.5 格式矩阵（谁能预览、怎么预览）

类型口径只有一份：`electron/file-kinds.mjs`（`IMAGE_EXT` / `VIDEO_EXT` / `AUDIO_EXT` / `PREVIEW_NATIVE_EXT`），渲染层的对应清单位于 `src/components/FileVisual.tsx`，两边由 `npm run verify:preview-format` 校验一致。

| 格式 | 预览方式 | 说明 |
|---|---|---|
| `.html` `.htm` | webview `file://` → 渲染 / 可视化 / 源码 | 可拾取元素 |
| `.md` `.markdown` | `marked` + DOMPurify → 富文本 / 源码 / 目录 | 可编辑并写回 |
| 图片 `.png/.jpg/.jpeg/.webp/.gif/.svg/.ico/.bmp/.avif/.tif/.tiff` | webview 原生渲染 | 不读正文，不再受 2MB 文本上限影响 |
| 音视频 `.mp4/.m4v/.webm/.ogv/.mov` · `.mp3/.wav/.m4a/.aac/.ogg/.oga/.flac` | webview 原生播放器 | Chromium 能解的容器；mkv / avi 走系统播放器 |
| `.pdf` | webview + Chromium 内置 PDF 阅读器 | Electron webview 默认 `navigator.pdfViewerEnabled === true`，不需要放开 `plugins` |
| `.docx` | `files:previewDoc` → mammoth → HTML | 渲染层再过一次 DOMPurify；图片按 data URI 内嵌 |
| `.xlsx/.xlsm/.xls/.ods` | `files:previewDoc` → SheetJS → 表格 | 自建表格（不用 `sheet_to_html`）：最多 12 sheet × 400 行 × 60 列，超出标「已截断」 |
| `.pptx/.pptm/.doc/.odt/.odp/.odg/.rtf/.epub` | 装了 LibreOffice：`soffice --convert-to pdf` → 内置 PDF 阅读器（**版式还原**，按 `路径+mtime+size` 缓存到 `userData/doc-preview/`）；没装：officeparser 抽文本 | 转换失败自动回落文字，不报错卡住 |
| 普通文本 / 代码 / `.csv` / `.log` | `<pre>` 等宽展示 | 严格 UTF-8 → BOM UTF-16 → GB18030 兜底；非 UTF-8 会在顶部提示「按 GB18030 解码（保存会写成 UTF-8）」 |
| 二进制（`.docx/.xlsx/.zip/.woff/.db/.wasm` …） | 不给内容，只给原因 | NUL 字节 / 控制字符占比判定；提示用「在 Finder 中显示」交给系统应用 |
| >2MB 的文本 | 不预览，提示原因 | 避免一次把 2MB 塞进 DOM |

`files:read` 的返回：`{ text, encoding?, size, ext }`、`{ native: true, size, ext }`、`{ binary: true, size, ext, encoding }`、`{ error, size, ext }`。
**改了什么**：以前所有非图片文件都按 `utf8` 读，GBK / UTF-16 是乱码、docx / zip 把二进制塞进 `<pre>`、`.ico`/`.bmp` 图标显示成图片但预览是乱码、超过 2MB 的图片先被判「太大」、文件名带 `#`/`?` 时 `file://` 被截断（`encodeURI` 不转义）。

## 3. 右键菜单

- **文件**：预览、在终端打开所在目录、Finder 显示、复制路径、复制相对路径、重命名、复制副本、删除
- **目录**：新建文件、新建文件夹、在终端中打开、Finder 显示、复制路径、复制相对路径、重命名、复制副本、删除；已展开时额外有「折叠此目录」
- **空白处**：新建文件、新建文件夹、刷新、全部折叠、显示/隐藏点文件

菜单是 `position: fixed`，贴边会自动向内收；滚动 / 点击外部 / Esc / 窗口失焦都会关闭。

## 4. IPC / preload

| 通道 | 说明 |
|---|---|
| `files:list` / `files:read` | 列目录；读文件并分类（文本 / 原生渲染 / 二进制 / 过大），见 2.5 |
| `files:previewDoc` | `{ rel, root }` → `{ html, kind, truncated }` 或 `{ error }`；docx / xlsx / pptx…（≤30MB） |
| `files:create` | `{ rel, kind, name }`；kind=`file`/`folder`；同名报错 |
| `files:rename` | `{ rel, name }`；禁止重命名项目根目录 / 覆盖同名 |
| `files:duplicate` | `{ rel }`；目录递归复制，文件 `copyFileSync` |
| `files:trash` | `{ rel }`；`shell.trashItem`（可恢复） |
| `files:reveal` | `{ rel }`；`shell.showItemInFolder` |

`preload.cjs` 对应暴露 `filesCreate / filesRename / filesDuplicate / filesTrash / filesReveal`；`src/global.d.ts` 有类型。

**安全边界**：所有 rel 都经 `filesInside(base, rel)` 校验，必须落在当前项目/worktree 根目录内；根目录本身不允许 rename/duplicate/trash。名称拒绝 `.`、`..` 和路径分隔符。

## 5. 与参考实现的差距

| 参考能力 | 现状 |
|---|---|
| 多选 / 框选 / 批量操作 | 未做（单行操作） |
| 拖拽移动、拖入上传 | 未做 |
| 虚拟滚动（超大目录） | 未做；当前按已加载目录渲染 |
| Git ignored 文件开关 / git 状态色 | 未做（仅隐藏点文件） |
| 在浏览器中打开 HTML / 下载远端文件 | 未做（远端执行整块未落地） |
| 行内“新建/重命名”输入框 | 已做 |
| 右键菜单 / 背景菜单 | 已做 |
| Finder 显示 / 复制路径 / 终端打开 | 已做 |
