# Chat UI（会话界面）

> 参考：Multica Chat（`docs/multica-main`，`docs/assets/cmp/mul-chat*.webp`）、ORCA Native Chat 的排版/颜色规范（`docs/orca-main/docs/styleguide/native-chat.md`）、ORCA 终端右键菜单与卡片式 composer 的交互。
> 本文记录 harness Chat 的视觉结构与取舍；会话数据模型见 [`ARCH-chat-thread.md`](ARCH-chat-thread.md)。

---

## 1. 参考产品里值得抄的部分

| 参考 | 关键点 | 我们的取舍 |
|---|---|---|
| Multica Chat | **扁平 transcript**：agent 消息就是正文，不用气泡包起来；用户消息是一条右对齐的浅色块 | 采用。去掉每行边框/卡片，agent 正文 13px/1.68，用户消息右对齐 tint 气泡 |
| Multica Chat | **步骤折叠**：连续的工具调用收成「N steps」，默认折叠，点开看细节 | 采用。连续 `tool` / `thought` 合并成 `tool-group`，默认 ≤2 步展开、>2 步折叠 |
| Multica Chat | **composer 卡片**：一个大圆角输入卡，底部放 agent / 附件 / 发送；发送是紧凑按钮 | 采用。agent/project/工具收进 composer footer，发送按钮显示动作（派活/纠偏/发送） |
| ORCA native-chat styleguide | 固定字号阶梯（14 / 12 / 11 / 10 / code 12），二级文字用 faint；行 hover 用低对比背景；focus ring 用 inset | 采用 CSS 变量：正文跟随 `--chat-font-size`，meta 10.5px，工具行 10px，hover 用 `--surface-hover` |
| ORCA native-chat | transcript 行不包卡片，状态/动作行弱化；工具输出是代码字体 | 采用。工具行 `mono` 单行摘要 + 展开原文 |

## 2. 结构

```
.chat-pane
├─ .pane-head                       CHAT · ＋新任务 · 收起
├─ .thread-bar                      标题行（状态点 / key / 标题 / 状态 pill）
│                                   元信息行（项目 / Agent / 运行时长 / 停止）
├─ .chat-body-wrap
│  ├─ .chat-scroll
│  │  ├─ .run-divider               run 边界（有 runId 时）
│  │  ├─ .msg.user / .msg.agent     扁平消息 + 头像 + meta
│  │  ├─ .msg.is-system             居中系统行
│  │  ├─ .tool-group                连续工具/思考的折叠组
│  │  └─ .chat-typing               运行中且停留在底部时的三点动画
│  └─ .chat-jump                    回到底部 / N 条新消息
└─ .composer-shell
   ├─ .mention-pop                  @ 选择器（在输入卡内）
   ├─ .composer-ctx                 预览元素 chip
   ├─ .composer-warn                Agent 仅终端可用 / 主机离线
   ├─ textarea
   └─ .composer-foot
      ├─ .composer-chips            @Agent / ◎作用域（全局或项目）
      └─ .composer-actions          工具开关 · Enter 提示 · 发送
```

## 3. 关键细节

### 3.1 用户消息

- 右对齐、最大宽度 88%（窄面板 92%），背景 `--brand-soft`、边框 `--brand-line`、圆角 11px。
- meta 显示「你 · 3m」，复制按钮仅 agent 消息显示。
- 不显示头像，避免窄列里右侧再挤一个方块。

### 3.2 Agent 消息

- 左侧 22px 圆角头像（首字母），正文扁平、无边框；代码块/行内 code 沿用原有轻量 Markdown 渲染。
- meta：Agent 名 · 相对时间 · 投递回执（投递中 / 已注入 / 失败重发）· hover 复制。
- system 行居中、无边框。

### 3.3 工具步骤

- 连续 `role=tool` 或 `kind=thought` 的消息合并为一个组。
- 折叠头：`工具调用` + 数量 pill + 最后一步摘要；展开后每步：
  - 第一行（Read / Edit / Bash…）用等宽字体；
  - 多余行默认不渲染，点「展开」显示完整输出；
  - hover 显示复制。
- `设置 → 工具` 关闭时整组不渲染（和旧行为一致）。

### 3.4 作用域

- 未派活的会话默认 `projectId = null` → **全局对话**，在任意项目下都可见，切项目不会消失。
- composer footer 的 `◎ 全局 / 项目 · xxx` 决定下一次派活落在哪个项目；`全局` 时按所选 Agent 的 `projectId` 兜底，没有则用当前项目。
- 修改作用域只更新会话目标，不会切换整个工作区项目；任务一旦派活，作用域锁定（任务本身必须属于某个项目）。
- 旧版本的未派活会话在首次启动时一次性迁移为全局（`meta.chatScopeMigrated`），避免升级后 Chat 仍跟着项目走。

### 3.5 Composer

- 输入卡与 transcript 用 `--page-canvas` 分隔；卡片 `--surface` + 1px 边框，focus-within 变 brand 并加 2px 外圈。
- footer 左侧 `@ Agent` / `◎ 作用域` 两个紧凑 select（无边框，hover 才浮出背景），右侧「工具」开关 + 发送。
- 发送按钮按语义变色并显示动作：`派活` / `纠偏` / `发送并运行` / `发送` / `不可派活`（disabled）。
- 窄面板通过 **container query**（`.chat-pane` 为容器，≤360px）隐藏 Enter 提示、压缩 select、把发送行收到第二行，避免 287px 默认宽度下换行凌乱。
- 没有 Agent 时显示「未检测到 Agent · 用 dsh」一个按钮（创建 dsh Agent 并绑定当前会话），不再同时出现空 select 和 `＋dsh`。
- Chat 的旧入口（新建会话、@ 选择器、元素 chip、运行中停止、草稿按会话保存）保持不变。

## 4. 验证

- `npx tsc --noEmit` / `npm run build`
- 实机（Electron + CDP）：
  - 长 transcript 滚动时消息不被 flex 压扁（`.chat-scroll > *{flex:none}`）；
  - 连续 4 个工具消息折叠成 1 行，展开后 4 行、高度 31 → 130；
  - 用户气泡、system 行无遗留边框（旧 `.msg.system` 虚线已覆盖）；
  - composer 在 287px 宽下 footer 收成两行，发送按钮不再被 `.chat` 全局样式拉满；
  - 深浅色主题各截一张对照。

## 5. 明确未做

| 能力 | 说明 |
|---|---|
| 完整 Markdown（表格 / 任务列表 / 图片） | 仍是轻量渲染；表格类输出会以文本展示 |
| 附件 / 图片粘贴 / 拖拽上传 | 未做（与元素拾取是两条路径） |
| 消息虚拟化 | 长会话仍一次性渲染；消息特别多时需要 |
| 消息编辑 / 重新生成 / 分支 | 目前只有复制、失败重发、停止 |
| 会话内搜索 | 未做；先用 ⌘K 命令面板或 TODO 搜索 |
| 原生流式 token 逐字动画 | 消息按 run 落库，靠"正在处理"提示 |
