# 需求落地清单（GAP）

> 基于 `REQ-modules-original.md` 的第一轮确认，只列**当前代码还需要改什么**。  
> P0 = 阻塞主流程；P1 = 体验/效率；P2 = 后续。已实现项不重复列。

---

## 1. 场景工作台

- [ ] **P0 新增 Scene 数据模型**  
  每个项目一份场景配置：runtime、Agent、command、worktree、并发、验收、notes。  
  位置：`electron/db.mjs`、`electron/main.mjs`、`src/types.ts`

- [ ] **P0 场景页面与导航**  
  一页管理所有项目、项目内终端、场景配置和进展；左侧加「场景」入口。  
  位置：`src/App.tsx`、`src/components/Rail.tsx`、新增 `src/components/ScenePage.tsx`

- [ ] **P0 文字配置 + 校验 + AI 配置**  
  结构化文本（YAML/JSON）可保存、保存前校验；支持让 AI 生成/修改配置。  
  位置：`electron/main.mjs`（scene.validate/save/ai）、场景页

- [ ] **P0 Chat 分配预览**  
  Chat 聊完 → Draft → 显示推荐的项目 / Scene / Agent / runtime + 理由 → 人确认后才创建任务和 run。  
  位置：`electron/main.mjs`（send/allocator）、`src/components/TaskChat.tsx`

- [ ] **P0 全局进展**  
  Chat 支持「当前会话 / 当前项目 / 所有项目」；TODO 聚合所有项目和终端，不再只看当前项目。  
  位置：`src/App.tsx`、`src/components/TaskChat.tsx`、`src/components/TaskPane.tsx`

- [ ] **P1 场景页进展区**  
  场景页显示每个项目的运行中、排队、待确认、终端和最近失败。  
  位置：场景页、`electron/main.mjs` snapshot

---

## 2. TODO / 任务

- [ ] **P0 改为 4 组**  
  待执行 / 进行中 / 待确认 / 已完成；排队、运行中、等待输入降级为「进行中」badge，等待输入置顶高亮。  
  位置：`src/components/TaskPane.tsx` `GROUPS`

- [ ] **P0 「待处理」筛选**  
  待确认 / 失败 / 等待输入，按任务去重；替代独立收件箱。  
  位置：`src/components/TaskPane.tsx`、`src/components/TaskChat.tsx`

- [ ] **P0 普通 TODO 多 Agent**  
  一个 TODO 可挂多个 Agent，每个 Agent 独立 run / worktree / 终端；同一 worktree 禁止并发写。  
  位置：`electron/main.mjs`（send/queueRun/tick/broadcast）、`TaskChat.tsx`、`TaskPane.tsx`

- [ ] **P1 确认可撤销**  
  增加 unconfirm；确认后可从「已完成」退回待确认。  
  位置：`electron/main.mjs` confirm/unconfirm、`TaskPane.tsx`

- [ ] **P1 横向看板**  
  在 4 组列表之外提供横向看板视图，和列表共用同一份数据。  
  位置：`src/components/TaskPane.tsx` 或新增看板组件

---

## 3. Terminal / Worktree

- [ ] **P0 终端元数据持久化**  
  新增 `terminals`：project、task、run、agent、cwd、kind(shell|agent)、status、exitCode、时间。  
  位置：`electron/db.mjs`、`electron/main.mjs`、`src/components/TerminalPanel.tsx`

- [ ] **P0 终端优先启动 Agent**  
  终端工具栏加「＋ Agent」（dsh → ACP，pi/claude/codex/opencode → 终端），生成可管理终端记录；手动输入 CLI 不自动识别。  
  位置：`TerminalPanel.tsx`、`electron/main.mjs`

- [ ] **P0 未绑定 Agent 进入进展**  
  先开终端起 Agent、不绑任务也算进展；TODO / Chat 显示运行时长、最近输出、退出码。  
  位置：`TerminalPanel.tsx`、`TaskPane.tsx`、`TaskChat.tsx`、`electron/main.mjs` snapshot

- [ ] **P0 终端接入任务**  
  终端「接入任务」：cwd 是任务 worktree 则直接绑定；cwd 是项目根则绑定为 `worktree=project`；要隔离就新开 worktree 终端/新 Agent 再绑定。  
  位置：`electron/main.mjs`（bindTerminal）、`TerminalPanel.tsx`、`TaskPane.tsx`

- [ ] **P0 worktree 可见性与策略**  
  任务/终端显示分支和路径，可打开/清理；场景/项目支持 `worktree: auto | always | never`。  
  位置：`electron/worktree.mjs`、`electron/main.mjs`、`TaskPane.tsx`、`TerminalPanel.tsx`

- [ ] **P0 终端 Agent 不能误走 ACP**  
  Mission child / retry / broadcast 等 `queueRun` 路径必须先判断 runtime，terminal Agent 走 pty，不能启动 `--profile acp`。  
  位置：`electron/main.mjs`（queueRun/tick/startRun/task_delegate）

- [ ] **P1 Mission 支持 terminal child**  
  Mission child 按 Scene 选 ACP / terminal；terminal child 一个终端标签，结果按 contract 回写 delegation。  
  位置：`electron/main.mjs`、`TerminalPanel.tsx`

---

## 4. Chat

- [ ] **P0 多 Agent 纠偏目标**  
  一个 TODO 有多个 Agent 时，Chat 发送纠偏要能选择目标 Agent / run / 终端，不能只取第一个 active run。  
  位置：`electron/main.mjs` send/deliverSteer/activeRunOf、`TaskChat.tsx`

- [ ] **P1 全局进展 dock**  
  Chat 可收起 dock：运行中 / 排队 / 等待输入 / 待确认 / 失败，支持停止、重试、打开终端。  
  位置：`TaskChat.tsx`、`App.tsx`

- [ ] **P1 纯聊天会话**  
  不绑任务的常驻 ACP 会话，可从聊天转成 TODO。  
  位置：`electron/main.mjs`、`TaskChat.tsx`

---

## 5. 预览 / UI 上下文

- [ ] **P0 浏览器操作**  
  前进 / 后退、刷新 / 硬刷新 / 停止、缩放、页内查找、DevTools、外部打开。  
  位置：`src/components/PreviewSurface.tsx`、`TerminalPanel.tsx`、`electron/preview.mjs`

- [ ] **P0 设备宽度预设**  
  自适应 / 平板 / 手机三档，先不要求完整 CDP 设备模拟。  
  位置：`PreviewSurface.tsx`

- [ ] **P1 多个预览页**  
  默认复用同 URL，显式新建；最多 2–3 个，后台挂起 webview，标签显示端口 / worktree。  
  位置：`TerminalPanel.tsx`（当前 `openPreview` 只复用单个预览）

---

## 6. LLM Wiki / Notes

- [ ] **P0 自动保存 + 删除可恢复**  
  停笔约 1s 自动保存、未保存点、失败提示；页面 / 资料 / 文件删除进回收站，可撤销/还原。  
  位置：`src/components/Notes.tsx`、`NotesEditor.tsx`、`plugins/notes/main.mjs`

- [ ] **P0 快速记录**  
  全局热键快捕（不切主窗口）、剪贴板/选中文本预填、`#标签` 真实候选、收藏/置顶/最近打开；统一「笔记 / Wiki」叫法。  
  位置：`src/App.tsx`、`Notes.tsx`、`NotesEditor.tsx`、`plugins/notes/main.mjs`

- [ ] **P0 中文搜索**  
  按字切分、模糊匹配、标题加权、命中高亮与定位、按状态/时间/来源筛选、搜索历史。  
  位置：`plugins/notes/main.mjs`、`Notes.tsx`

- [ ] **P0 问我的 Wiki**  
  基于本地页面/资料回答，每段带页面引用；无依据明确说没有；答案可存为 draft。  
  位置：`plugins/notes/main.mjs`、`Notes.tsx`（新增模型调用，非模板）

- [ ] **P1 双链体验**  
  hover 预览、红链创建、反链上下文、unlinked mentions、图谱节点跳转/按类型过滤。  
  位置：`Notes.tsx`、`plugins/notes/main.mjs`

- [ ] **P1 迁移与规模**  
  本地目录整批导入（去掉 30 上限）、导出 Markdown/PDF、1000 页面下列表和搜索 <200ms。  
  位置：`plugins/notes/main.mjs`、`Notes.tsx`

---

## 7. Agent / 主机 / Runtime

- [ ] **P1 Runtime 派生视图**  
  先输出 `hostId + cli + caps + mode + available` 的 runtimes 视图，Agent 仍存 hostId + cli；暂不建表。  
  位置：`electron/main.mjs` snapshot、`src/types.ts`、`Settings.tsx`

- [ ] **P1 更多 Chat 执行适配器**  
  按需补 pi/claude/codex/opencode 的 ACP 适配器；当前它们走终端 pty。  
  位置：`electron/main.mjs` EXECUTORS、执行层

---

## 8. 收件箱 / 统计

- [ ] **P0 移除独立收件箱**  
  删导航和页面；待确认/失败/等待输入进入 TODO「待处理」+ Chat 进展；处理完自动消失。  
  位置：`src/components/Rail.tsx`、`Views.tsx`、`App.tsx`、`Settings.tsx`、`electron/main.mjs`

- [ ] **P1 统计按场景/终端拆分**  
  统计增加 Scene / runtime 维度；费用估算按需。  
  位置：`Views.tsx`、`electron/main.mjs`

---

## 9. 数据 / 设置 / 打包

- [ ] **P0 数据迁移**  
  新增 `scenes`、`terminals`，扩展 `todos/runs`（sceneId、runtime、result 等），保持幂等和备份。  
  位置：`electron/db.mjs`

- [ ] **P1 设置补充**  
  场景入口、worktree 策略、项目级覆盖；设置搜索同步新项。  
  位置：`Settings.tsx`、`electron/main.mjs`

---

## 建议顺序

1. Scene 数据 + 场景页 + 全局进展（第 1 节）
2. 终端元数据 + 终端优先 Agent + 接入任务（第 3 节）
3. TODO 4 组 + 多 Agent + 待处理（第 2 节）
4. 移除收件箱（第 8 节）
5. 预览操作 + 多预览页（第 5 节）
6. LLM Wiki P0（第 6 节）
7. Runtime / Mission terminal / 统计（P1）
