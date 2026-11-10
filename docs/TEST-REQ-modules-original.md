# 测试用例 · 原始需求按模块

> 对应需求：[`REQ-modules-original.md`](REQ-modules-original.md)（User Story：`US-<Module>-<NN>`）
> 目标：把每条验收标准落成可执行、可回归的测试用例，并标出当前实现状态与待确认项。
> 本文的「预期」是验收目标，不代表当前版本已经满足；「现状」参考 `GAP-requirements.md` 与最近提交，执行前仍需按当前构建复核。
>
> **执行状态：未执行。** 等并行优化完成后，再按 P0 → P1 统一执行，并回填实际结果。

---

## 1. 范围与约定

### 1.1 范围

覆盖 `REQ-modules-original.md` 的 16 个模块、28 个 User Story：

| 模块 | User Story |
|---|---|
| 场景工作台 | ScenePlatform 01–06 |
| 项目 / 工作区 | ProjectWorkspace 01 |
| TODO / 任务 | TaskBoard 01 |
| Mission | Mission 01 |
| Chat | Chat 01 |
| Terminal | Terminal 01 |
| 预览 / UI 上下文 | PreviewContext 01 |
| 文件 / Git | FilesGit 01 |
| LLM Wiki / Notes | LLMWiki 01–07 |
| Agent / 主机 | AgentRuntime 01 |
| 设置 / 主题 | Settings 01 |
| 插件 | Plugins 01 |
| 统计 / 待处理 | Stats 01 |
| 布局 / 导航 | WorkspaceLayout 01 |
| 数据 / 安全 / 打包 | DataRelease 01 |
| Worktree | Worktree 01–02 |

不覆盖：多端同步 / 共享 / 多用户（需求明确不做）、签名与公证（当前不做）、竞品对比。

### 1.2 测试环境

- 隔离数据目录：`COCKPIT_USER_DATA=/tmp/cockpit-test-<date>`，不污染日常 `harness.db`
- 本地 dsh 已配置模型；另准备：
  - `dsh` → ACP
  - `pi` / `claude` / `codex` / `opencode` 中至少一个 → 终端 pty
- 一个本地 SSH 主机（可选，用于远端用例）
- 截图 / 录屏：失败用例保留 Chat、TODO、Terminal 三列同屏

### 1.3 测试数据

| 名称 | 内容 |
|---|---|
| 项目 A | git 仓库，有 `package.json`，可跑 dev server |
| 项目 B | git 仓库，干净分支 |
| 项目 C | 非 git 目录 |
| Agent-D | dsh / ACP |
| Agent-P | pi / 终端专用 |
| 任务 T1/T2 | 单 Agent 任务；T2 用于失败/取消 |
| Mission M1 | 2 个子任务，计划需审批 |
| Wiki S1/S2 | 两段资料，内容有重叠关键词 |
| Wiki P1/P2 | 一个 reviewed 页面、一个 draft 页面 |
| 性能库 | 1000 个 Markdown 页面（脚本生成） |

### 1.4 优先级与现状标记

- **P0**：主链路 / 数据安全，必须通过
- **P1**：重要增强，版本内应通过
- **P2**：体验项，可延后
- **✅** 已实现（按需求文档「当前」）
- **◐** 部分实现
- **❌** 未实现
- **❓** 需求待确认；先记录，不作为失败
- **🧪** 需在真机/真实 CLI 上实测

---

## 2. 追踪矩阵

| User Story | 用例 |
|---|---|
| US-ScenePlatform-01 | SC-01 ~ SC-03、SC-11 |
| US-ScenePlatform-02 | SC-05 ~ SC-07、CH-05 |
| US-ScenePlatform-03 | SC-08、TM-05 |
| US-ScenePlatform-04 | SC-09、SC-12、TK-08 |
| US-ScenePlatform-05 | SC-03、SC-04 |
| US-ScenePlatform-06 | SC-10、MS-01 ~ MS-06 |
| US-ProjectWorkspace-01 | PJ-01 ~ PJ-05 |
| US-TaskBoard-01 | TK-01 ~ TK-07 |
| US-Mission-01 | MS-01 ~ MS-06 |
| US-Chat-01 | CH-01 ~ CH-04、CH-06、CH-07 |
| US-Terminal-01 | TM-01 ~ TM-06 |
| US-PreviewContext-01 | PV-01 ~ PV-06 |
| US-FilesGit-01 | FG-01 ~ FG-05 |
| US-LLMWiki-01 | WK-01 ~ WK-05 |
| US-LLMWiki-02 | WK-06 ~ WK-09 |
| US-LLMWiki-03 | WK-10 ~ WK-12 |
| US-LLMWiki-04 | WK-13 ~ WK-15 |
| US-LLMWiki-05 | WK-16 ~ WK-19 |
| US-LLMWiki-06 | WK-20 |
| US-LLMWiki-07 | WK-21 ~ WK-22 |
| US-AgentRuntime-01 | AR-01 ~ AR-05 |
| US-Settings-01 | ST-01 ~ ST-04 |
| US-Plugins-01 | PL-01 ~ PL-04 |
| US-Stats-01 | SS-01 ~ SS-05 |
| US-WorkspaceLayout-01 | LY-01 ~ LY-03 |
| US-DataRelease-01 | DR-01 ~ DR-05 |
| US-Worktree-01 | WT-01 ~ WT-05 |
| US-Worktree-02 | WT-06 ~ WT-07 |

---

## 3. 场景工作台

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| SC-01 | P0 | US-ScenePlatform-01 | 项目 A/B 各开 2 个终端，其中 1 个运行中、1 个待确认 | 1. 打开场景工作台<br>2. 核对项目、终端、状态 | 项目、项目内终端、运行状态全部可见；每个项目能看出运行中 / 待确认 / 异常终端 | ❌ |
| SC-02 | P0 | US-ScenePlatform-01 | 场景配置为文字可编辑 | 1. 修改项目 / Agent / 执行方式文字<br>2. 保存<br>3. 下一次 Chat 派活 | 配置保存成功；下一次派活按新配置生效；无需逐项目切换 | ❌ |
| SC-03 | P0 | US-ScenePlatform-01/05 | 场景配置指向项目 A + Agent-D + ACP | 1. Chat 描述任务<br>2. 触发分配建议<br>3. 查看理由并手动改项目/Agent/方式<br>4. 确认 | 分配前显示建议和理由；确认后才创建任务/run；可改项目、Agent、ACP/终端 | ❌ |
| SC-04 | P0 | US-ScenePlatform-01/05 | 同上 | 1. 查看任务最终执行方式<br>2. 在 TODO / Terminal 核对 | 任务明确显示项目、Agent、执行方式（ACP / 终端），与场景建议一致 | ◐ |
| SC-05 | P0 | US-ScenePlatform-02 | A/B 各有运行中任务和终端 | 1. Chat 切换「当前会话 / 当前项目 / 所有项目」<br>2. 查看状态 | 三种范围均可切换；所有项目视图包含跨项目运行、等待、待确认 | ❌ |
| SC-06 | P0 | US-ScenePlatform-02 | A/B 均有任务 | 1. 查看 TODO 聚合<br>2. 按项目筛选 | TODO 默认聚合所有项目；不是只看当前项目；可按项目过滤 | ◐ |
| SC-07 | P1 | US-ScenePlatform-02 | 终端 A 运行中、终端 B 等输入、终端 C 已退出 | 1. 对照终端状态与任务状态 | 运行 / 等输入 / 已退出与任务 badge 一致；不出现「终端已退出但任务运行中」 | ❌ |
| SC-08 | P0 | US-ScenePlatform-03 | 打开项目 A 终端，手动启动 pi | 1. 启动 Agent<br>2. 打开统一进展 | Agent 被识别为可管理运行；显示运行时长、最近输出、退出码；后续可接入任务 | ◐ |
| SC-09 | P0 | US-ScenePlatform-04 | 普通 TODO T1，未建 Mission | 1. 派给 Agent-D 与 Agent-P<br>2. 分别观察 run / worktree / 终端<br>3. 停止其中一个、纠偏另一个、分别确认 | 不强制 Mission；每个 Agent 独立 run / worktree / 终端标签；同 worktree 不允许并发写；任务↔终端可互跳；每个 Agent 可独立操作 | ❌ |
| SC-10 | P0 | US-ScenePlatform-06 | 已创建 Mission M1 | 1. 在 TODO 查看 M1<br>2. 展开子任务<br>3. 点任务行定位终端 | Mission 作为任务卡出现在 TODO；可展开子任务；行能定位终端，状态一致 | ◐ |
| SC-11 | P0 | US-ScenePlatform-01（决策） | — | 1. 修改全局场景配置<br>2. 用 AI 生成/建议配置<br>3. 保存后派活 | 全局只有一份场景配置；可编辑、可 AI 辅助；驱动自动分配 | ❌ |
| SC-12 | P1 | US-ScenePlatform-04（决策） | 一个任务需要两个 Agent | 1. 不建 Mission，直接派多个 Agent<br>2. 允许系统自动开多个终端 | 普通 TODO 直接并行；允许自动开多个终端；每个终端独立可见 | ❌ |

---

## 4. 项目 / 工作区

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| PJ-01 | P0 | US-ProjectWorkspace-01 | 准备 A/B/C | 1. 添加 A/B/C<br>2. 切换当前项目<br>3. 重命名、改状态、移除 C | 增删改查和切换成功；移除后关联视图不残留 | ✅ |
| PJ-02 | P0 | US-ProjectWorkspace-01 | 添加同名项目 | 1. 再添加一个同名项目<br>2. 查看 `@别名` | 每个项目有唯一 `@别名`；同名自动加后缀，不冲突 | ✅ |
| PJ-03 | P0 | US-ProjectWorkspace-01 | A/B 有任务和终端 | 1. 切换 A → B<br>2. 查看任务、终端、文件树 | 任务、终端、文件树跟随当前项目；不串项目 | ✅ |
| PJ-04 | P0 | US-ProjectWorkspace-01/Worktree-02 | A 是 git 仓库；默认 worktree 策略 | 1. 在 A 派活<br>2. 查看 cwd / branch | 按当前 worktree 策略创建或复用；策略为 never 时原地执行 | ◐ |
| PJ-05 | P1 | US-ProjectWorkspace-01（决策） | 多个项目 | 1. 分组、排序、收藏<br>2. 打开项目页 | 支持分组/排序/收藏；项目页不变成「项目+场景+终端+进展」总览 | ❌ |

---

## 5. TODO / 任务

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| TK-01 | P0 | US-TaskBoard-01 | 准备待执行/排队/运行中/等输入/待确认/完成/失败/取消任务 | 1. 打开 TODO<br>2. 查看分组和 badge | 4 组：待执行 / 进行中 / 待确认 / 已完成；进行中内 badge 区分排队/运行中/等待输入；等待输入置顶高亮 | ✅ |
| TK-02 | P0 | US-TaskBoard-01 | 同上 | 1. 查看已完成组<br>2. 制造失败/取消 | 已完成默认折叠；失败/取消回到待执行并带状态 badge | ✅ |
| TK-03 | P1 | US-TaskBoard-01 | 新建任务 | 1. 填写标题/描述/验收/优先级/截止/标签<br>2. 查看任务行 | 字段完整保存；任务行显示项目/Agent/耗时 | ✅ |
| TK-04 | P0 | US-TaskBoard-01 | 有待执行、运行中、待确认任务 | 1. 行内编辑<br>2. 派活<br>3. 停止<br>4. 确认<br>5. 重试失败任务 | 五类操作可用；操作后状态即时更新；不跳页 | ✅ |
| TK-05 | P0 | US-TaskBoard-01 | 选中任务 T1 | 1. 点击 T1<br>2. 观察 Chat 和 Terminal | 两列同步到 T1；不串会话/终端 | ✅ |
| TK-06 | P0 | US-TaskBoard-01（决策） | T1 成功后确认 | 1. 确认 T1<br>2. 撤销确认<br>3. 查看数据 | 确认只是状态，不产生第二份任务；允许撤销；撤销后回到待确认 | ✅ |
| TK-07 | P1 | US-TaskBoard-01（决策） | 多任务 | 1. 切横向看板视图<br>2. 拖动/查看卡片 | 提供横向看板；与分组列表共享同一份数据 | ❌ |
| TK-08 | P1 | US-ScenePlatform-04 | 多 Agent 任务 | 1. 查看任务行<br>2. 展开多个 Agent/终端状态 | 行内能看出多个 Agent 与各自终端状态；可分别操作 | ❌ |

---

## 6. Mission / Super Agent

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| MS-01 | P0 | US-Mission-01 | 创建 M1 | 1. 主管生成 Plan<br>2. 未批准前观察 | 计划必须先由人批准；批准前不创建子任务、不执行 | ✅ |
| MS-02 | P0 | US-Mission-01 | M1 计划已批准 | 1. 启动子任务<br>2. 暂停、确认、取消其中一个 | 每个子任务独立 Todo / Run / worktree；可单独操作，不影响其他子任务 | ✅ |
| MS-03 | P0 | US-Mission-01 | 主管与 worker | 1. 让主管尝试写文件<br>2. 让 worker 写文件 | 主管只读；worker 才能改代码；越权被拒绝并留痕 | ✅ |
| MS-04 | P0 | US-Mission-01 | M1 所有子任务完成 | 1. 等待汇总<br>2. 人工确认 | Mission 完成必须由人确认；未确认前不显示完成 | ✅ |
| MS-05 | P0 | US-Mission-01 | 子任务失败/取消/重启应用 | 1. 制造失败<br>2. 取消<br>3. 重启 App | 失败、取消、重启都不能伪造完成；恢复后状态一致 | ✅ |
| MS-06 | P1 | US-Mission-01（决策） | 终端 Agent、远端主机 | 1. 把终端 Agent 作为 child<br>2. 尝试远程/多层主管 | 终端 Agent 可作为 child；本期不做远程 supervisor / 多层主管 | ◐ |

---

## 7. Chat

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| CH-01 | P0 | US-Chat-01 | 新建会话 | 1. 普通消息派活<br>2. 用 `@项目` / `@Agent` 指定目标<br>3. 新建不绑任务的会话 | Chat 是唯一分派入口；thread 不绑任务也存在；`@别名` 路由正确 | ✅ |
| CH-02 | P0 | US-Chat-01 | T1 运行中 | 1. 发送纠偏<br>2. 断网/制造投递失败<br>3. 观察回执并重发<br>4. run 结束 | 回执为投递中 → 已注入 / 失败重发；run 结束时 pending 一律失败；可重发 | ✅ |
| CH-03 | P0 | US-Chat-01 | 预览拾取元素 | 1. 拾取元素<br>2. 在 Chat 发送说明 | 元素 selector/源码/截图作为上下文注入；运行中作为 steer | ✅ |
| CH-04 | P0 | US-Chat-01 | T1 已确认 | 1. 继续发送消息<br>2. 查看任务 | 消息只记录；不新建 run；不改变确认状态 | ✅ |
| CH-05 | P0 | US-ScenePlatform-02（决策） | A/B 有运行、终端、待确认 | 1. 在 Chat 问「现在所有项目进展」<br>2. 查看回答 | 询问时返回所有项目、终端、运行、待确认；不要求常驻 dock | ❌ |
| CH-06 | P1 | US-Chat-01（决策） | 多个可用 Agent | 1. 对同一任务广播给 2 个 Agent<br>2. 查看各自 run | 支持多 Agent 广播；每个 run 独立；可对比/采纳 | ◐ |
| CH-07 | P1 | US-Chat-01（决策） | — | 1. 新建不绑任务的纯聊天<br>2. 重启 App<br>3. 继续对话 | 支持常驻 ACP 会话；重启后可继续；不自动创建 TODO | ❌ |

---

## 8. Terminal

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| TM-01 | P0 | US-Terminal-01 | 项目 A | 1. 新建多标签<br>2. 直接输入命令<br>3. 拆分窗格 | 真实 pty；多标签、可输入、可拆分；输出与交互正常 | ✅ |
| TM-02 | P0 | US-Terminal-01 | 任务 T1（项目 A） | 1. 从任务打开终端<br>2. 启动 Agent | 任务绑定项目目录；Agent 在终端里启动；cwd 正确 | ◐ |
| TM-03 | P0 | US-Terminal-01 | Agent-P 在终端运行 | 1. 观察输出<br>2. 直接在终端输入纠偏 | 终端输出即进展；输入能影响当前 Agent | ✅ |
| TM-04 | P1 | US-Terminal-01 | Chat 派活 + 终端执行 | 1. Chat 派活<br>2. 切到对应终端<br>3. 再回 Chat | 两边能互相对应；不串任务/标签 | ◐ |
| TM-05 | P0 | US-ScenePlatform-03 / Terminal（决策） | 先开终端再起 Agent | 1. 在任务 worktree 启动 Agent<br>2. 在项目根启动 Agent 后接入任务<br>3. 需要隔离时新开 Agent | worktree 直接绑定；项目根绑定为 worktree=project；接入只写关系不迁移进程；需要隔离时新开终端/Agent | ◐ |
| TM-06 | P1 | US-ScenePlatform-02 | A/B 各有多个终端 | 1. 切项目/重启<br>2. 查看终端标签 | 标签按项目持久化或可恢复；统一进展能列出各终端 | ◐ |

---

## 9. 预览 / UI 上下文

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| PV-01 | P0 | US-PreviewContext-01 | dev server 运行中 | 1. 打开预览标签<br>2. 切回 pty | 预览是终端标签；切换不打断 pty | ✅ |
| PV-02 | P0 | US-PreviewContext-01 | 终端打印 localhost 地址 | 1. 启动 dev server<br>2. 观察预览入口 | dev server 地址自动识别；可一键打开 | ✅ |
| PV-03 | P0 | US-PreviewContext-01 | 预览页有标题元素 | 1. 拾取元素<br>2. 发送到 Chat | selector、样式、源码位置、截图进入上下文；Agent 能定位 | ✅ |
| PV-04 | P1 | US-PreviewContext-01 | 本地 HTML 文件 | 1. 打开 HTML 预览<br>2. 可视化改文字/样式<br>3. 保存 | 本地 HTML 可视化编辑；保存回写；不破坏 head | ✅ |
| PV-05 | P1 | US-PreviewContext-01 | 预览页滚动/表单状态 | 1. 切换页面/源码<br>2. 切回 | 切换不丢状态；返回后位置/输入保持 | ◐ |
| PV-06 | P1 | US-PreviewContext-01（决策） | 预览页 | 1. 前进/后退、刷新/硬刷新/停止<br>2. 缩放、页内查找、DevTools、外部打开<br>3. 设备宽度三档<br>4. 同 URL 再开、显式新建 | 浏览器基础控制可用；设备三档；同 URL 默认复用，可显式新建；最多 2–3 个，后台挂起，标签显示端口/worktree | ◐ |

---

## 10. 文件 / Git

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| FG-01 | P0 | US-FilesGit-01 | 项目 A 文件树 | 1. 新建、重命名、复制、删除<br>2. Finder 显示、刷新 | 操作成功；路径校验阻止越界；删除有确认 | ✅ |
| FG-02 | P0 | US-FilesGit-01 | 文本/图片/Markdown/HTML | 1. 分别打开预览 | 四类文件正确渲染；Markdown 可编辑；HTML 安全预览 | ✅ |
| FG-03 | P0 | US-FilesGit-01 | git 仓库 | 1. 查看分支/状态<br>2. 暂存、提交、拉取、推送、Diff<br>3. 打开项目 Wiki | 全部操作可用；失败原样返回输出；Wiki 可打开 | ✅ |
| FG-04 | P0 | US-FilesGit-01 | T1 在 worktree 运行 | 1. 查看文件预览根目录<br>2. 修改 worktree 文件 | 预览跟随 run worktree；能看到 Agent 改动 | ✅ |
| FG-05 | P1 | US-FilesGit-01（决策） | 有 Diff / 文件变更 | 1. 行内审阅/采纳<br>2. 查看文件与任务关联 | 支持 diff 行内审阅/采纳；文件变更能关联任务 | ❌ |

---

## 11. LLM Wiki / Notes

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| WK-01 | P0 | US-LLMWiki-01 | 导入 S1 | 1. 导入 Source<br>2. 生成 Page<br>3. 添加 Citation<br>4. Review<br>5. 查看 Revision | Source→Page→Citation→Review→Revision 全链路；每步留痕 | ✅ |
| WK-02 | P0 | US-LLMWiki-01 | P1 reviewed，P2 draft | 1. 让 Agent 写 P1<br>2. 让 Agent 写 P2 | Agent 只能写 draft；reviewed 不能被静默覆盖；需要重新审核 | ✅ |
| WK-03 | P0 | US-LLMWiki-01 | 本地 Markdown 目录 | 1. 导入目录<br>2. 编辑并写回 | 导入、编辑、写回成功；外部修改检测生效 | ✅ |
| WK-04 | P0 | US-LLMWiki-01 | 多页面/资料 | 1. 打开 Memory<br>2. 搜索<br>3. 图谱<br>4. Review 队列 | 四项可用；Memory 注入 run prompt | ✅ |
| WK-05 | P0 | US-LLMWiki-01 | Agent + MCP | 1. 调用 wiki_search / read_source / read_page<br>2. 写 draft / 加 citation | 工具可用；只能写 draft；写入带来源 | ✅ |
| WK-06 | P0 | US-LLMWiki-02 | 打开页面编辑 | 1. 输入文字<br>2. 停笔约 1s | 自动保存；标签未保存点消失；失败有明确提示 | ✅ |
| WK-07 | P0 | US-LLMWiki-02 | 保存会失败（只读目录/断盘） | 1. 编辑<br>2. 触发自动保存失败 | 提示保存失败；编辑内容不丢；可重试 | ✅ |
| WK-08 | P0 | US-LLMWiki-02 | 有页面/资料/本地文件 | 1. 删除<br>2. 进回收站<br>3. 还原 | 进回收站，默认保留 30 天；可还原到原位置 | ✅ |
| WK-09 | P0 | US-LLMWiki-02 | 刚删除页面 | 1. ⌘Z 或点「撤销」 | 删除可撤销；不会静默消失 | ✅ |
| WK-10 | P0 | US-LLMWiki-03 | 任意应用前台 | 1. 按全局热键<br>2. 用剪贴板/选中文本预填 | 快捕窗口唤起；不切主窗口、不打断当前任务；内容预填 | ◐ |
| WK-11 | P0 | US-LLMWiki-03 | 页面编辑 | 1. 输入 `#标签`<br>2. 选择候选<br>3. 点击标签筛选<br>4. 新建页面 | 真实候选；点击筛选全部页面；有收藏/置顶/最近；新建后直接可编辑 | ◐ |
| WK-12 | P1 | US-LLMWiki-03 | 侧栏/插件入口 | 1. 查看命名 | 统一叫法（不再「笔记」/「Wiki」两套词） | ◐ |
| WK-13 | P0 | US-LLMWiki-04 | 中文页面 1000 个 | 1. 搜索中文词<br>2. 搜模糊/标题词 | 中文按字切分、模糊匹配、标题加权；3 秒内定位 | ◐ |
| WK-14 | P0 | US-LLMWiki-04 | 搜索结果 | 1. 点击结果 | 高亮命中；滚动并定位到该段 | ❌ |
| WK-15 | P1 | US-LLMWiki-04 | 多状态/时间/来源 | 1. 按状态/时间/来源筛选<br>2. 查看搜索历史 | 筛选可用；有搜索历史 | ❌ |
| WK-16 | P1 | US-LLMWiki-05 | 页面含 `[[P2]]` | 1. 悬停链接 | hover 出摘要浮层 | ❌ |
| WK-17 | P1 | US-LLMWiki-05 | 链接指向不存在页面 | 1. 点击红链<br>2. 创建 | 红链可点击创建；创建后回填标题与出处 | ❌ |
| WK-18 | P1 | US-LLMWiki-05 | 有多篇引用页面 | 1. 查看反链<br>2. 查看 unlinked mentions | 反链显示来源句摘录；有未链接提及列表 | ❌ |
| WK-19 | P1 | US-LLMWiki-05 | 图谱 | 1. 点击节点<br>2. 按类型过滤 | 节点打开对应页面；支持页面/资料/本地文件过滤 | ◐ |
| WK-20 | P0 | US-LLMWiki-06 | 多个页面/资料 | 1. 提问<br>2. 查看答案引用<br>3. 点击引用<br>4. 问无依据问题<br>5. 存为 draft | 每段带 `[[页面]]` 出处可跳转；无依据明确说「Wiki 里没有」；只查本地；答案可存 draft 并走审核 | ❌ |
| WK-21 | P1 | US-LLMWiki-07 | 本地目录 >30 文件 | 1. 整批导入<br>2. 制造单文件失败<br>3. 导出 Markdown/PDF | 不受 30 个上限；单个失败不阻塞；导出成功 | ◐ |
| WK-22 | P0 | US-LLMWiki-07 | 1000 页面 | 1. 打开列表<br>2. 搜索<br>3. 滚动 | 列表与搜索 <200ms；不依赖单文件全量读入 | ❌ |

---

## 12. Agent / 主机 / 执行方式

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| AR-01 | P0 | US-AgentRuntime-01 | 本机/SSH | 1. 纳管 Agent<br>2. 设置 CLI、主机、cwd、别名、并发 | 字段完整；别名项目内唯一；并发上限生效 | ✅ |
| AR-02 | P0 | US-AgentRuntime-01 | SSH 主机在线/离线 | 1. 探测 CLI/版本/git/目录<br>2. 断网 | 在线信息正确；离线有状态；失败不影响本机 | ✅ |
| AR-03 | P0 | US-AgentRuntime-01 | Agent-D / Agent-P | 1. 从 Chat 派给 dsh<br>2. 从 Chat 选 pi | dsh 走 ACP；pi/claude/codex/opencode 走终端 pty；执行方式可见 | ✅ |
| AR-04 | P0 | US-AgentRuntime-01 | 不支持的 CLI | 1. 选择不支持的 CLI 派活 | 明确报错，不静默换引擎；提示可用替代 | ✅ |
| AR-05 | P0 | US-AgentRuntime-01 | 多个 run | 1. 触发并发上限<br>2. 触发审批 allow/deny/ask<br>3. 制造失败 | 并发、审批、失败分类可见；队列原因明确 | ✅ |

---

## 13. 设置 / 主题

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| ST-01 | P1 | US-Settings-01 | 打开设置 | 1. 检查分区 | 通用/外观/执行/终端/预览/数据/快捷键/关于齐全 | ✅ |
| ST-02 | P0 | US-Settings-01 | 修改任意设置 | 1. 修改<br>2. 重启 App | 即时保存、SQLite 持久化；重启后保持 | ✅ |
| ST-03 | P1 | US-Settings-01 | 多主题 | 1. 切换主题<br>2. 查看终端、编辑器 | 终端和编辑器跟随；深色/浅色下无白底割裂 | ✅ |
| ST-04 | P1 | US-Settings-01 | 有 Agent/模型 | 1. 改默认 Agent、并发、审批<br>2. 改 dsh 路径、字号、预览地址<br>3. 导出备份 | 改动生效；备份可恢复 | ✅ |

---

## 14. 插件

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| PL-01 | P0 | US-Plugins-01 | 安装/内置插件 | 1. 启用插件<br>2. 停用 | 插件进程受控；停用后视图/命令不可用；不崩溃 | ✅ |
| PL-02 | P0 | US-Plugins-01 | 插件 manifest | 1. 检查权限/命令/视图/事件 | 只授予声明权限；命令/视图/事件按 manifest 注册 | ✅ |
| PL-03 | P0 | US-Plugins-01 | 带 agent:tools 的插件 | 1. 调用 MCP 工具 | 工具可用；越权被拒绝；调用留痕 | ✅ |
| PL-04 | P1 | US-Plugins-01 | 内置 + 第三方 | 1. 内置随 App 分发<br>2. 安装第三方<br>3. 启停 | 内置无需安装；第三方可安装/启停；duplicate id 不覆盖内置 | ✅ |

---

## 15. 统计 / 待处理

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| SS-01 | P0 | US-Stats-01 | 有成功/失败/排队 run | 1. 打开统计 | 成功率、耗时、排队、Token、失败分类、趋势、分组、CSV 可见 | ✅ |
| SS-02 | P0 | US-Stats-01 | 有未上报 usage 的 run | 1. 查看 Token<br>2. 查看 CSV | 未上报显示「未上报」，不写 0；CSV 保留空值 | ✅ |
| SS-03 | P0 | US-Stats-01（决策） | 有待确认/失败/等输入 | 1. 查看 TODO 筛选<br>2. 在 Chat 问进展 | 不单独做收件箱页；待处理进入 TODO 筛选 + Chat 全局进展 | ◐ |
| SS-04 | P0 | US-Stats-01 | 同一任务多个待处理信号 | 1. 查看待处理列表<br>2. 处理完成 | 按任务去重；处理完自动消失；不推每一步 | ✅ |
| SS-05 | P1 | US-Stats-01 | 多项目/多场景 | 1. 切范围<br>2. 按分组查看 | 统计范围切换正确；分组和 CSV 一致 | ◐ |

---

## 16. 布局 / 导航 / 快捷键

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| LY-01 | P1 | US-WorkspaceLayout-01 | 工作区 | 1. 折叠 TODO/Chat/文件<br>2. 拖拽分隔条<br>3. 重启 | 五列固定；除 Terminal 外可折叠；尺寸记忆 | ✅ |
| LY-02 | P1 | US-WorkspaceLayout-01 | 任意页面 | 1. ⌘K<br>2. 快捷键<br>3. 打开 Git/笔记/设置 | 命令面板、快捷键、入口可用；不打断当前操作 | ✅ |
| LY-03 | P2 | US-WorkspaceLayout-01（决策） | 多任务 | 1. 横向看板<br>2. 多窗口布局 | 是否支持横向看板/多窗口，待产品确认 | ❓ |

---

## 17. 数据 / 安全 / 打包

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| DR-01 | P0 | US-DataRelease-01 | 正常使用 | 1. 检查数据文件 | 本地 SQLite 单一事实源；无云端依赖 | ✅ |
| DR-02 | P0 | US-DataRelease-01 | 旧版本 DB | 1. 升级启动<br>2. 导出备份<br>3. 导入恢复 | 迁移幂等；升级前可备份；恢复后数据完整 | ✅ |
| DR-03 | P0 | US-DataRelease-01 | 任务/worktree/审批 | 1. 尝试越界文件操作<br>2. 检查打包产物 | 任务/worktree/审批有边界；凭据不打包；日志不泄密 | ✅ |
| DR-04 | P0 | US-DataRelease-01 | macOS/Windows/Linux | 1. 安装包启动<br>2. 检查内置 dsh | 三平台可打包；内置 dsh 可运行；无系统 dsh 也能启动 | ✅ |
| DR-05 | P1 | US-DataRelease-01（决策） | 发布新版 | 1. 检查自动更新<br>2. 检查签名 | 支持自动更新；本期不做签名/公证 | ❌ |

---

## 18. 工作树（Worktree）

| ID | P | 关联 | 前置 / 数据 | 步骤 | 预期 | 现状 |
|---|---|---|---|---|---|---|
| WT-01 | P0 | US-Worktree-01 | T1 在 git 项目派活 | 1. 查看任务行/终端行 | 显示 `worktree: harness/...` 分支和路径 | ◐ |
| WT-02 | P0 | US-Worktree-01 | 有 worktree | 1. 从任务/终端打开目录<br>2. Finder 显示 | 能在终端/Finder 打开 worktree | ◐ |
| WT-03 | P0 | US-Worktree-01 | 已完成任务的 worktree | 1. 清理不再需要的 worktree<br>2. 刷新列表 | 可清理；不误删运行中的 worktree | ❌ |
| WT-04 | P0 | US-Worktree-01 | SSH 远端 run | 1. 派活到远端<br>2. 查看 cwd | 明确显示「不建 worktree，使用远端绝对 cwd」 | ✅ |
| WT-05 | P0 | US-Worktree-01 | 非 git 项目 / worktree 创建失败 | 1. 派活<br>2. 查看 cwd | 没有 worktree 时不伪造；失败原因可见 | ✅ |
| WT-06 | P0 | US-Worktree-02 | 项目/场景策略 | 1. 设 auto / always / never<br>2. 用场景/项目覆盖<br>3. 修改策略 | 策略生效；终端模式遵守；修改只影响之后的 run | ❌ |
| WT-07 | P1 | US-Worktree-02（决策） | 手工终端接入任务 | 1. 选择保持当前目录<br>2. 选择重启到 worktree | 两种选择可用；不迁移进程时关系仍正确 | ◐ |

---

## 19. 跨模块 E2E

| ID | P | 场景 | 步骤 | 预期 |
|---|---|---|---|---|
| E2E-01 | P0 | 多项目 × 多 Agent | 1. Chat `@项目A @Agent-D` 派活<br>2. 同一任务加 Agent-P<br>3. 分别观察终端/worktree<br>4. 纠偏/停止其中一个<br>5. 确认 | 每个 Agent 独立 run/worktree/终端；状态与回执正确；确认后进已完成；不串项目 |
| E2E-02 | P0 | 终端优先 Agent | 1. 项目 A 开终端起 pi<br>2. 统一进展看到运行时长/输出/退出码<br>3. 接入任务（保持 cwd / 重启 worktree） | Agent 可被识别和管理；接入关系正确；TODO 显示终端状态 |
| E2E-03 | P0 | Mission 全链路 | 1. 创建 M1<br>2. 审批 Plan<br>3. 子任务并行/暂停/取消<br>4. 重启 App<br>5. 人工确认 | 计划先批；子任务独立；失败/取消/重启不伪造完成；人确认后才完成 |
| E2E-04 | P0 | 元素拾取 → 改动 → 确认 | 1. 预览拾取标题<br>2. Chat 发送修改要求<br>3. Agent 改 worktree<br>4. 预览看改动<br>5. 确认 | 上下文准确；改动落在 worktree；预览看到结果；确认链路完整 |
| E2E-05 | P0 | Wiki 全链路 | 1. 导入 S1/S2<br>2. 生成 draft + citation<br>3. Review<br>4. 搜索/提问<br>5. 答案存 draft | Source→Page→Citation→Review→Revision；回答带引用；无依据不编造 |
| E2E-06 | P0 | 场景配置 → 自动分配 | 1. 编辑全局场景配置<br>2. Chat 描述任务<br>3. 看建议和理由<br>4. 改分配并确认 | 建议可解释、可改；确认后才创建任务/run |
| E2E-07 | P1 | 重启恢复 | 1. 运行中/排队/等输入各一<br>2. 重启 App<br>3. 查看 TODO/Chat/Terminal/Mission | 状态一致；不重复执行；pending 回执按规则失败；Mission 可恢复 |

---

## 20. 非功能测试

| ID | P | 类型 | 步骤 | 预期 |
|---|---|---|---|---|
| NF-01 | P0 | 性能 | 1000 个 Wiki 页面：打开列表、搜索、滚动 | 列表/搜索 <200ms；不一次性全量读入内存 |
| NF-02 | P1 | 性能 | 1000 条 Chat 消息 + 流式输出 | 滚动、流式追加不卡顿；不因全量广播明显掉帧 |
| NF-03 | P0 | 并发 | 10 个 run 同时触发，含同项目/同 cwd | 全局/主机/Agent 并发生效；同 cwd 串行；排队原因可见 |
| NF-04 | P0 | 安全 | 文件树、vault、worktree 路径穿越 | 拒绝 `..`、绝对路径越界；不写到项目外 |
| NF-05 | P0 | 安全 | 审批 ask/allow/deny | 审批弹窗/自动策略正确；拒绝后进程不越权 |
| NF-06 | P0 | 安全 | 检查打包产物与日志 | 凭据/密钥不打包、不进日志；API key 不出现在 CSV/事件 |
| NF-07 | P0 | 数据 | 迁移、备份、恢复、损坏 DB | 迁移幂等；备份可恢复；损坏有明确错误，不静默丢数据 |
| NF-08 | P0 | 打包 | macOS / Windows / Linux 安装启动 | 三端可启动；内置 dsh 跑通 ACP；无系统 dsh 也可用 |
| NF-09 | P0 | 恢复 | 强杀 App / 重启 / 断网 | 不伪造完成；run/消息/队列状态可恢复；pending 回执失败 |

---

## 21. 待确认 / 阻塞用例

以下问题在需求里尚未定稿，相关用例先不写死预期：

| 关联 | 问题 | 阻塞用例 |
|---|---|---|
| US-Settings-01 | 场景配置放设置还是独立页？项目级是否覆盖全局？ | SC-02/SC-11、ST-01 |
| US-Plugins-01 | 第三方插件安装/更新/信任流程做到什么程度？ | PL-04 |
| US-Stats-01 | 「待处理」入口放 TODO 筛选、Chat 进展，还是两边？处理完历史是否保留？是否按场景拆分？是否做费用估算？ | SS-03/SS-05 |
| US-WorkspaceLayout-01 | 场景工作台放独立导航还是项目页？是否需要多窗口？ | LY-03 |
| US-Worktree-01/02 | worktree 清理是手动/确认后自动/保留 N 天？默认 auto 还是 always？关闭 worktree 时多 Agent 如何避免互相覆盖？手工终端接入默认保持目录还是重启？ | WT-03、WT-06、WT-07 |
| US-AgentRuntime-01 | 是否补更多 CLI 的 Chat 适配器？是否做账号额度/用量治理？ | AR-03/AR-05 |
| US-Chat-01 | 纯聊天/常驻 ACP 会话的上下文边界与保留策略 | CH-07 |
| US-PreviewContext-01 | 多预览上限 2–3 的具体淘汰策略 | PV-06 |

---

## 22. 回归建议

每次发版至少跑：

1. **P0 冒烟**：E2E-01、E2E-03、E2E-04、E2E-05、NF-03、NF-08
2. **数据安全**：NF-04、NF-05、NF-06、NF-07、NF-09
3. **本轮变更相关**：按改动模块选对应用例
4. **失败用例**：保留隔离数据目录与截图，记录「预期 / 实际 / 现状标记」

---

## 23. 自动化代码

已提供 P0 子集的自动化骨架，不依赖 Playwright/Puppeteer：

```text
scripts/e2e-requirements.mjs        # runner：启动隔离 Electron + CDP
scripts/e2e/harness.mjs             # CDP / app 启停 / 截图 / 临时目录
scripts/e2e/suites/requirements.mjs # 已代码化用例
```

运行（需要先 `npm run build`）：

```sh
npm run test:e2e:requirements -- --list
npm run test:e2e:requirements
npm run test:e2e:requirements -- --only=THEME,GIT
npm run test:e2e:requirements -- --keep   # 保留隔离 userData 便于排查
npm run test:e2e:requirements -- --run-skipped  # 临时执行 skip 用例
```

已代码化（23 条）：

| 自动化 ID | 对应用例 |
|---|---|
| APP-01 | 应用启动 / state / host |
| LY-01 | 五列布局 Chat 收起 / 展开 |
| THEME-01 | 13 套主题 / data-mode / 终端配色 |
| SET-01 | 设置即时生效 / Chat 字号 |
| PALETTE-01 | 命令面板主题搜索与切换 |
| GIT-01 | Git → 项目 Wiki 页面 / 目录 / 图片 |
| GIT-02 | Wiki 搜索 / 页间链接 |
| PJ-01 | 项目添加 / 切换 / 别名 |
| FILES-01 | 文件树 / 文本预览 |
| WIKI-01 | Notes 打开 / 建页 / 编辑器 |
| AGENT-01 | 执行适配器矩阵 / 不支持 CLI 报错 |
| SC-01 | 场景总览 / 配置保存（fake 项目） |
| TK-01 | TODO 4 组（fake ACP 造 4 个状态） |
| CH-01 | Chat @别名分派 → TODO + user 消息 |
| CH-02 | 纠偏回执 pending → injected |
| CH-04 | 已确认任务消息只记录 |
| WT-01 | git 项目 run 使用 harness worktree 并显示 |
| WK-06 | Wiki 自动保存 / 回收站恢复（fake 页面） |
| PV-06 | 预览控制：地址栏/前进后退/设备/缩放/查找 |
| WT-06 | worktree 策略 never / Scene always |
| FG-03 | Git API：status/diff/stage/commit/log |
| E2E-01 | 普通 TODO 广播给两个 Agent（独立 run/worktree） |
| HOST-01 | 主机概览 / CLI 列表 / 指标 / 重新探测 |

暂未代码化（保留手工）：E2E-03（Mission 审批/子任务长流程）、E2E-05（Wiki 生成/审核/提问）。这两条依赖真实模型或 Mission 夹具，继续保留手工 E2E。
