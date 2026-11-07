# Git / Source Control

> 参考常见 Source Control 的分支上下文行、文件暂存、提交框、Diff 查看、一键 Push/Pull。
> 本项目只做「本地仓库的日常操作」，不做 PR/评审托管、不做 AI 生成提交信息（后续可接）。

---

## 1. 入口与形态

导航栏「Git」→ 一个整页视图（`.wide`）：

```
Git                                    main → origin/main · ↑2 ↓0
[分支 ▾] [＋ 分支] [刷新] [拉取 ↓] [推送 ↑]
┌──────────── 左：工作区 ────────────┐ ┌──────── 右：Diff ────────┐
│ 暂存的改动 3        全部暂存        │ │ src/app.tsx      +12 -3  │
│  M src/app.tsx                     │ │ @@ -1,4 +1,6 @@          │
│ 变更 2                             │ │ - old                    │
│  ? new.ts             暂存 丢弃     │ │ + new                    │
│ 提交                               │ │                          │
│ [textarea ⌘Enter 提交] [Amend]      │ │                          │
│ 最近提交 20                        │ │                          │
└────────────────────────────────────┘ └──────────────────────────┘
```

## 2. 后端（`electron/main.mjs` 的 `git:*`）

全部在**当前项目根目录**跑 `git` CLI（`rootOf(root)`），带 `GIT_TERMINAL_PROMPT=0`（不会卡在密码提示）。

| IPC | 命令 | 说明 |
|---|---|---|
| `git:status` | `rev-parse --is-inside-work-tree` + `status --porcelain=v1 -z --untracked-files=all` + `status --porcelain=v2 --branch` + `rev-list --left-right --count @{u}...HEAD` | 分支 / 上游 / ahead-behind / 文件（staged、untracked、conflict） |
| `git:diff` | `diff [--cached] -- <path>`；未跟踪文件用 `diff --no-index /dev/null <path>` | 返回 unified diff 文本 |
| `git:stage` / `git:unstage` | `add --` / `restore --staged --`（无 HEAD 时回退 `rm --cached`） | 暂存 / 取消暂存 |
| `git:discard` | `restore --worktree --` + `clean -f --`（未跟踪） | 丢弃改动（UI 二次确认） |
| `git:commit` | `commit -m …`（`--amend` 单独按钮） | 走仓库 hooks；失败原样返回输出 |
| `git:push` / `git:pull` | `push`（无上游时 `-u origin HEAD`）/ `pull --ff-only` | 不做 force push |
| `git:branches` / `git:checkout` | `branch --format=…` / `checkout [-b] <name>` | 切换 / 新建分支 |
| `git:log` | `log -20 --pretty=%h\x1f%s\x1f%an\x1f%ar` | 最近提交 |
| `git:init` | `init` | 非仓库时的引导 |

## 2.5 右侧栏迷你面板

右侧栏（资源管理器 / 会话历史 旁边）新增 **Git** 标签（`src/components/GitPanel.tsx`）：

- 分支 + ↑↓ + 刷新 + 「全屏」（`harness:open-git` 事件 → 切到 Git 视图）
- 可折叠的「暂存的改动 / 变更」，每行 `＋` 暂存 / `－` 取消暂存，「全部暂存」
- 提交框（`⌘Enter` 提交）+ 拉取 / 推送 / 提交按钮
- 不做 diff：点「全屏」看完整 diff 与最近提交

窗口重新获得焦点时自动刷新状态（用别的工具改完文件回来就能看到）。

## 2.6 资源管理器的 git 装饰

`src/components/FilePanel.tsx` 会拉一次 `git:status`（含 `ignored`），给文件树着色：

| 状态 | 样式 |
|---|---|
| 已修改 | 文件名琥珀色，右侧 `M` 徽标 |
| 新增 / 未跟踪 | 绿色 + `U` |
| 已暂存 | 蓝色 + 索引区状态字母 |
| 已删除 | 红色 + 删除线 |
| **被 .gitignore 忽略** | **整体 50% 透明、文件名斜体**（文件与目录都标；目录用 `ls-files --others --ignored --directory` 拿到的 `dir/` 前缀匹配） |
| 目录下有改动 | 目录行显示一个小状态点（`•`，颜色取第一个改动文件的状态） |

刷新时机：进入/切换项目、窗口重新获得焦点、以及资源管理器可见时每 12s 轮询一次（没有 FS watcher，用轻量轮询兜住外部编辑器的改动）。

## 3. 交互要点

- 点文件看 diff（暂存区优先；未跟踪文件与 `/dev/null` 比），头部显示 `+N -M`
- 每个文件 hover 出现「暂存 / 取消暂存 / 丢弃」；「全部暂存」一次加完
- 提交框 `⌘Enter` 提交；有 hooks 失败时把输出贴在页面顶部
- 分支下拉切换；「＋ 分支」基于当前 HEAD 新建；有改动时先确认
- 非 Git 仓库：给一个「初始化仓库」按钮

## 4. 明确不做（当前）

| 不做 | 原因 |
|---|---|
| PR / 评审托管（GitHub/Linear/Jira） | 需要 OAuth 与网络策略，先本地化 |
| Force push | 风险高，参考实现也做成显式动作；需要时手动在终端做 |
| 冲突三方合并 UI | 冲突文件会标「冲」，解决仍在编辑器/终端 |
| AI 生成提交信息 | 依赖模型密钥与模板，后续接 Action recipe |
| Diff 行内批注 / 归因 | 参考实现的差异化能力，工作量另算 |

## 5. 验证

`scripts/e2e-git.mjs`（自建 `/tmp/git-fixture` 仓库，CDP 驱动真实窗口）：

```
PASS Git 视图：分支 + 变更文件列表
PASS Diff 渲染（增删行 + 统计 +2 -1）
PASS UI 暂存文件
PASS UI 提交成功（写进仓库，git log 可见）
PASS 提交后工作区只剩未暂存的 a.txt
PASS 新建并切换分支（git rev-parse 确认 feature/x）
PASS 右侧栏 Git 标签存在（会话旁边）+ 显示状态
PASS 迷你面板可暂存 / 提交（git log 可见）
PASS 「全屏」跳到 Git 页
PASS 资源管理器：ignore 的文件淡色斜体 / ignore 目录也淡色
```

## 2.7 项目 Wiki（Git 视图第二个 tab）

Git 页顶部新增 tab：

```text
[源码管理] [项目 Wiki]
```

项目 Wiki 是**随仓库版本发布的内置文档**，不是用户项目的 wiki：

- 内容源：`resources/wiki/*.md` + 根目录 `CHANGELOG.md`，由 Vite `?raw` 在构建时打进 renderer；
- 页面：项目介绍 / 工作流 / 架构 / Agent 与执行适配器 / 终端与预览 / 主题系统 / 插件与 LLM Wiki / 构建与发布 / 版本记录；
- 左侧：分组导航 + 全文搜索（`⌘F` 聚焦，`Esc` 清空）；
- 中间：Markdown 渲染（marked + DOMPurify）、页间链接 `#/wiki/<id>`、上一篇/下一篇；
- 右侧：本页目录（H2–H4），点击平滑滚动；
- 页头显示当前 Git 分支与 HEAD（在 Git 仓库中时）；
- 图片放在 `public/wiki/`，Markdown 用 `./wiki/<file>` 引用；构建时由 Vite 复制到 `dist/wiki/`，打包后从 `app.asar/dist/wiki/` 读取
- 无 Git 仓库也可查看；源码管理 tab 仍保留 `git init` 引导。

新增页面：在 `resources/wiki/` 放 Markdown，然后在 `src/wiki/pages.ts` 登记 id / 标题 / 分组 / 摘要即可。页内链接统一写成 `[标题](#/wiki/<id>)`。

### 发布到 GitHub Wiki

App 内 Wiki 不会自动出现在 GitHub Wiki（后者是独立的 `.wiki.git` 仓库）。需要时执行：

```sh
npm run wiki:publish
```

前置：GitHub 仓库已启用 Wiki，并且已经手动创建过一次首页（这样 `.wiki.git` 才存在）。

脚本会：

1. clone/pull `<repo>.wiki.git`；
2. 用 `resources/wiki/*.md` + `CHANGELOG.md` 覆盖 `Home / Workflow / Architecture / Agents / Terminal / Themes / Plugins / Build / Changelog`；
3. 把 `#/wiki/<id>` 改写成 GitHub Wiki 页面链接；
4. 把 `./wiki/*.png` 改写成主仓库 raw 图片地址；
5. 生成 `_Sidebar.md` / `_Footer.md`；
6. commit + push。

保留 Wiki 仓库里其他手写页面；只覆盖上面这些文件名。可用 `WIKI_REMOTE` / `WIKI_RAW_BASE` 覆盖默认地址。
