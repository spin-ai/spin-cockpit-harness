# Design System

> 状态：v1 · 2026-11  
> 来源：`src/design-system.css` + `src/components/PageHeader.tsx` + `src/components/EmptyState.tsx`  
> 参考：ORCA 的克制、中性色、alpha 边框和紧凑 pane chrome；不是复制视觉，而是借用约束。

## 1. 设计原则

1. **安静优先**：默认界面不靠高饱和色、粗边框、重阴影制造层级。
2. **一个主面**：页面是 canvas + 一个主 surface；模块是主面内部的分节，不是层层卡片。
3. **颜色有语义**：主色只负责选中 / 主操作；绿、黄、红只负责状态。
4. **尺寸有系统**：字号、间距、圆角、阴影都从 token 取，不按页面临时决定。
5. **操作有主次**：一个区域最多一个 primary；低频操作收进 `⋯`。
6. **可读性优先**：中文正文不小于 11.5px；小字只用于状态、时间、快捷键。
7. **亮暗同构**：亮色和暗色使用同一套结构，不靠硬编码颜色互相打补丁。

## 2. 单一事实来源

| 内容 | 位置 |
|---|---|
| 字体、表面、边框、圆角、阴影、默认亮暗色 | `src/design-system.css` |
| 一级页面页头 | `src/components/PageHeader.tsx` |
| 空态 | `src/components/EmptyState.tsx` |
| 全局布局 / 组件样式 | `src/styles.css` |
| 项目 Wiki 排版 | `src/wiki.css` |

**新增颜色/圆角/阴影时，先在 `design-system.css` 加 token，再使用。**  
不要在其他文件里新增 `#xxxxxx`、`12px` 圆角这类一次性值。

## 3. Tokens

### 字体

```css
--font-sans: "Geist Variable", "Geist", -apple-system, "PingFang SC", ...;
--mono: "Geist Mono Variable", "Geist Mono", "SF Mono", ...;
```

- UI：Geist Variable；中文回退 PingFang SC / Microsoft YaHei
- 代码、ID、终端、路径：Geist Mono
- 基础字号 13px / 1.55
- 中文正文最低 11.5px；辅助信息最低 10.5px

### 字号

| 用途 | 大小 |
|---|---|
| 一级页面标题 | 22px / 600 |
| 区块标题 | 12.5–13px / 600 |
| 正文 | 13px |
| 次要正文 | 12px |
| 辅助信息 | 11–11.5px |
| Kicker / 表头 | 10–11px，大写 + letter-spacing |

不要用 9px 承载中文说明。

### 间距

```text
4 / 8 / 12 / 16 / 24 / 32
```

- 行内 gap：4–8
- 控件间距：8
- 区块内部：12–16
- 区块之间：16–24
- 页面级别：24–32

### 圆角

```css
--radius: 10px;        /* 主面 */
--radius-sm: 6px;      /* 小控件 */
--radius-lg: 14px;     /* 浮层 / 大面 */
```

不要再新增 7 / 9 / 11 / 12 / 13 / 16 等一次性圆角。

### 阴影

```css
--shadow-1: 0 1px 2px rgba(10,10,10,.045);
--shadow-2: 0 10px 24px rgba(0,0,0,.16);
--shadow-float: 0 18px 46px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.10);
```

- surface：优先靠背景和 hairline，不靠阴影
- 浮层：`--shadow-float`
- 不要为每个卡片写独立 shadow

### 表面与边框

亮色（默认 light）：

```css
--page-canvas:#fafafa; --surface:#ffffff; --surface-hover:#f5f5f5;
--sidebar:#fafafa; --border:#e5e5e5; --border-strong:#d4d4d4;
--fg:#0a0a0a; --fg-2:#404040; --muted:#696969; --faint:#a3a3a3;
--brand:#171717; --brand-soft:#f2f2f2;
```

暗色（默认 dark）：

```css
--page-canvas:#0a0a0a; --surface:#171717; --surface-hover:#262626;
--sidebar:#111111; --border:rgba(255,255,255,.08);
--border-strong:rgba(255,255,255,.14);
--fg:#f0f0f0; --fg-2:#d4d4d4; --muted:#a3a3a3; --faint:#737373;
--brand:#e5e5e5; --brand-soft:#262626;
```

规则：

- 暗色边框用 **alpha 白**，不是实色灰
- 主色默认中性；蓝、紫、橙只做语义强调
- 其他主题（paper / midnight / forest / …）继续使用自己的 palette，不被默认主题覆盖

## 4. 页面结构

```text
Page
├─ PageHeader        标题 / 副标题 / 主操作 / 可选 tabs
├─ Main surface      一个主面
│  ├─ Section        用留白和字号分节
│  └─ Row / List     行分隔用极淡 hairline
└─ EmptyState        无内容时使用
```

- 一级页面宽度：`max-width: 1280px`
- 设置阅读宽度：`max-width: 820px`
- 页面标题：统一 `PageHeader`，不要每个页面自己写 h1/h2
- Git 等带子 tab 的页面：tab 放进 `PageHeader`，不要在标题上方再悬浮一条

## 5. 组件规则

### 按钮

- 一个区域最多一个 `.btn.primary`
- 页面操作、行操作默认 ghost/outline
- 低频操作进 `row-menu`（`⋯`）
- 高度：30px；小按钮 26px
- 不使用多个同权重按钮并排表达主次

### 行内操作菜单

- 低频操作使用 `RowMenu`，不要继续堆按钮
- 点击外部、Esc、滚动、窗口 resize 时关闭
- 菜单用 portal + fixed 定位，避免被 `.wide` / 列表滚动容器裁切
- 靠近视口底部时向上展开
- 执行菜单动作后关闭

### 页头副标题

- 最多两行
- 超出用 ellipsis，并设置 `title` 保留完整文本
- 不要用 `white-space:nowrap` 把说明截成一行

### 工作区焦点

- 非当前 pane 不整体降低透明度
- 只弱化 pane header / toolbar
- 内容区域保持可读性

### 列表

- 行内主信息一行，元信息第二行
- 失败 / 运行列表使用固定列网格
- 状态、时间、耗时右对齐
- 长文本必须 `ellipsis` + title
- 行 hover 显示操作，不要默认铺满按钮

### 状态

| 语义 | 颜色 |
|---|---|
| 成功 / 完成 | green |
| 等待 / 风险 | amber |
| 失败 / 危险 | red |
| 运行 / 选中 | neutral primary（必要时蓝） |
| AI 动作 | 紫色，少量 |

不要用同一种蓝色同时表示“选中、运行、成功、链接”。

### 空态

统一使用 `EmptyState`：

- 一个短标题
- 一句解释
- 最多一个下一步操作
- 不用一整屏空白 + 一行灰字

## 5.5 高亮 / 聚焦 / 闪烁

高亮只用于“当前位置”，不用于装饰。禁止整块发光。

| 场景 | 正确做法 |
|---|---|
| 文本选中 | `fg` 14% alpha 背景，文字颜色不变 |
| 富文本编辑器聚焦 | 1px `border-strong` + `shadow-1`，不要 3px ring |
| 输入框聚焦 | 2px ring，最多 `border-strong` |
| 搜索定位 / TOC 跳转 | 8% `fg` 背景，0.8s 内淡出 |
| 可视化 HTML | 1px `border-strong`，不要蓝色虚线 |
| CodeMirror 选中 | 14% `fg`，不要 22% brand |
| 行内代码 | 5% `fg` 背景，不要像标签一样亮 |

禁止：

- 整个编辑器 / 面板套 `box-shadow: var(--ring)`
- 搜索命中闪蓝光
- 选中文字使用高饱和蓝或高不透明度 brand
- 同时叠加 border + ring + background 三种高亮

## 6. 动效

- 背景 / 边框 / 颜色：120–160ms
- 浮层：160–200ms
- 不做大面积位移、弹跳、无限呼吸
- 尊重 `prefers-reduced-motion`

## 7. 可访问性

- 正文对比度 ≥ 4.5:1
- 小字不使用 `--faint` 承载关键信息
- focus-visible 必须可见
- 图标按钮必须有 title / aria-label
- 不用颜色作为唯一状态信号

## 8. 禁止模式

以下写法不再接受：

- 页面内新增 `#xxxxxx` 硬编码颜色
- 新圆角值不来自 `--radius-*`
- 三层以上“卡片套卡片”
- 每行 4 个以上并列按钮
- 9px 中文正文
- 页面标题 18 / 22 / 26 混用
- 使用 solid 灰边框分隔暗色模块
- 空态只写“暂无数据”
- 在亮色/暗色其中一边单独打补丁，另一边不检查

## 9. 检查清单

改 UI 前：

- [ ] 是否需要新 token？先加 `design-system.css`
- [ ] 是否使用 `PageHeader`？
- [ ] 是否只有一个主面 / 一个 primary？
- [ ] 中文正文是否 ≥ 11.5px？
- [ ] 是否在暗色和亮色都看过？
- [ ] 空态是否有下一步？
- [ ] 行内操作是否收进 `⋯`？
- [ ] 是否引入新的硬编码颜色 / 圆角 / 阴影？

命令：

```bash
npm run typecheck
npm run build
npm run verify:plugins
```
