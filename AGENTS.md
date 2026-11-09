# AGENTS.md

Cockpit Harness 的 agent / contributor 入口。

## 先读

- UI / 视觉 / 布局改动：**必须先读 [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md)**
- 架构：`docs/ARCH-*.md`
- 插件：`docs/ARCH-plugins.md`

## UI 硬规则

1. 颜色、圆角、阴影、字体从 `src/design-system.css` 取，不在组件里新增一次性值。
2. 一级页面使用 `PageHeader`；空态使用 `EmptyState`。
3. 页面 = canvas + 一个主 surface；不要继续叠加卡片边框。
4. 一个区域最多一个 primary；低频操作放进 `⋯` `row-menu`。
5. 中文正文 ≥ 11.5px；9–10px 只能用于时间、快捷键、状态等辅助信息。
6. 默认主题保持中性色；蓝 / 紫 / 橙只表达语义。
7. 暗色边框使用 alpha 白；不要用实色灰画模块盒。
8. 亮色和暗色都要检查；不能只修一边。
9. 禁止整块高亮：编辑器聚焦只加 1px hairline，文本选中用 14% alpha，不要 3px ring / 蓝色闪屏。
10. 行内低频操作使用 `RowMenu`；不要新增不会自动关闭、可能被滚动容器裁切的 `<details>` 菜单。
11. 非当前 pane 只弱化 header/toolbar，不要整体降低内容透明度。

## 开发流程（WADE）

仓库已接入 WADE（配置见 `.wade.yml`，说明见 `docs/WADE.md`）：

```bash
npm run verify:wade
wade plan
wade implement <issue>
```

- WADE worktree 的 push 由 `wade implementation-session done` 授权，不要直接 `git push`。
- 模型使用当前机器已认证的 DeepSeek；不要把 `.wade.yml` 改回未认证的 Anthropic 模型。

## 验证

```bash
npm run typecheck
npm run build
npm run verify:plugins
```

UI 改动建议同时截图检查：工作区、项目、统计、Git、设置、说明，亮色 + 暗色。
