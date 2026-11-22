# AGENTS.md

Cockpit Harness 的 agent / contributor 入口。

## 0. 先读

- **文档地图**：[`docs/README.md`](docs/README.md) —— 四层结构、阅读路径、每篇状态
- UI / 视觉 / 布局改动：**必须先读 [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md)**（本文只列硬约束，细节以它为准）
- 架构：`docs/arch/ARCH-*.md`（总图先看 `ARCH-multi-agent-workspace.md`；**五件关键技术的能力边界与判据见 `ARCH-key-tech.md`**）
- 插件：`docs/arch/ARCH-plugins.md`
- 第三方源码：`third-part/<repo>/`（本地只读副本，**整个目录被 git 忽略、不入库**，含里面的 `README.md`）。规则：只读不改、一个仓库一个子目录、`docs/` 里写对照时必须标 `仓库 @ commit`（目录随时被删或更新）

---

## 1. 红线（不可违反）

1. **不要用 `window.prompt`**：Electron 不实现它（点了没有任何反应）。新建 / 重命名 / 填地址一律用行内输入或面板字段；`npm run verify:design` 会拦。
2. **第三方源码只读**：`third-part/` 不修改、不提交；引用时标 `仓库 @ commit`。
3. **打包 / 安装只保留一份**：`release/mac-arm64/*.app` 是构建产物，`/Applications/*.app` 才是安装；不要挂载 DMG 做验证、不要造别名或第二份（排障见末尾附录）。
4. **调试 UI 不抢焦点**：真实应用一律后台启动（`open -g -j`），结束恢复原状态；优先用隔离预览。

---

## 2. UI 硬约束

> 完整清单、示例与收敛记录在 [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) §3–§8。

### 2.1 Token 与表面

5. 颜色、圆角、阴影、字体只从 `src/design-system.css` 取；不新增一次性值。亮暗同构，暗色边框用 alpha 白。
6. 默认主题保持中性色；蓝 / 紫 / 橙只表达语义（状态、AI 动作），不拿来做装饰或“选中 + 运行 + 成功”通用色。
7. **主面只用 Surface 三档**：panel 10 / float 14 / tile 10；不新增 `.xxx-card` 卡片体系，不加 7 / 9 / 12 等非 token 圆角。页面 = canvas + 一个主面，不叠卡片边框；实体计数用 `.overview`。
8. 高亮 / 焦点克制：编辑器聚焦 1px hairline，文本选中 `fg` 14% alpha；禁止整块 ring / 蓝色闪屏 / 三色高亮叠加。非当前 pane 只弱化 header / toolbar，不整体降低内容不透明度。

### 2.2 页面外壳与页头

9. **页面外壳只有三种**：标准页（`max-width:1280`，padding 24/24/32）、全宽工作台（左栏 232，设置导航 218，padding 16/24/16）、舞台（满高，padding 12/16/16）。不得新增第四种，也不在页面里写 `max-width` 或左右 padding；左边距统一 `--page-gutter`（24 / ≤1100 16），标准页左对齐、不用 `margin:auto` 居中；间距只用 4 / 8 / 12 / 16 / 24 / 32。
10. **页面标题只用 `PageHeader`，且单语**：标题固定 22 / 600（阅读页 24），页面内不写 `h1/h2`；中文模式不叠加英文 kicker；接英文语言时标题 / 导航整体切换，不混排。分区名进 tabs / 左导航，不占 h1（设置页例外：h1 = 当前分区）；返回用 `ChevronLeftIcon`。阅读页（说明 / Wiki）是唯一例外。
11. **页面级切换只用 `Tabs`（胶囊 26px）或 `Segmented`**（卡片 / 列表）；文档标签用 `.notes-tabs`。不得新增 tab 外观，不得在标题上方再浮一条。

### 2.3 控件与内容

12. **开合控件统一用图标**：关闭 `XIcon`、段落折叠 `ChevronDown`（放行尾，展开 `rot-180`）、pane 收起 / 最大化 / 还原 `Panel*`；不写「收起 / 展开 / 关闭」，不用 `×` / `✕` 当关闭。纯图标必须有 `title` + `aria-label`，并同步 `aria-expanded` / `aria-pressed`。
13. **不用字符代替图标**：`↻ / ▦ / ☰ / ← / × / ✕` 一律用 `Icons` 组件；缺图标先补 `src/components/Icons.tsx`。
14. 一个区域最多一个 primary；低频操作进 `RowMenu`（`⋯`），不要新增不会自动关闭、可能被滚动容器裁切的 `<details>` 菜单。
15. **小按钮只用 `.btn.tiny`（26px）**：不新增 `.btn.tiny-btn` 别名；页头动作也统一 26，不再由页面覆盖高度。
16. **空态只用两种**：整块 `EmptyState`（面板用 `compact`）、内联 `.inline-empty`；不新增空态类。
17. 中文正文 ≥ 11.5px；9–10px 只给时间、快捷键、状态等辅助信息。正文和关键信息不用 `--faint` 承担。
18. **图标行统一紧凑**：并排的纯图标按钮点击区 20px（`--icon-size`）、缝 1–2px（`--icon-gap`）、成组靠右，一行 ≤ 4 个；第 5 个进 `RowMenu (⋯)`。标签页（38px）与 pane 开合（22px）是例外。`npm run verify:design` 会拦大于 20px 的 `.icon-btn`。
19. **数字不挂在 tab / 图标 / 标题上**：标签页、图标行、区域头、页头标题后面不追加计数（`智能体会话 5`、`会话历史 tab 上的 5` 都已下线）。总数属于列表行尾、概览条和统计；只有「需要你处理」才配出现在 chrome 上，且 `>0` 才渲染（不显示 `0`）；计数是 10.5–11px 的 `--faint` / `--muted` 小字，不用彩色 pill / 徽标球 / 红点。同一数字只出现一次。细节见 `docs/DESIGN-SYSTEM.md` §5「计数与徽标」。

### 2.4 简洁：一个区域一行 chrome

20. **一个区域只有一行 chrome**：标签栏 / 页头 / pane head 三选一，不在它上面再叠一条工具栏。区域头里**不写区域名**（`Terminal` / `Chat`），名字由导航和标签承担。
21. **一个动作只有一个常驻入口**：新建、查找、快捷命令、字号复位、窗格控制只在菜单 / 右键 / 快捷键里各出现一次；发现第二处就合并，不允许并存。
22. **进常驻前先答判据**：删掉它，用户是否要多点**两次以上**才能做完同一件事？不是 → 不许常驻（例：查找有 `⌘F`、快捷命令有右键、字号复位有 `⌘0`、打开项目在左栏）。动态信息（识别到的地址、可接入的任务）做成条件 chip，不占常驻位。

---

## 3. 开发流程（WADE）

仓库已接入 WADE（配置见 `.wade.yml`，说明见 `docs/WADE.md`）：

```bash
npm run verify:wade
wade plan
wade implement <issue>
```

- WADE worktree 的 push 由 `wade implementation-session done` 授权，不要直接 `git push`。
- 模型使用当前机器已认证的 DeepSeek；不要把 `.wade.yml` 改回未认证的 Anthropic 模型。

---

## 4. 验证

```bash
# 前端 / 静态检查
npm run typecheck
npm run build
npm run verify:design     # 设计规范：token、PageHeader、标题单语、字符图标、开合控件、旧类下线
npm run verify:docs       # 状态头 / 索引 / 内链
npm run verify:privacy    # 真实账号 / 手机号 / 邮箱 / 本机路径 / 密钥；不进 CI 日志

# 主进程 / 插件 / 终端
npm run verify:plugins
npm run verify:ipc        # IPC 频道查重（重复注册会让应用启动即崩）
npm run verify:pty

# 后端用例
npm test                  # 全部（tests/，临时目录，不碰 userData）
npm run test:list         # 用例分组：core / persona / knowledge / memory / im / bot
npm test -- persona       # 按分组 / 名称过滤
npm run test:e2e          # 端到端需求

# 专项
npm run verify:persona
npm run verify:wade
npm run preview:persona   # 渲染层预览，不启动窗口
npm run preview:bot       # 机器人会话页（Chats 列表 / 会话 / 执行树 / 附件）
npm run preview:memory
```

- **改 UI 只需要装渲染层**：`npm run build && node scripts/install-renderer.mjs`（约 5 秒，不重新解压 Electron）。
- **改了 `electron/` 主进程**：必须 `npm run pack && node scripts/install-mac.mjs`。
- 失败时先看命令自己的输出；`verify:design` 每条 ✗ 都对应 `DESIGN-SYSTEM` 的一个小节。

---

## 5. 调试 UI：不要抢焦点

需要跑真实应用验证 UI（截图 / CDP / 点选）时，**必须后台启动**，不要激活或把窗口弹到用户面前：

```bash
open -g -j -a "/Applications/Cockpit Harness.app" --args --remote-debugging-port=9222
# 结束后退出，并把应用恢复成用户原来的状态
osascript -e 'tell application "Cockpit Harness" to quit'
```

- 优先用渲染层的隔离预览（vite + mock act）验证 UI，不必启动 Electron；
- 后端逻辑用 `npm test` 在临时目录跑，不碰用户的 userData；
- 不要用 `open -a` / 直接跑二进制（会激活窗口）。

---

## 6. 截图检查清单

UI 改动至少看：工作区、项目、统计、Git、设置、说明；**亮色 + 暗色各一遍**。
重点看：左侧 gutter 是否一致、页头是否单语、Tabs / Segmented 是否同一外观、按钮高度、空态、开合图标。

---

## 附录：打包 / 安装只保留一份

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
- `release/mac-arm64` 删掉也无妨（下次打包会重建），但根治靠索引排除，不要靠每次手动删；也不要把它加进「应用程序」或做别名，那才是真造出第二份。
