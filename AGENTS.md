# AGENTS.md

Cockpit Harness 的 agent / contributor 入口。

## 先读

- **文档地图**：[`docs/README.md`](docs/README.md) —— 四层结构、阅读路径、每篇状态
- UI / 视觉 / 布局改动：**必须先读 [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md)**
- 架构：`docs/arch/ARCH-*.md`（总图先看 `ARCH-multi-agent-workspace.md`；**五件关键技术的能力边界与判据见 `ARCH-key-tech.md`**）
- 插件：`docs/arch/ARCH-plugins.md`
- 第三方源码：`third-part/<repo>/`（本地只读副本，**整个目录被 git 忽略、不入库**，含里面的 `README.md`）。规则：只读不改、一个仓库一个子目录、`docs/` 里写对照时必须标 `仓库 @ commit`（目录随时被删或更新）

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
12. **不要用 `window.prompt`**：Electron 不实现它（点了没有任何反应）。新建 / 重命名 / 填地址一律用行内输入或面板里的字段；`npm run verify:design` 会拦。

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
# 主进程 IPC 频道查重（重复注册会让应用启动即崩）
npm run verify:ipc
npm run verify:docs
# 隐私守卫（真实账号 / 手机号 / 个人邮箱 / 本机路径 / 密钥；不进 CI 日志）
npm run verify:privacy
# 人物画像（接线 / 导入格式 / 生命周期语义，纯后端 + 渲染层预览，不启动窗口）
npm run verify:persona
npm run persona:preview
```

### 调试 UI 时不要抢焦点

需要跑真实应用验证 UI（截图 / CDP / 点选）时，**必须后台启动**，不要激活或把窗口弹到用户面前：

```bash
open -g -j -a "/Applications/Cockpit Harness.app" --args --remote-debugging-port=9222
# 结束后退出，并把应用恢复成用户原来的状态
osascript -e 'tell application "Cockpit Harness" to quit'
```

- 优先用渲染层的隔离预览（vite + mock act）验证 UI，不必启动 Electron；
- 后端逻辑用 `node scripts/*selftest.mjs` 在临时目录跑，不碰用户的 userData；
- 不要用 `open -a` / 直接跑二进制（会激活窗口）。

### 打包 / 安装只保留一份

`release/mac-arm64/Cockpit Harness.app` 是构建产物，`/Applications/Cockpit Harness.app` 才是安装。两份同名 app 会让 Spotlight / Launchpad 出现重复图标，用户会以为装了两套。

- **不要双击 / 挂载 DMG 做验证**：挂载过的卷会在 `/Volumes` 留下 LaunchServices 登记，卸载后图标仍然在；验证装没装对，读 asar 就行：
  ```bash
  node -e "const a=require('@electron/asar');const p='/Applications/Cockpit Harness.app/Contents/Resources/app.asar';const i=a.listPackage(p).find(f=>/dist\/assets\/index-.*\.js$/.test(f));console.log(a.extractFile(p,i.replace(/^\//,'')).toString().includes('关键词'))"
  ```
- **`release/` 必须有 `.metadata_never_index`**（`install-mac.mjs` 会自动写）：没有它，Spotlight 会把构建产物的 app 也索引成第二个「Cockpit Harness」。
- 安装后若用户反馈「有两个」，按这个顺序查：
  ```bash
  ls -d /Applications/*.app | grep -i cockpit          # 磁盘上应该只有一份
  mdfind "kMDItemContentType == 'com.apple.application-bundle'" | grep -i cockpit
  lsregister -dump | grep -E "^path:.*Cockpit Harness\.app"   # 看有没有 /Volumes、.Trash 的失效登记
  lsregister -u <失效路径> && killall Dock              # 清登记 + 刷新 Launchpad 缓存
  ```
- `release/mac-arm64` 删掉也无妨（下次打包会重建），但根治靠索引排除，不要靠每次手动删；
  也不要把它加进「应用程序」或做别名，那才是真造出第二份。

UI 改动建议同时截图检查：工作区、项目、统计、Git、设置、说明，亮色 + 暗色。
