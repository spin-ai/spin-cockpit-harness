# 设计取舍与踩坑

> 记录项目为什么长成现在这样，以及哪些坑已经踩过。参考 `docs/ARTICLE-zhihu-multi-agent-terminal.md`。

## 顺序：先协议，再 UI

```text
数据模型 → 状态机 → 协议 → 最小 UI → 体验优化
```

UI 最容易产生“进度感”，也最容易返工。Chat 曾因 thread 模型重构几乎重写一遍，根因是先做了界面、后补消息宿主。

## 关键取舍

| 决策 | 为什么 |
|---|---|
| 不做 TUI | 要同时看任务、Chat、终端、文件和审批，TUI 的窗口管理成本高于收益 |
| 不做 IDE | 编辑体验交给现有 IDE；这里解决的是多 Agent 的调度、观察、纠偏和验收 |
| 用 ACP，不自定协议 | CLI 适配、流式事件、审批、取消已有协议；自定协议会绑定每个 CLI |
| 用 `sql.js` | 桌面单用户、单文件数据库、无原生编译负担；代价是整库持久化要控制频率 |
| 单一 `send` 入口 | 派活、纠偏、排队补充、仅记录都走同一状态机，避免每个能力写三遍 |
| 消息宿主是 thread | 任务只是 thread 的一种归属；否则没有任务就没有地方放消息 |
| 投递必须有回执 | `pending → injected / failed`，不在 ACP 返回前写“已注入” |
| 不静默回退 | 选了 `pi` 实际跑 dsh 是错误行为；不支持就明确报错 |
| 预览只读 + CDP guest | 调试器只挂 `webview` guest，不挂主窗口；页面拿不到 `window.harness` |
| 终端用二叉树拆分 | 拆分不重建 xterm；稳定 key + 绝对定位，选区 / PTY 不丢 |
| 能力设边界 | 预览只读 DOM、远端只收绝对路径、主管只读、worker 才写 |

![调度器](./wiki/scheduler.png)

*图：可观测不是统计页装饰，它是调度器的眼睛。*

## 踩坑清单

| # | 坑 | 处理 |
|---|---|---|
| 1 | Finder 启动的 Electron 没有登录 shell PATH | 显式补 `/opt/homebrew/bin`、`~/.local/bin` 等 |
| 2 | PTY 输出早于 xterm 挂载 | 主进程 buffer + attach 回放 |
| 3 | Electron 默认菜单抢快捷键 | 重写最小菜单，⌘W / ⌘+ / ⌘R / ⌘A 不吞终端 |
| 4 | xterm 自己处理 keydown | capture 监听 + `preventDefault`，避免执行两次 |
| 5 | 拆分时重建 xterm | 二叉布局树 + 稳定 key + 绝对定位 |
| 6 | `sql.js` 整库持久化 | 控制 `broadcast` / `persist` 频率 |
| 7 | 迁移不幂等 | `ALTER TABLE` 逐条 try/catch，重复执行不报错 |
| 8 | 把 ACP 审批当普通弹窗 | 按 optionId 回 `outcome.selected` |
| 9 | 纠偏无条件写 `injected: true` | 投递回执 + run 结束时结算 pending |
| 10 | 没上报 token 写 0 | `usageSource = unknown`，统计显示“未上报” |
| 11 | 不支持的 CLI 静默回退 dsh | 明确报错并标注「终端专用」 |
| 12 | 调试器挂到主窗口 | 只接受 `webview` guest |
| 13 | 预览切换重载 webContents | 同一标签保留一个 webContents |
| 14 | 带 command 的标签重启 | 重复创建 Agent 记录；只有纯 shell 可重启 |
| 15 | 重试新建 worktree | 文件预览跟随 run worktree，终端侧仍待补齐 |
| 16 | pty 以 120×32 启动但 xterm 实际尺寸不同 | 创建前 `fit()`，把真实 cols/rows 传给 pty；attach 后再对齐 |

## 明确不做 / 还没做

| 项 | 现状 |
|---|---|
| 任务与 Terminal 真正绑定 | 终端独立于 ACP run |
| 终端内 Agent 完成后由 harness 捕获 | 需要 shell 集成 / 主动回写协议 |
| 完成回写的强约束 | 当前以 ACP prompt 正常返回为完成 |
| 全局自由对话 | 不绑任务的常驻 ACP 会话 |
| Agent 主动提问 → 等待输入 | 目前只有 ACP 审批进入 `waiting_input` |
| 非 dsh 的 Chat 执行适配器 | 终端可用，Chat 不可 |
| 长会话虚拟化 / 回放 | 全量 state 广播 |
| 远端 worktree / 断线重连 | 远端直接用绝对 cwd |
| 签名 / 公证 / 自动更新 | 未做 |

> 一个项目的可信度，不取决于声称完成了多少，而取决于敢不敢列出没完成的。

## 如果重来

1. 先定数据模型和状态机，再做 Chat UI。
2. 先保证一个发送入口，再加能力。
3. 回执优先于乐观 UI。
4. 先做可观测（run 状态 / 耗时 / 排队原因 / 错误分类），再谈自动调度。
5. 迁移用真实旧库测试，桌面应用没有运维兜底。
6. 先让一个开发者每天用起来，再想多人协作。
