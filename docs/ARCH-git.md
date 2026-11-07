# Git / Source Control

> 参考 ORCA 的 Source Control（`docs/orca-main/docs/site/content/docs/review/commit-push.mdx`）：分支上下文行、文件暂存、提交框、Diff 查看、一键 Push/Pull。
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
| Force push | 风险高，ORCA 也做成显式动作；需要时手动在终端做 |
| 冲突三方合并 UI | 冲突文件会标「冲」，解决仍在编辑器/终端 |
| AI 生成提交信息 | 依赖模型密钥与模板，后续接 Action recipe |
| Diff 行内批注 / 归因 | ORCA 的差异化能力，工作量另算 |

## 5. 验证

`scripts/e2e-git.mjs`（自建 `/tmp/git-fixture` 仓库，CDP 驱动真实窗口）：

```
PASS Git 视图：分支 + 变更文件列表
PASS Diff 渲染（增删行 + 统计 +2 -1）
PASS UI 暂存文件
PASS UI 提交成功（写进仓库，git log 可见）
PASS 提交后工作区只剩未暂存的 a.txt
PASS 新建并切换分支（git rev-parse 确认 feature/x）
```
