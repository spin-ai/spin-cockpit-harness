> 层：架构 · 状态：部分落地 · 核对：2026-11-15 · 覆盖：视觉解析插件的界面改造与解析后端配置边界

# Arch · 视觉解析插件（zhulong 验证台 → 本项目）

> 来源：zhulong-vl 仓库的验证台（`web/`，React + FastAPI）。搬过来的是**验证界面与核对逻辑**，不是它的 Pi 对话面板，也不是它的 Python 训练栈。
> 插件宿主能力见 [`ARCH-plugins.md`](ARCH-plugins.md)；知识库契约见 [`ARCH-knowledge.md`](ARCH-knowledge.md)。

---

## 0. 结论

| 决定 | 内容 |
|---|---|
| 搬什么 | 场景切换、选图、**区块框 + 关系线叠加**、区块表、核对项、JSON —— 交互骨架保留，视觉按 [`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md) 重做 |
| 不搬什么 | zhulong 的 Pi 对话面板（`PiChat` / `piStream` / `LlmPanel`）—— 本项目的 Chat / Mission 已经是同一套 thread/todo/run，再搬一套就是两个事实源 |
| 解析在哪跑 | 插件 utilityProcess 只发 HTTP，**不打包 Python、不带权重**；后端在插件设置里配 |
| 界面怎么加载 | **原生 React 视图**（和 Notes 同构），不是 sandbox iframe：P2 的 iframe 通道仍未做，开了必然出现第二套设计系统 |
| 怎么装 | **内置插件**：`plugins/zhulong/` 由 `electron-builder` 的 `extraResources` 打进 `Contents/Resources/plugins/`，随应用安装；`defaultEnabled: true`，装上即启用（它不后台出网，只有用户点「开始解析」才发请求） |

---

## 1. 数据流

```text
renderer  Zhulong 视图（src/components/Zhulong.tsx）
   │  选图（<input type=file> → dataURL，只在内存里）
   │  act("pluginRunCommand", { pluginId, commandId: "zhulong.parse", args })
   ▼
main      PluginHost（electron/plugins/host.mjs）
   │  utilityProcess + RPC（命令 120s 超时；解析本来就慢）
   ▼
plugin    plugins/zhulong/main.mjs
   ├─ 读插件设置（backend / endpoint / apiKey / model / weights / imgsz / conf / relations / ocr / timeout）
   ├─ 按 backend 调 HTTP
   └─ 归一化成 { blocks, relations, checks, size } 返回
   ▼
renderer  叠加图（ZhulongOverlay）+ 核对 / 区块 / JSON 三个页签
```

图片**不落盘**：一次请求进内存就结束，避免截图、证件照被静默留档（与 `npm run verify:privacy` 的口径一致）。

---

## 2. 三种解析后端（插件设置里选）

| backend | 请求 | 适用 | 备注 |
|---|---|---|---|
| `zhulong`（默认） | `POST {endpoint}/api/parse`（multipart：scene / weights / imgsz / conf / relations / ocr / file） | 自部署的 zhulong-vl 服务 | 探测用 `GET /api/health`；不打包 Python 与权重 |
| `openai` | `POST {chatUrl(endpoint)}`（`image_url` + 结构化 prompt，`temperature: 0`） | 任意 OpenAI 兼容多模态 API | 需要填模型名；返回必须能被解析出一个 JSON 对象。地址不要手拼 `/v1`：`…/v1`、`…/api/v3`、`…/api/plan/v3` 都能自动补 `/chat/completions`，贴完整地址也认 |
| `custom` | `POST {endpoint}`，body 为 `{ scene, mime, model, image: dataURL }` | 自己的解析服务 | 期望返回 `{ size, blocks, relations }` |

认不出形状就**报错，不猜**：空 `blocks`、非 JSON、端点缺字段都会直接失败，不返回空壳结果。

**坐标约定只有一种**：线上 `bbox` 是 `[x, y, 宽, 高]`（对齐 zhulong 的 `block.schema.json`），插件在归一化时转成 `[x1, y1, x2, y2]` 再交给叠加与核对。不做「看着像 xyxy 就猜」的容错 —— 猜错会把框拉飞，实测服务返回的 `[418.5, 482.5, 146.8, 120.9]` 就是 `x,y,w,h`。

后端返回的 `checks` 会合并进本地核对项（后端条目排在后），避免「服务说没问题」盖过本地判断。

---

## 2.4 插件进程生命周期与「一直转圈看不到结果」

两个坑都出在「插件 utilityProcess + 宿主」这一段，和模型无关：

| 现象 | 根因 | 修复 |
|---|---|---|
| 空闲一会儿后点解析，界面一直「解析中…」直到 120s 超时 | utilityProcess 的 MessagePort **不 ref 事件循环**，插件空闲几十秒就自己 `exit(0)`；宿主只在 `children` 里删记录，**不拒绝该插件还挂着的命令** | `runtime.mjs` 加 ref 的 keepAlive；`host.mjs` 在 `child.on("exit")` 里把该插件的 pending 全部 reject（`插件进程退出（code），请重试`） |
| 切走视图再回来，图片与结果都没了 | 视图卸载即丢 state | `session`（模块级内存，不落盘）保存图片 / 场景 / 结果 / 页签，重新挂载时恢复 |
| 解析慢到像卡死 | 视觉模型默认开思考：实测同一张图 **12.8s（开） vs 3.0s（关）**，输出 token 621 → 100 | `thinkingParams()`：非 GLM 模型发 `thinking: {type:"disabled"}`；GLM 不发（它 400） |
| 偶发「模型返回的 JSON 无法解析」 | 模型偶尔吐坏一个字符 | 加 `response_format: {type:"json_object"}`（GLM 不发）+ 失败自动重试一次（3s 一次，重试比报错划算） |
| 失败原因看不到 | 组件用 `act()`，异常被吞成 toast，只剩「插件没有返回解析结果」 | 解析/探测改走 `window.harness.action`，真实错误进 banner + toast |
| 结果在画布下方看不见 | 画布 + 表格是纵向流，窗口矮时要滚动 | 成功后滚动到结果区 + toast「解析完成：N 个区块 · X.Xs」；按钮显示已等待秒数 |

## 2.5 火山引擎（Ark）配置与「blocks 为空」的排查口径

实测可用的组合（本机 `~/.pi/agent/models.json` 的 `volcengine` provider 与插件共用同一个 key）：

| 设置项 | 值 |
|---|---|
| 解析后端 | `external API（多模态）` |
| 服务地址 | `https://ark.cn-beijing.volces.com/api/plan/v3`（coding plan key 只能走 plan 网关；标准 `api/v3` 会 401） |
| 模型名 | `doubao-seed-2.1-turbo`（视觉实测通过，一次解析 8–10s）；备选 `kimi-k2.6` / `kimi-k3` / `glm-5-3-flash` |
| 超时 | `120000`（视觉模型 + 结构化输出本来就慢） |

**模型能力矩阵（在 plan 网关上实测）**：

| 模型 | 图像输入 | `thinking.type=disabled` | 备注 |
|---|---|---|---|
| doubao-seed-2.1-turbo / 2-1-pro / 2-1-lite / 2-0-mini / evolving | ✅ | ✅ | 解析首选 |
| kimi-k2.6 / k2.7-code / k3 / k3-code / k3-1-pro | ✅ | ✅ | 结构化输出稳定 |
| deepseek-v4-1-flash / v4-1-flash-economy | ✅ | ✅ | — |
| glm-5-3-flash | ✅ | ❌ 400 | 只能走 `reasoning_effort`，不能发 `thinking.type=disabled` |
| glm-5.2 / glm-5.3 | ❌ text only | ❌ 400 | 不要拿来解析图片 |
| deepseek-v4-pro / v4-flash | ❌（忽略图片，回「无法确定」） | ✅ | 纯文本 |

**「解析服务没有返回区块（blocks 为空）」是什么意思**：请求成功了，但模型没给可用的区块。按这个顺序查：

1. **模型不是视觉模型**（如 glm-5.2 / deepseek-v4-pro）→ 换 `doubao-seed-2.1-turbo` 这类，跑一次「探测视觉解析后端」确认
2. **图里没有可识别内容**（纯色 / 极小图 / 严重模糊）→ 换一张真实截图；接口对图像有最小边长限制（实测 ≥14px）
3. **模型只回了说明文字没回 JSON** → 调低温度（已是 0）或换结构化输出更稳的模型
4. **模型猜错画布尺寸**（见下）不会导致空 blocks，但会让框画偏

**坐标校准**：视觉模型经常自己猜一个画布尺寸（实测把 320×200 的图报成 1600×1000，bbox 也按 1600×1000 给）。插件现在从图片字节读真实尺寸（PNG / JPEG / GIF / WebP），按比例把 bbox 换算回真实像素，并在核对项里留一条「坐标校准」（换算过是 `warn`，一致是 `ok`）。这样叠加层不会把框画到图外面。

## 2.7 易用性入口：粘贴 → 自动解析 → 结果贴身

真实用法是「截个图 → 看结果」，不是「先存文件 → 拖进来 → 点解析」。所以：

| 入口 | 行为 |
|---|---|
| `⌘V`（视图内任意位置） | 读 `clipboardData` 里的图片文件 → 设置图片 → **自动开始解析**（可在「图片」块里关掉） |
| 「从剪贴板取图」按钮 | 走 `clipboard:readImage`（`clipboard.readImage()` → PNG data URL），没有图片时给提示而不是静默 |
| 拖入 / 点击选择 | 同上，选完即解析 |
| `⌘↵` | 解析 / 重新解析 |
| 空态 | 直接写明 `⌘V 粘贴截图，立刻解析`，并给一个「从剪贴板取图」按钮 |

配套的三件事：

- **画布限高** `min(52vh, 560px)`：结果表在第一屏就能看到，不用每次滚半页
- **未配置后端**：进视图就出一条带「去设置 → 插件」按钮的引导，而不是等你点解析才报错
- **解析中**：按钮显示已等待秒数、画布角标写「视觉模型通常 3–30s」；完成后 toast + 自动滚到结果

## 2.8 叠加图缩放（为什么之前点了没反应）

缩放靠「frame 宽度 = 倍数 × 容器宽，图片 `width:100%`，平移交给原生滚动」。两个坑：

| 坑 | 现象 | 修复 |
|---|---|---|
| `.zh-frame` 是 flex 项，默认 `flex-shrink:1` | `width:300%` 被缩回容器宽 → 点 +/− 只有百分比数字变、图不变 | `.zh-zoom-scroll .zh-frame{flex:none}` |
| 父容器 `justify-content:center` + 溢出 | 放大后左边一半滚不到（flex 居中会吃掉负向滚动） | 改 `flex-start` + 子项 `margin:0 auto` |
| 上一轮为了「结果贴身」加的 `img{max-height:52vh;width:auto}` | 直接覆盖 `width:100%`，放大彻底失效 | 删掉；限高只留 `.zh-zoom-scroll{max-height:52vh}` |

验证（打包/开发同构，实测像素）：100% → frame 718px；150% → 1077px；300% → 2154px，`scrollWidth > clientWidth` 且能滚到最右（`scrollLeft` 到 max）；点「适应」回 718px。

## 3. 核对项（不依赖后端，纯本地）

`plugins/zhulong/main.mjs` 的 `localChecks()`：

| 检查 | 级别 | 判据 |
|---|---|---|
| 检测到区块 | 区块数为 0 → fail | `blocks.length > 0` |
| 有文字内容 | 有文字区块为 0 → warn | 任一区块 `text` 非空 |
| 坐标在图像内 | 有越界 → fail；无 `size` → warn | bbox 与 size 的包含关系 |
| 置信度分布 | 低于 0.5 的占比 > 50% → warn | 只统计有 `conf` 的区块 |
| 关系构建 | 架构图场景无关系 → warn | `relations.length > 0` |

设计意图与验证台一致：**把「静默失败」变成可见的弱**，而不是只给一个好看的图。

---

## 4. 配置在哪

`设置 → 插件 → 视觉解析 → 配置`（值存 plugin kv，不写进全局 settings）：

| 键 | 类型 | 默认 |
|---|---|---|
| `backend` | enum | `zhulong` |
| `endpoint` | string | `http://127.0.0.1:8000` |
| `apiKey` | **secret**：不回读明文，且用 `safeStorage` 加密落盘（`enc:` 前缀，启动时自动迁移历史明文）；只显示「已设置」 | 空 |
| `model` | string | 空 |
| `weights` | string | 空（由服务决定） |
| `imgsz` / `conf` | number | 800 / 0.35 |
| `relations` / `ocr` | boolean | true / true |
| `timeoutMs` | number | 60000 |

设置页可以「探测后端」：zhulong 打 `/api/health`、openai 打 `/v1/models`、custom 直接 GET 端点。

---

## 5. 界面

- 左栏：场景（架构图 / 界面截图 / PDF 页面 / 拍照 PPT）· 选图（拖拽或点选）· 参数只读摘要 · 叠加开关
- 入口：插件安装后左侧就出现「视觉解析」（未启用时视图内直接给「去设置 → 插件」，不让入口消失）
- 主区：图面（页头条显示 `宽×高` + 缩放 −/适应/+/百分比，缩放用「相对适应宽度的倍数」，平移交给原生滚动）→ 页签「区块 / 关系 / JSON」
- 区块表与图上双向联动：hover 任一侧高亮另一侧；点框把对应行滚进视野；选中行在表下给一行坐标读数（`x,y · 宽×高`、置信度、文字）
- 核对项可下钻：点「置信度分布 / 有文字内容 / 坐标在图像内」→ 表格切到对应筛选（低置信 / 无文字 / 越界），图上把其余区块压暗而不是隐藏；点关系类核对项 → 跳到关系页签
- 关系页签：逐条列 `从 → 到 · 类型 · 置信度`，区块没有文字时显示「类型 #序号」；点行同时高亮两端与那条连线
- 结果导出收在 tabs 右侧的 `⋯` 里（行内低频操作，不占按钮）：
  - `复制 Markdown`：区块表 / 关系表 / 核对表，文字里的 `|` 会转义，超过 400 行标注「前 400 条」
  - `复制 JSON`：只含 `backend / scene / size / blocks / relations`，不含整包响应
  - `保存到项目`：写到**当前项目根**下 `zhulong/<YYYYMMDD-HHMMSS>-<scene>/`，两个文件 `blocks.json`（含 checks/warnings）与 `result.md`；**不保存图片**（base64 落盘等于把截图留档）
  - `存为资料`：`result.md` 走 `knowledge.ingestText()` 进资料库（`uri` 用 `zhulong://<scene>/<时间戳>`），块级信息写 `userData/knowledge/files/<docId>/blocks.json`；内容相同的解析会被判重跳过
- `交给 Agent`：插件把结构化摘要（场景 / 尺寸 / 待看项 / 前 40 个文字区块 / 前 20 条关系 / 下一步提示）写进 **Chat 草稿**，只填输入框不自动发送——发不发由人决定
- `取消`：解析中主按钮变「取消 · Ns」，主进程发 `cancel` 到 utilityProcess，插件 abort 自己的请求，命令以「已取消」结束，不等超时
- 叠加色全部走 token：区块 `--border-strong`，命中 `--brand`，关系线 `--muted`；亮/暗都靠 token 切换，**没有新的十六进制色值**
- 区块表点击 ↔ 图上高亮双向联动

---

## 6. 明确未做

- **没有块级引用**：解析结果不回写知识库，`docs/arch/ARCH-key-tech.md` 里「zhulong 接入后可升级为块级 bbox 引用」这条**仍未兑现**；Knowledge 的 Reader 契约还是 `Page[] = { page_no, markdown }`。
- **不落 sidecar**：没有 `userData/zhulong/<id>/blocks.json`，也没有 `ingestText()` 落库路径。
- **没有 ONNX 本地推理**：全部依赖外部服务/API；Python + 权重不进安装包（体积与「极小资源」冲突）。
- **没有样例集**：zhulong 验证台的样例依赖它自己的 `samples/` 目录，这里只支持自己选图。
- **没有 Pi 对话**：生成 SVG / 评估界面这一步仍要在本项目 Chat / Mission 里做，插件不提供对话面板。
- **没有批量与队列**：一次一张图，没有批处理、没有历史记录列表。
- **引用仍是页级**：块级 sidecar 已经落盘（`files/<docId>/blocks.json`），但引用的「点开看原页」还没消费它，没有「点引用高亮这个块」。
- **存为资料不落原图**：资料只有 markdown + sidecar，没有 `orig.*`，所以没有页图可跳。
- **没有图片落盘**：保存到项目只写结构化结果与 Markdown，原图仍在内存里。
- **没有取消的二次确认**：点「取消」立即中断，误点要重跑。
- **没有批量**：一次一张图。
- **没有签名的视觉回归**：`scripts/zhulong-selftest.mjs` 只测「后端返回 → 归一化 → 核对项」的纯函数，不比对像素。
- **插件 view 仍是白名单**：`contributes.views` 已通过 state 暴露，但 renderer 里只有 `notes` / `zhulong` 两个注册组件，第三方插件声明 view 还不会自动出现。

---

## 7. 验证

```bash
npm test -- zhulong   # 归一化 / 核对项纯函数自测（不联网）
npm run verify:plugins     # manifest + 入口语法
npm run typecheck && npm run build
npm run verify:design      # token / PageHeader 约束
```

手动验证（不启动窗口也行）：`npm run dev:web` 后在浏览器里打开「视觉解析」；

真实后端联调：先起 zhulong-vl 的 `web/dev.sh`（默认 5173 / 8000），在设置里把 `endpoint` 指到 `http://127.0.0.1:8000`，点「探测后端」应返回可达。
