# YieldMind Harness

> 多 Agent 工作台：把每天的任务规划、分派、进度监控、实时纠偏串成闭环，并把数据、图表、页面编辑放在同一个上下文里。

独立发包的桌面应用（`.dmg` / `.exe` / `.AppImage`）。与 [`spin-yieldmind-ide`](../spin-yieldmind-ide) **并列**、互不依赖：IDE 负责"我改代码"，Harness 负责"我派活、看进度、验收"。

---

## 现状

**需求阶段（v0.3），未开工。**

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | Electron 壳 + 停靠布局 + 面板插件契约 + 本地服务 + SQLite | 待排期 |
| M1 | 编排闭环（TODO / 看板 / 分派 / 对话纠偏 / 回写） | 待排期 |
| M2 | 数据面板 + 绘图面板 + chartkit 抽包 + 上下文总线 | 待排期 |
| M3 | HTML 画布 + 双向打通 + Agent–面板接口 | 待排期 |
| M4 | 远程 SSH + 三平台打包/签名/自动更新 | 待排期 |

---

## 文档

| 文档 | 说明 |
|---|---|
| [docs/REQ-multi-agent-workspace.md](docs/REQ-multi-agent-workspace.md) | **原始需求 v0.3**：目标、角色、12 个功能模块（A–L）、数据模型、接口、非功能、分发清单、分期、复用清单、选型结论 |

后续待补：`docs/ARCH-multi-agent-workspace.md`（Panel 契约 / Context Envelope / 进程与事件拓扑）。

---

## 相关仓库

| 仓库 | 关系 | 复用内容 |
|---|---|---|
| `spin-yieldmind-ide` | 并列，同为用户入口 | **不复用代码**；仅保留"打开代码 / 看 Diff"的外挂调用 |
| `spin-yieldmind-app` | 上游平台 | `frontend/src/components/chartkit`（22 类图表 + 数据表/透视表）、`recipeSchema`、`tableModel` 抽成 `@yieldmind/chartkit`；平台 API 仅走 HTTP 适配器 |
| `spin-grape-html` | 上游组件 | GrapesJS 画布 + "选中即改"的 Pi 桥接（`ui-context` 协议 + 文件监听 + SSE） |

---

## 已定的三个大方向

1. **不基于 VSCodium**：域面板需要共享选区与数据集，VSCode 的 webview 隔离会切断联动；且底座带来 200MB+ 包体与独立升级线。
2. **不 fork reference / reference**：只借设计（run 状态机、Agent CLI 回写协议、worktree 隔离、SSH 主机管理）与 MIT 依赖，不碰受限代码。
3. **面板插件化**：新增面板走统一 Panel 契约，不改内核——这是防止范围膨胀的唯一护栏。

详见需求文档第 12 节「选型结论」。

---

## 不做

模型训练与推理服务 · 代码托管 · CI/CD 编排 · 多租户 SaaS · 通用代码编辑器 · 一期手机端。
