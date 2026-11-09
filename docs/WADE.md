# WADE 开发环境

> 从 `spin-yieldmind-app` 迁移到 Cockpit Harness。WADE 是 AI-agent-driven git
> workflow CLI：plan → worktree → implementation → review → sync → done → PR。

## 迁移内容

| 项 | YieldMind 原配置 | Cockpit Harness |
|---|---|---|
| 主分支 | `main` | `main` |
| worktree 目录 | `../.worktrees` | `../.worktrees`（`GitWorksapce/.worktrees/spin-cockpit-harness`） |
| 分支前缀 | `feat` | `feat` |
| GitHub label | `feature-plan` | `feature-plan`（已创建） |
| AI tool | `opencode` | `opencode` |
| 模型 | `anthropic/claude-*` | **`deepseek/deepseek-*`** |

## 为什么换模型

YieldMind 原配置使用：

```yaml
model: anthropic/claude-sonnet-4.6
```

但本机 `opencode auth list` 没有 Anthropic 凭据，只有 DeepSeek / Alibaba /
Zhipu / volcengine。WADE 启动 plan / implementation 时会直接 **run failed**。
迁移后改成当前已认证的：

```yaml
easy:          deepseek/deepseek-flash
medium:        deepseek/deepseek-v4-pro
complex:       deepseek/deepseek-v4-pro
very_complex:  deepseek/deepseek-v4-pro
```

这些模型已通过 `opencode models` 和实际 `opencode run` 验证。

## 常用命令

```bash
# 预检：配置 / 模型认证 / GitHub label / git 身份
npm run verify:wade

wade check-config
wade plan                  # 规划
wade implement <issue>     # 在独立 worktree 实现
wade implementation-session check
wade review implementation
wade implementation-session sync --json
wade implementation-session done
wade worktree list
```

## 提交 / 推送失败时

WADE worktree 里有自己的 `pre-push` hook：只有 `wade implementation-session done`
写下的 `.wade/done@<sha>` 才允许推送。直接在 WADE worktree 里 `git push`
会被拒绝，看起来像“提交 git 的 run failed”。

正确顺序：

1. `git commit`（Conventional Commits）
2. `wade implementation-session sync --json`
3. `wade implementation-session done`
4. 由 `done` 负责 push / 更新 PR

如果仍然失败，按顺序检查：

```bash
npm run verify:wade          # 模型 / label / git 身份
opencode auth list           # 模型凭据
git config user.name
git config user.email
git status --short           # 是否有未提交改动
ls .wade/done@*              # 当前 HEAD 是否有 completion marker
```

不要在 WADE worktree 里用 `git push --no-verify` 绕过门禁；那会跳过完成标记，
PR 状态和 review 回执都会不一致。

## 与 Cockpit Harness 自身 Git 面板的关系

- 普通项目 / 普通 worktree：直接使用 Cockpit Harness 的 Git 面板提交、推送。
- WADE worktree：提交可以走 Harness Git 面板，但 **push 必须走 `wade implementation-session done`**，否则 pre-push 门禁会拒绝。
