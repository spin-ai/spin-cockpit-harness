# 主题系统

## 13 套主题

| 分组 | 主题 |
|---|---|
| 跟随系统 | 随 macOS / Windows 深浅色切换 |
| 浅色系 | 浅色、纸感、Light+ 风 |
| 深色系 | 深色、Dark+ 风、Monokai 风、One Dark 风、Solarized 风、Dracula 风、午夜蓝、森林、石墨 |

入口：**设置 → 外观 → 主题**，或 `⌘K → 主题：…`。选择会即时应用并写入本地 SQLite。

## 实现

- `data-theme` 决定调色板；
- `data-mode`（light / dark）决定结构性的深浅色覆盖；
- 主题变量集中在 `src/styles.css` 的 `:root` / 主题块中；
- 新增主题：在 `src/themes.ts` 登记，补一段 CSS 变量，再更新设置枚举即可。

## 终端跟随

- 每个主题都有自己的 `--term-*` 配色；
- 浅色主题使用浅色终端底 + 深色字，深色主题保持深色终端；
- Monokai / One Dark / Solarized / Dracula / Dark+ / Light+ 还带各自的 ANSI 16 色；
- 切换主题时，已打开的 xterm 会通过 MutationObserver 立即刷新，不需要重开标签。

## 编辑器跟随

- Wiki / Notes 的 CodeMirror 高亮、光标、选区、搜索面板、自动补全都使用主题变量；
- 深色主题下不会出现「白底编辑器」的割裂感。
