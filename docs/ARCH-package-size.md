# 打包体积与瘦身

> 目标：**不改变功能与设计**，只去掉打包时的冗余。

## 1. 现状（macOS arm64, v0.2.0-alpha.2）

| 产物 | 体积 | 说明 |
|---|---|---|
| `Cockpit Harness.app/Contents/Resources/dsh` | **309M** | 内置执行引擎（`dsh` 297M + `dsh-rg` 4.3M + helper）——这是体积下限，不可裁 |
| `app.asar` | 11M（原 93M） | 应用代码 + 主进程依赖 |
| `Contents/Frameworks` | 253M | Electron 45 本体（压缩后 dmg 约 100M） |
| dmg（内置 dsh） | **189M**（原 233M） | |
| dmg（瘦身，不带 dsh） | **112M** | `npm run dist:mac:slim` |

## 2. 做了什么

### 2.1 渲染层依赖移入 devDependencies（最大收益：asar −45M）

渲染进程的依赖由 Vite 打进 `dist/`，运行时**不需要** `node_modules` 里的原件：

```
react, react-dom, marked, dompurify, turndown, turndown-plugin-gfm,
@tiptap/*, @codemirror/*, @lezer/*, @xterm/*, grapesjs, codemirror,
@fontsource-variable/geist(-mono)
```

主进程真正需要的只有三项，保留在 `dependencies`：

| 包 | 用途 |
|---|---|
| `sql.js` | `electron/db.mjs` 的 SQLite（wasm） |
| `node-pty` | 终端 pty |
| `adm-zip` | `electron/plugins/host.mjs` 安装插件包 |

### 2.2 打包排除清单（`build.files`）

```
!**/*.map            // 17M 的 sourcemap
!**/*.d.ts / .d.mts / .d.cts
!**/*.md
!**/{test,tests,__tests__,__mocks__,spec,specs,example,examples,bench,benchmark,benchmarks,docs,doc}/**
!node_modules/sql.js/dist/*.zip        // sqljs-all.zip 6.2M
!node_modules/sql.js/dist/*-debug.*   // asm/wasm 调试构建
!node_modules/sql.js/dist/sql-asm*    // asm.js 版本
!node_modules/sql.js/dist/worker*
!node_modules/sql.js/dist/*-inline*
!node_modules/sql.js/dist/sql-wasm-browser*
```

sql.js 只保留 `sql-wasm.js` + `sql-wasm.wasm`（`asarUnpack` 已把 wasm 解出来）。

### 2.3 electron-builder 配置

- `compression: "maximum"`（asar/zip 阶段）
- `electronLanguages: ["en", "zh_CN"]`（裁掉其它语言资源）
- dmg 用默认 UDZO；试过 `ULFO`（lzfse）反而更大（205M vs 189M），已回退

## 3. 瘦身版（不带 dsh）

`resources/dsh` 会被 `extraResources` 无条件带入，所以瘦身脚本在构建期间把它临时挪走：

```bash
npm run dist:mac:slim   # → release-slim/Cockpit Harness-0.2.0-alpha.2-arm64.dmg（112M）
npm run dist:slim       # 只出未压缩 app
```

前提：目标机 PATH 里有 `dsh`（或设置里指定可执行文件）。

## 4. 还试过但没采用的

| 方案 | 原因 |
|---|---|
| dmg 用 lzfse (ULFO) | 实测反而大 16M |
| 运行期解压 dsh | 改变启动路径与首启行为，违背「不改变设计」 |
| 去掉 `LICENSES.chromium.html` | 合规要求，5.3M 保留 |
| 把 dsh 换成 PyPI wheel 动态下载 | 需要联网与校验流程，属功能变更 |
