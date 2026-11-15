# Changelog

所有值得注意的变更都记录在这里。版本号遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### Added（内容 · 抖音介绍视频）
- **按 WorkBuddy 定稿的 11 段第一人称脚本重做**：热点开场（5 个 Agent 上限）→ 我也是这样 → 我写了个东西 → 派活 / 分工 / 场景 / 知识 / 记忆 / 画像 → 五个难点 → 开源；成片约 **60s**、1080×1920、30fps
- **视频生成器**：`scripts/video/`（`scenes.cjs` 11 个场景 / `stage.css` 舞台 / `tts.cjs` 分段合成 / `render-douyin.cjs` 时间线 → Electron 逐帧截图 → ffmpeg / `voiceover.md` + `storyboard.md`）；字幕烧进画面，避开抖音底部 400px / 右侧 120px 安全区
- **配音**：改用 Edge 神经语音 `zh-CN-XiaoxiaoNeural`（`rate +30%` / `pitch -2Hz`），更柔和、现代；后期加轻 EQ / 压缩 / 短空间感。火山引擎适配器仍就绪（`VOLC_TTS_APPID / TOKEN / CLUSTER / VOICE`，`TTS_ENGINE=volcengine`）；Pi Agent 的 `models.json` 里 volcengine 是 **Ark plan 网关**，不含 TTS
- **音乐**：`scripts/video/music.cjs` 纯合成 96 BPM 铺底（Am7–Fmaj7–Cmaj7–G6），人声 sidechain 自动让位，无第三方版权素材；静音版仍保留，方便抖音加热门音乐
- **去个人内容**：记忆 / 画像两段不再用真实截图，改成纯 HTML 合成卡片（`示例数据` / `示例人物`），视频里不含真实联系人、真实笔记、本地路径
- **横版 / GitHub Pages**：`--wide` 输出 1920×1080 横版，`publish-web.cjs` 压成 1600×900 / 4.5MB，落到 `public/video/`；Pages 首页新增 `#video` 区块（`<video controls poster>`），工作流监听 `public/video/**`
- **产物**：竖版配音 / 静音 + 横版 1920×1080 + Pages 1600×900 + 封面 / 海报；母片在 `.preview/douyin*`（gitignore），Pages 版入库

### Added（场景 · 场景库卡片管理）
- **场景库卡片就地增删改查**：`⋯` 菜单里 `重命名 / 复制一份 / 复制为 JSON / 删除`，原来的占位提示换成真实操作；标题双击也能改名（Enter 提交、Esc 取消、失焦提交）
- **删除二次确认**在卡片底部完成（不再弹系统 confirm），每个项目至少保留一个场景；删掉当前场景后自动回落到第一个
- **复制一份**直接复制模板、阵容与呈现偏好；**复制为 JSON** 把 `kind / version / name / template / config` 写入剪贴板，方便备份和分享
- **查得快**：按场景名 / 舞台模板 / 阵容成员搜索，按舞台模板筛选，按最近更新 / 最近创建 / 名称排序；无结果时给「清除筛选」
- 卡片改显示自己的「更新于」与非默认配置标记（免评审 / 不升级 / 注入角色提示 / 隐藏连线 / 隐藏姓名），不再把全局运行统计重复印在每张卡上
- 卡片可键盘聚焦（Enter 进入实况），排列与筛选逻辑收敛在 `SceneGallery.tsx`，写入仍走 `coordinationSceneSave` / `coordinationSceneRemove`

### Added（场景 · 航母 3D 舞台）
- **航母接入 three.js 3D 舞台**：参考 `docs/prototype/carrier-3d.js`，`prefs.template=carrier` 时渲染福建舰甲板、海面 / 夕阳 / 舰载机 / 舰岛 / 升降机 / 着舰道
- **状态映射沿用现有字段**：弹射位 = 并发 `run`，着舰道 = `review / approval` 串行，失败 = 复飞，待命 = 升降机 / 停机区，主控 = 甲板弹射官；姓名牌 + 引线投影定位，点开复用同一个 Inspector
- 角色用舰载机（`j15 / j35`）表示，颜色 / 环 / 姓名牌跟随 `tone`；动效档位 / 走位时长 / reduced-motion 生效；光照跟随应用主题
- 新增 `src/office/Carrier3D.tsx` + `src/office/carrier-scene.ts`，按需加载的 3D chunk

### Added（场景 · 作战室 3D 舞台）
- **作战室接入 three.js 3D 舞台**：参考 `docs/prototype/warroom-3d.html` / `carrier-3d.html`，`prefs.template=warroom` 时渲染透视房间、视频墙 + 3D 地球、长桌、复盘墙、发布闸门与真实角色
- **状态映射不新增字段**：`desk / lead` 在长桌席位，`review` 去复盘墙、`approval` 去闸门、`meeting` 去主屏、`tea / standby` 去两侧；角色颜色跟 `tone`，姓名牌是投影定位的 DOM 按钮，点开复用同一个 Inspector
- 主屏 HUD 由 `model.board / stats` 现画；动效档位 / 走位时长 / reduced-motion 生效；光照跟随应用主题，作战室隐藏四时段「光照」tab
- 新增 `three@0.149.0` 运行时依赖；作战室场景在 `src/office/WarRoom3D.tsx` + `src/office/warroom-scene.ts`

### Added（场景 · 作战室 / 航母舞台原型）
- **作战室舞台原型** `docs/prototype/warroom.html`：长桌 6 席 + 主屏 + GO / NO-GO 发布闸门 + 复盘墙 + 对外同步 / 静默角；点座位与道具打开 Inspector，配置态可看空位与期望拓扑
- **航母 · 电磁弹射原型** `docs/prototype/carrier.html`：2.5D 写实，甲板布局参考福建舰（003）——舰艏 2 条 + 斜角甲板 1 条 EMALS、双升降机、舰岛舷号 18、3 道拦阻索；弹射位对应并发 worker，着舰道对应串行 review；底部「弹射序列」可逐步回放 待命 → 对位 → 通电 → 弹射 → 起飞 → 拦阻 → 复位
- **两个舞台原型改用 `zoom` 整块缩放**（替代 `transform: scale`），1180×560 设计稿在任意窗口下按实际字号排版，文字不发虚
- **流水线（Factory）舞台模板下线**，改为「航母 · 电磁弹射」（`carrier`）：多路并发起飞、单道回收，正好对应 worker 并行与 review / approval 串行；旧场景里的 `factory` 读成 `carrier` 并在保存时写回
- 舞台模板文案收敛到 `src/office/templates.ts`；场景库封面 / 新建弹层 / 执行配置共用同一份标签

### Added（场景 · 航母 3D 仿真原型）
- **航母 WebGL 3D 仿真原型** `docs/prototype/carrier-3d.html` + `carrier-3d.js`：低机位逆光黄昏、程序化舰体 / 飞行甲板 / 舰岛 / 舰载机 / 海面；three.js r149 以 classic script 放在 `docs/prototype/vendor/`，`file://` 双击可离线打开
- **可读的 3D 舞台**：DOM 热点 + SVG 引线跟随相机投影，最多 16 个候选位置做碰撞避让；点飞机 / 人员 / 甲板区打开 Inspector；沿用现有 `zone / pose / tone / seat`，不新增场景字段
- **状态与配置同构**：`待命 → 对位 → 通电 → 弹射 → 起飞 → 拦阻 → 复位` 序列回放；live 10 个角色热点，config 追加 6 个区（CAT 1/2/3、双升降机、着舰道）与光圈；支持 `?mode`、`?seq`、`?detail`、`?select`、`?motion`、`?theme`、`?view`，`?cam` 仅调试
- **材质与海面交互**：甲板防滑颗粒 / 系留点 / 拦阻索 / EMALS 轨道 / 舷号 18；舰体钢板缝 / 锈迹 / 水线 / 舷侧 18；舰岛窗灯 / AESA / 舷号；舰载机面板线 / 红星 / 挂架 / 折翼 / 航行灯；海面只保留水线轮廓、舰岛暖光倒影与随行舰尾流；去掉甲板下整块 deck-shaped rim 板，并删掉舰艏 / 舰尾的 additive Sprite 泡沫——白色 Sprite 在低机位会叠成灰雾；舰体顶/底盖隐藏、舰艏外露的 hangar 平面移除，低机位不再露出灰色长方体；补回薄环 catwalk、海面 shader 近舷泡沫和舰体钢板缝高光；2.5D 舷侧 --hull 也从浅灰压到深灰；亮暗两套主题只换调色板与灯光
- 2.5D `carrier.html` 保留为信息优先的 fallback；3D 版只用于判断「电影感」是否值得进产品，不替换调度

### Added（场景 · 动效工作台）
- **实况页按 `docs/prototype/motion-workbench.html` 重排**：舞台在自己的格子里等比缩放并居中（`zoom`，`k = min(w/1340, h/540)`），Inspector 变成覆盖在舞台上的右侧抽屉；打开抽屉不再挤压 / 裁切舞台
- **时间轴**：记录本次打开后最近 15 分钟的真实状态变化（zone / tone / pose / status 变化才记），可拖动、回放、只看走位；同一秒多个角色变化合并成一片，跨秒记录分两条泳道
- **动效参数外置**：`tier / walk / amp / typing` 存进 `coordination_scenes.config.prefs.motion`，检查器和页头档位改完即时生效
- **检查器**：状态 → 舞台（触发 / 区域 / 姿态 / 动效）、最近一次走位可定位、关闭动效后的等价检查、动效参数与真实操作
- **光照 tab**：同一时刻并排四张舞台（清晨 / 白天 / 黄昏 / 夜晚），点卡片切回实况并写回 `prefs.light`；`dawn` 补进 `CoordinationLight`
- 页头新增动效档位 / 回放状态变化；`?hour=` 隔离预览改成一秒一跳，保留固定起始时段

### Added（场景 · 时段光照与区域划分）
- **舞台光照跟随本地时间**：清晨 / 白天 / 黄昏 / 夜间四档 —— 窗外天空、日月、星空与城市亮灯跟着变；黄昏起顶灯点亮（墙面暖洗 + 地面光斑 + 吊灯光锥），台灯 / 落地灯 / 显示器在夜里提亮
- **区域划分更清楚**：工位区、主控区、审批台、验收架、机房、茶歇区、协调台各有低透明地面色块 + 区域标牌，工位区标牌带当前在座人数
- 场景配置 → 呈现新增「舞台光照」：`自动`（跟随时间）/ `白天` / `黄昏` / `夜间`，随场景存进 `coordination_scenes.config.prefs.light`
- 隔离预览支持 `?hour=22` 固定时段，方便截图核对

### Fixed（知识库 · 整理不再静默改写已审核页面）
- **`wiki.curate` 以前会直接重写所有页面正文**（包括 `reviewed`），而且**一条 revision 都不留** —— 结构整理改坏了只能靠备份。现在只有 `draft` 直接落盘并记 `revision(curate:structure)`；`reviewed` / `stale` 的改动进新的建议队列
- **整理不再删人写的内容**：已有的「要点」条目、夹在「要点 / 相关」里的非列表段落、手写 `[[相关]]` 链接（含前向链接）都原样保留；摘要行不再被当成「原文摘录」
- **建议审核门**（`suggestions`）：提议存完整渲染正文 + `baseHash` + 改动理由；审核侧看逐行 diff，批准 = 纯字节拷贝（不重新调模型）并记 `revision(suggest:<id>)`；页面在这版建议之后改过 → 标 `needs_rebase`，不自动合并；退回记 feedback 留痕
- 插件 API 新增 `wiki.suggestions` / `wiki.suggestion` / `wiki.suggestionResolve`，`wiki.list` 带回 pending 建议；「审核」tab 同时列草稿与建议
- **人工结论（claim）保住「人改的那一句」**：人保存已有页面时把新增的行记成 claim（标题 / 摘要 / 纯双链 / 短句不算，单页上限 40）；整理 / 模型整理若会改写或丢掉其中任何一条，**连 draft 都不自动写**，改成待审建议。判定只有三档（原样 / 改写 / 不见），行级文本 + bigram，不依赖模型；右栏「人工结论」可以看到每条的状态并解除
- 插件 API 新增 `wiki.claims` / `wiki.claimAdd` / `wiki.claimRemove` / `wiki.claimCheck`；`wikiCurateLLM` 落盘前先过 `claimCheck`，会丢结论的页面直接跳过
- **「结论待确认」进审核队列**：`wiki.claimIssues` 按页面聚合 `conflict` / `orphan` 的 claim，`wiki.list` 也带；审核 tab 顶部单列一行（可「查看」/「全部解除」，解除只撤销锁定、不动正文）。以前建议被退回后，右栏的红色结论就再没人提醒处理了
- **人工结论补上生命周期**：接受合并建议时合并草稿接手两边「草稿里确实有」的 claim（`provenance.by="carry"`）；页面进回收站 → claim 标 `orphan` 不删；恢复时按正文重新核对回 `active`。以前删/并之后，人改过的那句话就再没人守了
- `wiki.dream` 退化成 `wiki.maintain` 的兼容壳（默认 dry-run，去掉 `stale-draft` 这种靠时间瞎猜的项），不再有第二套维护入口
- **模型整理（`wikiCurateLLM`）不再直接写页面**：结果变成 `summary` 待审建议（`wiki.suggestSummary`），人看过逐行 diff 才落盘，接受走字节拷贝 + revision；页面在建议之后改过 → `needs_rebase` 不覆盖。缓存改成按「整理前」正文 hash 去重，页面没变不重复花 token
- **漏引用 / 疑似重复也进同一条建议队列**：新增 `wiki.maintain`（确定性扫描，不调模型）+ `⋯ → 查找重复与漏引用`。漏引用判定用 bigram 重叠 ≥ 0.62 且页面还没引用该资料；重复判定要求标题 Jaccard ≥ 0.7 且长度比 ≥ 0.8（或摘要 Jaccard ≥ 0.75）。**接受引用 = 只加出处（正文不动）；接受合并 = 只生成合并草稿（原页面一个字都不动）**；拒绝后 30 天不再提同一条（`sig` 统一节流）
- **`wiki.upsertDraft`（Agent 通道）不再能覆盖 reviewed**：以前它会顺手把 `reviewed` 页面改成 `draft` 并写正文 —— 文档里写的「Agent 不能覆盖 reviewed」因此只是口头约束；现在直接拒绝并提示走审核
- 自检：`npm run wiki:curate:selftest`（计划层：reviewed 分诊 / 幂等 / 不丢行）、`npm run wiki:plugin:selftest`（插件层：假 ctx 驱动真实 API，验字节不变、`needs_rebase` 不覆盖、提议即产物 + revision）

### Changed（人物画像 · 记忆语义）
- **可重算的测量值不再进记忆层**：`describePerson` 的统计结论（话量、句长、接话时延、群/私聊比、活跃时段、高频词……）以前当成事实写进 `observations` 且直插 `confirmed`，绕过了 `resolve()` 的失效逻辑 —— 结果全库 `valid_to` 一条都没写过，同一字段会同时成立「群聊 0%/私聊 100%」和「群聊 1%/私聊 99%」。现在这些值进新的 `measures` 表（只留最新值 + 上一次值 + 变化次数），人物卡多一节「可观测特征」，不再参与冲突/漂移/失效
- **写入收敛到一条闸门 `commit()`**：规则抽取 / 统计 / 模型 / 人工全部走它。同一事实重复观察到时**累加 `evidence_count`**（以前 `addObservation` 直接 `return null`，50 次对话印证过的一句话和模型一次猜测强度完全一样）；单值字段确认后立刻收口同字段旧值；时间敏感事实写 `expires_at`；被拒过的事实攒够两次独立观察才复审
- **四种「忘」拆开**：`invalidate`（`valid_to` 收口，旧值不删、`asOf` 仍可回查）/ `decay`（`heat = confidence × 2^(-天数/半衰期) × log(证据量)`，读时算不落库，事件 7 天、身份 730 天）/ `stale`（TTL 到期归档，进复核队列而不是删除）/ `merge`（近似值建议合并、归一化相同的自动合并，证据累加到保留项）
- **`rejects` 不再永久静音**：又独立观察到两次或距上次拒绝超过 120 天时复审一次，拒绝后计数归零，不会反复打扰
- **注入从「固定字段顺序硬截」改成打分填预算**：`字段优先级 × 热度 × 与问题相关性` 贪心填，每节有配额上限（处事 40% / 性格 30% / 声音 15% / 基本信息 10% / 事实 5%），分节标题也计入预算；`persona_lookup` 会把问题当 query 传下来
- **双时间拆成两种回看口径**：`asOf` 保留「事件时间」（当时什么是真的），新增 `mode:'known'`「当时已知」（`created_at <= at`）—— 2024 年发生、2026 年才得知的事实，在 2024 年的「当时已知」里不该出现

### Added（人物画像 · 生命周期）
- `measures` 表与 `personaMeasures`；`personaSweep`（标 stale，不删）、`personaReview` / `personaReviewResolve`（仍然成立 → 续期；已过期 → `valid_to` 收口）、`personaMergeSuggestions` / `personaMergeApply` / `personaMergeExact`
- **evict 做成读时检索上限而不是回写状态**：多值字段在人物卡里只展示 `heat` 最高的 N 条（`FIELD_CAP`），其余留在库里当证据、不进复核队列 —— 把 400 多条旧语气样本标 stale 会把复核队列灌满，人就不再去清它
- 人物页：卡片多「可观测特征」节（带上次值与变化次数 + 重算时间）、右栏多「衰减与复核」「近似说法」两块、回看支持两种口径、人物头显示证据中位数与「+N 项可观测」，超出上限的分节标「另有 N 条较早」
- **「变了」分成三种**：变化视图里 `drift`（事实被取代）/ `conflict`（同时成立且时间解释不了）/ `trend`（可观测特征变了，不是矛盾）分开标；以前测量值变化只藏在卡片里一行「上次：…」
- **复核可批量**：`personaReviewMany` + 右栏「全部仍然成立」（写回仍是逐条 keep/drop，不删除）
- **启动时扫一次到期事实**（只标 stale），复核队列不用等进「人物」页才出现
- **人物级合并有了入口**：多选 ≥2 人后按钮直接写「合并到『某人』」，观察 / 关系 / 可观测特征并过去、旧名字进 `aliases`，合并完自动跑一遍精确去重（以前只有后端 `personaMerge`，界面上没法用）
- **任务里点名的人会带上画像**：run 启动时若标题 / 描述 / 补充指令里出现联系人名字（≥2 字），注入 ≤600 字画像片段（最多 3 人、敏感项排除）；没点名一个字都不注入。以前画像只能靠 Agent 主动调 `persona_lookup`，等于没人用
- **待确认队列按证据质量分三组**：`quoteVerified` 改成三态（核过 / 核不到 / 没有可用引用），列表头给出「只确认这些」（仅引用核过、非敏感）与「这些直接拒绝」（证据是统计值），敏感项永不进批量动作。本机 142 条 pending = 49 可确认 / 49 核不到 / 44 无可用引用
- **统计特征不再只在建模时产出**：`applyStats()` 成为唯一写入路径，导入完就给「本批发言 ≥10 条」的人算一遍可观测特征（纯统计、零成本）；`npm run persona:stats --apply` 回填历史（本机 118 人 / 1360 项）。以前 264 人里只有 13 人有特征，人物页对绝大多数人是空的
- **存量结论可以回查**：`npm run persona:verify-quotes` 用同一批聊天语料回查旧的模型结论，三类分开报：原话找得到 / **证据其实是统计值**（老提示词把统计喂给模型的后遗症）/ 找不到原话。本机实测 111 条带引用的结论：49 找得到、41 是统计值、8 找不到；前两类已标「引用待核对」，统计值那批在待确认块里单独提示并给「这些直接拒绝」入口
- **建模产出的引用可以核对**：模型说「原话是 X」，X 必须能在它当时看到的样本里找到；找不到就标 `quote_verified=0`、降权 0.6、卡片与待确认队列标「引用待核对」，建模汇总里报「其中 N 条引用核对不到」。不删不拦 —— 但确认前你会看到它
- **建模方法论进到平台里**：新增 `resources/wiki/persona.md`（四种「忘」的判据、measure 与 belief 的分界、建模怎么跑才值、8 条踩过的坑），同时接进 App 内「说明」页（`src/wiki/pages.ts`）和 GitHub Wiki（`scripts/publish-wiki.mjs`）
- **新增 `npm run verify:persona`**：接线自检（人物页 `act("x")` ↔ 主进程动作表 ↔ MCP 工具名，三处手抄，改名字只会静默失灵）+ 导入格式 + 生命周期，一条命令跑完
- **决策辅助不再瞎猜**：`personaAsk` 的兜底原来「命中一个词就算依据」，中文 bigram 下「这个 / 今天 / 同意」到处命中，返回的是一串随机引文。现在要求问题原词（≥3 字）原样命中，或至少 2 个不同词命中且 df 加权分够高，否则明确返回 `found:false`
- **问「他会怎么反应」不再拿语气样本凑数**：没有 decision / conflict / stress / communication 记录时返回 `found:false` 并点名缺哪几项（语气样本回答的是「怎么说」，不是「怎么决定」）
- **一句话概括有时效**：`one_liner_at` + `oneLinerStale`，写完一句话之后又有了新事实/新统计时，人物卡提示「建议重写」（确认待确认事实不算新结论）
- `npm run persona:lifecycle`：临时目录跑四类遗忘语义（失效 / 衰减 / 到期 / 合并）+ 证据累积 + 复审 + 双时间 + 注入预算 + 检索上限，30+ 断言
- `npm run persona:reconcile`：老库一次性对账（统计观察 → measures、单值收口、精确去重、TTL 回填、冲突重算），自动备份、`--dry-run` 在副本上跑
- `npm run persona:preview`：渲染层预览（vite + headless Chrome + mock `window.harness`，不启动 Electron、不抢焦点），跑交互断言并出亮/暗截图到 `.preview/`

### Fixed（UI）
- **`PageHeader` 的 subtitle 用 `<p>` 包 `<div>`**：人物 / 记忆 / 知识库三个页面的头部都传 `subtitle={<div className="notes-stats">…}`，浏览器会提前关掉 `<p>`、把 DOM 拆坏（控制台报 `%s cannot be a descendant of <%s>`）。改成 `<div>`，CSS 已按 class 选择所以样式不变

### Added（记忆 · 写入闸门与注入台账）
- **noise 写入被挡住**：`noteAdd` 现在三条硬规矩 —— 没 `source_ref` 直接拒（`manual` 也得写清谁写的）、超 400 字符拒绝并提示去写页面（以前静默 `slice(0,4000)`）、同一句话去空白标点后哈希去重（重复写不新增行，只 `confidence +0.1` 并换上新来源）。老库自动补 `dedupe_key`
- **注入台账 `inject_log`**：只有 `inject({ runId })` 才落库（记忆页预览不会把「进过上下文」刷成假数据）；run 结束后 `markCited` 拿本轮 assistant 文本回填「这条到底被用到没」，命中就把 `hit_count +1`、`last_hit_at` 更新，进下一次打分。以前公式里的 `log(1+被用次数)` 恒为 0，现在真的有数了（归因很粗，只能分「从没被用过」）
- **`injectionStats()` + 记忆页显示**：最近 20 轮的轮数 / 注入条数 / 被用到条数 / 命中率 / 平均字符
- **晋升边界收口**：`promoteNote` 现在拒绝 `stale` / `rejected` / 已过期 / 无 `source_ref` 的观察（以前只拒 `rejected`，旧结论可以一路抬进每次会话都注入的 L4）

### Added（记忆 · L1 索引）
- **回查不再全量扫内存**：`mem.db` 新增 `transcript_fts`（bigram FTS5）+ `transcript_map`（ref → rowid，用于 upsert）。`openDb` 新增可选 `onTranscript` 钩子，`addMessage` / `updateMessage` / `addEvent` 写入时同步一条；钩子内部包 try/catch，**索引失败不会弄坏业务写入**
- **启动对账而不是全量重建**：`transcriptSync` 清孤儿（会话删了 / 事件是 300 条滚动窗口）+ 补缺失——事件表天然会变少，所以不能拿「条数相等」判断是否重建
- 索引可删可重建（真数据在 `harness.db`）；FTS5 不可用时 `transcriptSearch` 自动回落旧的内存扫，行为不变；片段切在命中词附近（索引的是 bigram、原文在另一列，FTS 自带高亮对不上）
- `npm run db:selftest` 增一节：新增 / 改写消息、新增事件都触发钩子

### Added（记忆 · Dream 合并 / 校正 / 预算 + run_read）
- **`merge`：合并重复观察**（确定性，不调模型）：同 kind 的两条观察，bigram **包含度 ≥ 0.9** 且 token ≥ 4 时产建议；接受后保留 verified / 更新的那条，其余标 `stale`。为什么不用相似度（Jaccard）：短中文句子换个措辞就掉到 0.3，阈值一松就误合并；包含度只认「加词 / 换标点」这类真·同一句
- **`correct`：依据被推翻时回头找观察**：某条结论 `invalid_at` 之后，凡是 `sourceRefs` 支持它的 note 都会产「复核观察」建议（接受 = 标 `stale`，退出注入与晋升队列）。这是「什么应该被推翻」在确定性层面的落地
- **每日建议预算**：`meta.dreamBudget` 按本地自然日计数，默认每天 200 条；用尽后静默返回空，记忆页显示「今日 N / 上限 M」。不花钱但必须有上限——建议一天刷 500 条，人就再也不看复核队列了
- **`run_read`**（IPC `memoryRunRead` / MCP `run_read`）：单个 run 的状态 / 耗时 / token / 错误 + 这轮最多 20 条消息（截断）+ 提到它的关键事件。和 `memory_search` 分工：那个找「哪次提过」，这个看「那一次到底做了什么」

### Added（记忆 · Dream 语义 pass）
- **语义 pass（调模型，默认关）**：一次调用把最近 60 条观察交给模型，找「换个说法的同一件事」（`merge`）和「已经不成立的观察」（`correct`）。三道闸门缺一不可：设置里打开 / 有模型密钥 / 当日模型调用预算没用完（默认 20 次）。**模型说的话不算数**——id 必须存在、merge 的 `keep` 必须落在 ids 里、必须有 reason、同组 id 只入队一次，全部在 `dreamModelSuggest` 里校验；走同一个建议队列与同一个每日建议预算（两笔账分开记在 `meta.dreamBudget`，写的时候一起带上，避免互相覆盖）
- 模型输出解析抽成 `parseDreamItems`（纯函数、可测）：实际见过包 ```json 围栏、前面加解释、直接返回数组三种脏法；解析不出来返回 `null` 以区分「这次没建议」和「乱码」

### Added（记忆 · 渲染层预览）
- **`npm run memory:preview`**：照 `preview-persona` 的做法，vite + headless Chrome + mock `window.harness`，不启动 Electron、不抢焦点。21 条断言覆盖「置顶 / 已失效 · 有新结论取代 / 观察种类与到期 / 注入预览的观察条目与命中率 / 被裁原因 / 两笔预算 / 语义 pass 开关 / 点『标记失效』真的调 `memoryEntryInvalidate`」，并出亮色 + 暗色 + Dream 三张截图到 `.preview/`
- 记忆页细节：观察卡片补种类标签（规则 / 踩坑 / 偏好 / 决定）与「已到期 / 至 MM 月」（完整日期放 `title`，队列行窄，长日期会被截成「存活到 2027/…」）

- **改写建议 `rewrite`**：语义 pass 多一种输出——观察写得太糙时给出改写后的正文。**这是唯一会直接改内容的动作**，所以闸门最严：只对 `status = new` 的观察提（`verified` 是人确认过的，只能走 `correct` / `merge`）；不许引入新事实（新增 token ≤ max(2, 原句 20%)、原句包含度 ≥ 0.5，两条都过才入队）；接受后旧正文先写进 `note_revisions` 再覆盖，随时可回退。建议卡片显示「拟改为」那一版，人看过才生效

### Fixed（记忆 · 注入归因恒为 0）
- **取错了消息角色**：`markCited` 只扫 `role = 'assistant'`，而这个 App 里 Agent 的话是 `role = 'agent'`（`thought` 另算），于是 `cited` 永远是空数组、命中率恒为 0，看起来像「记忆从来没被用过」。改成 agent 的 text + `role = 'tool'` 的实际调用，`thought` 排除（过程独白里什么词都可能出现）
- **判据只有「标题被复述」太严**：拿真实数据（82 条注入、7 轮 run）一跑，强判据命中 **0 次**——run 照着「跑 typecheck」做了，回答里也不会复述那句话。补一条弱判据：从条目文字里抽特征词（反引号片段 / ASCII 命令名，≥5 字），至少命中 `min(2, 特征词数)` 个且最长 ≥6 字才算被用到；同一份数据命中率 0% → 21%
- **旧台账回填**：升级后在启动时把 `cited` 还是空数组、且 run 还能找到的台账补一遍（`logsNeedingCitation`），否则命中率会被旧数据长期拉成 0

### Changed（记忆 · 遗忘语义）
- **四种「忘」拆开**：以前只有一个 `status='archived'`，被「过期 / 删除 / 剪枝 / 冲突」共用。现在 `entries` 增加 `invalid_at / superseded_by / supersedes / valid_from`：事实被推翻时**标失效而不是删除**（旧条目不再注入，但 `entryAsOf(at)` 仍能按时间回看），`entryRestore` 恢复时会一并把新条目上的 `supersedes` 摘掉
- **note 有了类型与存活期**：`kind`（rule / gotcha / guess / preference / decision）+ `confidence` + `expires_at`，按 kind 给默认 TTL（猜测 14 天、偏好 90 天、踩坑 180 天、规则与决定不过期）；人工 `verified` 后清除 TTL，不再自动遗忘。老库自动补列，不用删 `mem.db`
- **`promoteNote` 支持 `supersedes`**：晋升新结论时可以显式声明推翻了哪条旧条目，避免同一主题在 L4 里堆出一串互相矛盾的 active 结论（L4 每次会话都注入，这是「记忆污染」的主要来源）

### Fixed（记忆 · 注入）
- **note 从来没被注入过**：`inject()` 只读 `entries`，Agent 写的观察进不了上下文，Dream 的「晋升」建议等于无源。现在 verified note（≤8 条）与高置信度未验证 note（≤4 条，显式标「未验证」）单独占一块预留预算
- **L1 原文被打进注入**：`layer!='L4'` 把 L1 也算了进去，一条长原文就能吃掉一半预算；现在 L1 硬排除
- **注入排序是手动的**：`ORDER BY sort_order, updated_at` 改成按分数（置顶 50 / 有来源 30 / 层级 / 近两周 10 / 被用过），常数写死不做成配置；每条入选或被裁都能说出原因
- **预算两处不一致**：run 启动写死 6000、UI 与 MCP 用 12000，记忆页显示的「可注入字符数」不是 Agent 实际看到的。现在只有 `meta.injectBudget` 一个来源
- **中文搜不到条目**：`entrySearch` 的整串 `LIKE` 换成 bigram 分词后 AND 匹配（复用知识侧的切分）
- 新增 `npm run memory:selftest`：临时目录跑，断言四类遗忘不串味、L1 不进注入、小预算仍有 note、写入闸门、台账归因、老库补列

## [0.2.0-alpha.3] - 2026-11-14

### Fixed（测试 / 文档）
- **`SC-01` 用例还停在旧场景页**：`ScenePage` 已被 `SceneWorkspace`（场景库 / 实况 / 执行配置 三 tab）取代，用例仍在等 `.scene-page` / `.scene-card` / `.scene-modal`，整轮 e2e 挂着一条红的。重写成对新工作台的断言：三个 tab 都在、场景库有卡、执行配置能写进 `state.scenes`、实况有舞台或空态
- **`docs/ARCH-office.md` 放错位置且没登记**：挪到 `docs/arch/`，补状态头（`部分落地` + 未做清单：作战室/流水线只有模板位、评审门等还没被派活链路消费），修掉两处指向旧路径的链接，并在 `docs/README.md §5` 登记；顺手把 README 里 `ARCH-key-tech` 的状态词从非法值 `进行中` 同步成 `部分落地`。`verify:docs` 现在 0 失败

### Fixed（人物建模 · 统计口径）
- **报错一闪而过，没法定位**：所有 IPC 报错都走 3 秒自动消失的 `toast`（单槽、`white-space:nowrap` + `ellipsis`），报错被截断、被下一条成功提示顶掉，长任务里的失败根本来不及看。新增右下角常驻报错卡（`.errstack`/`.errcard`）：不自动消失、全文可滚动、带动作名 + 时间 + 「复制」、堆 5 条、同句话 10 秒内去重；成功提示继续用 toast。`harness:toast` 里明显是失败/异常的文案也进报错卡；暗色下卡片按 `color-mix(--red, --surface-hover)` 抬高对比，顺带修掉暗色 toast 文字用 `--page-canvas` 的低对比
- **建模静默「0 人出卡」**：`personaModel` 调 `analyzePersonWithLLM` 只认 `process.env.ARK_API_KEY`，从 Finder/Dock 启动的 App 没有这个变量，每人立即 `return null` → 整轮跑完显示「0 人出卡 · 0 条结论」，不计数、不报错（实测：54 人 136 秒跑完，因为一次网都没发）。改为 `arkKeyFromSettings()`（设置里的 `ARK_API_KEY`，回落 `resolveArkKey`）；真缺 key 时直接报错并指路「设置 → 执行 → 模型密钥」
- **分析缓存会被「空结论」永久污染**：旧逻辑只要卡片能解析就写缓存 + 写一句话，模型换输出结构（如 traits 从对象数组变字符串数组）时一条结论都落不了库，之后同一份样本永远命中缓存、卡片永远只有统计事实。现在只有模型真给出可用结论才写缓存；缓存键加入 `ANALYSIS_CACHE_VERSION`（`v2`）+ 模型名，旧版本写出的空缓存自动失效
- **「一键全部建模」被假缓存挡住**：`personaModelPlan` 原来只看「有没有缓存」，样本变了也说「预计 0 次调用」并直接 return；改为与 `personaModel` 共用 `analysisCacheHash`
- **建模失败不可见**：`failed` 从未渲染；完成提示 / 进度卡现在显示「N 人未出结论：首个原因」与「缓存跳过 N 人（前 3 个名字）」
- **`ARCH-key-tech.md` 状态词不合规**：`进行中` 不在 `已落地 / 部分落地 / 提案 / 记录 / 已取代` 里，`verify:docs` 一直红；改为 `部分落地`

### Changed（可读性 · 跟随屏幕）
- **字号整体上调一档**：`styles.css` / `design-system.css` 里 626 条 `font-size` 重排成阶梯——正文 13 → 13.5px，列表主行 12 → 12.5，次级 11.5 → 12，元信息 11 → 11.5，辅助 9.5–10 → 10.5–11。此前 9–11.5px 占了 506/682 条，和 `DESIGN-SYSTEM` 自己写的「中文正文 ≥ 11.5px」不符，也是「整体偏小」的直接原因
- **界面缩放改成默认「自动」**：`uiScale = 0` 时按**窗口所在屏幕**的最长逻辑边取 90 / 100 / 110 / 120 / 130%（4K 原生 130%、2K/2560 120%、1920 110%、小屏 90%），拖到外接屏、改分辨率、插拔显示器都会重算；设置里可固定 80–150%，⌘+ / ⌘- 手动步进、⌘0 回自动
- **窗口默认尺寸跟着屏幕**：`min(1500/980, 90% 工作区)` 并居中，`minWidth/minHeight` 跟着屏幕收（1280 宽的屏不会再让 1180 的最小宽度把人挤到屏幕外）

### Added（任务详情 · 终端区）
- **终端区域新增「任务」视图**：工具栏 `终端 / 任务` 切换，选中任务后能看描述全文、验收清单、最近运行（状态 / 耗时 / token / 错误）、环境（目录 / 分支 / Agent / 终端数）与产物，可「打开会话」「复制详情」；TODO 行内新增「详情」按钮直接切过去。视图只切显隐，**pty 不卸载**（切回终端标签、滚动位置都在），实现见 `src/components/TaskDetail.tsx` + `TerminalPanel` 的 `slotView`
- **任务详情排版**：标题/状态/标签分三层（key·项目·Agent → 标题 → 状态+优先级+标签），操作收到右上；运行记录改成对齐表格（状态 / 结束 / 耗时 / Token / 备注），窄宽度自动折成「一行指标 + 一行备注」；产物同理。布局走**容器查询**：`.task-detail` 默认单列，容器 ≥760px 才上右侧信息栏——终端区常态只有 300–600px，用窗口 `@media` 永远命中宽屏分支。TODO 行标题限两行、行内按钮间距收紧，四个快捷操作不再换行

### Added（统计 · 人物）
- **统计页「本季度」**：自然季度（1/4/7/10 月 1 日起，不是过去 90 天），趋势按周分桶且只画已过完的周、面板标题变「每周运行」，副标题带 `2026 Q4`；`src/components/Views.tsx`
- **人物页「忽略缓存重跑」**：`⋯` 菜单，强制对前 12 人重新调模型（删过结论、或旧版本写出空缓存时用）；`personaModel({ ignoreCache: true })`

### Removed（清理冗余）
- **死代码**：删 `src/components/PreviewPanel.tsx`（375 行，已被 PreviewSurface 取代）；删 20 个无人引用的导出（`missionOfRun` / `missionProgress` / `MAX_EVENT_LOG` / `safeId` / `bumpMemoryVersion` / `SUPPORTED` / `modelCard` / `signatureOf` / `sourceText` / `COLUMNS` / `money` / `FINISHED` / `PanelExpandIcon` / `NoteIcon` 等）
- **死样式**：`styles.css` 删掉 80 条规则 + 6 组里的死选择器（旧 topbar/sidebar/board/detail/kv-* 等原型遗留，~98 行）；`design-system.css` 摘掉 5 个死选择器；删掉不生效的 `.md-flash` 闪烁
- **重复实现**：`timeAgo` 三份合一（`ui.ts` 新增 `relTime`）、`STATUS_LABEL` / `statusTone` 两份合一、`basename` 删掉未用的一份、`main.mjs` 里「选 Agent 并钉到 thread/todo」的重复块抽成 `bindChatAgent`、一行重复注释
- **e2e 脚本**：5 个手抄 CDP 客户端的脚本改用 `scripts/e2e/harness.mjs` 的 `attach()`，共减 ~110 行；顺带修掉两处过期断言（`.page-head` → `.page-header-sub`、`.md-render` → `.md-editor-surface`）
- **静态资源**：删 `public/wiki` 6 个未引用的 svg（124K，构建后还会进 dist）、`resources/icon-gauge.png`、`resources/icon-legacy-y.png`
- **本地构建产物**：清掉 `release/mac-arm64`（747M）、`release/e2e`（9.3M）、`dist-pages`（6.7M）

### Fixed
- **`epub2` 只 import 没声明依赖**：EPUB 导入必然 `parser-missing`，现在补进 `dependencies`（3.0.2），`builtin` 引擎的 epub 能力真正可用
- **`tsconfig` 打开 `noUnusedLocals` / `noUnusedParameters`**：清掉积压的 22 处未用变量/导入，之后不会再长回来
- **Markdown 目录跳转**：`renderMarkdown` 生成的标题 `id` 被 TipTap 丢掉，目录点击定位不到；给 heading 加 `id` 属性（`HeadingWithId`）后恢复
- **可视化编辑器 API 在打包版不可见**：`window.__grapes` 原来只在 dev 暴露，E2E 跑 dist 时拿不到；改为始终暴露（渲染进程内部对象）
- **文档漂移**：`ARCH-settings` 的导航（6 个分区 → 实际 10 个）、「设置搜索未做」、`ARCH-wiki-retrieval` 引用的不存在脚本 `eval-wiki-ask.mjs`、`ARCH-plugins` 的 `net:https` → `net`

### Security
- **资料库默认不再向云端发任何内容**：`createKnowledge` 的 `embed` 默认从 `true` 改成 `false`，云端向量索引改成显式开关（设置 → 数据 → 出网边界，`knowledgeCloudIndex`，默认关）。此前只要求机器上有 `ARK_API_KEY` 或 `~/.pi/agent/models.json` 里有任意 provider 的 key，导入资料就会把**整份文档分块正文**发到火山方舟
- **不再借用别的应用的 key**：`resolveArkKey` 删掉 `~/.pi/models.json` / `~/.pi/agent/models.json` 扫描，只认显式传入与 `ARK_API_KEY`
- **修掉 `wiki.ask` 把整段 dshEnv 当 Bearer**：`resolveArkKey(整个 env 文本)` 会把 `A=1\nB=2` 当成 API key 发出去，现在只解析出 `ARK_API_KEY` 那一行
- **插件 `ctx.api.net.fetchJson` 加权限门**：未声明 `permissions: ["net"]` 的插件直接 `permission denied`（与 `fs:*` / `tasks:*` 一致）
- 资料页侧栏常驻「索引模式」说明，每份资料标「本地索引 / 云向量」，远端解析引擎面板明示「整份文件会上传」；`knowledge:selftest` 新增 `[1.5] 出网边界`（默认模式 fetch 调用数必须为 0）

### Fixed
- **浅色主题文字看不清**：`--faint` 在亮色下只有 **2.52:1**（AA 要求 4.5:1），全应用的小字/辅助信息都靠它。三个亮色主题一起改：`light` faint `#a3a3a3 → #6f6f6f`（5.02:1）、muted `#696969 → #525252`（7.81:1）；`paper` faint `#aaa294 → #6c6659`（5.39:1）、muted `#857e71 → #655f54`；`vslight` faint `#a0a0a0 → #6f6f6f`、muted `#717171 → #686868`。暗色同步把 faint 从 3.78:1 抬到 5.19:1
- 知识库侧栏的资料副标题、分组标题，以及「资料」页文档行的引擎/页数行从 10px 抬到 11px

### Added
- **界面缩放**：设置 → 外观「界面缩放」80–150%，或 ⌘+ / ⌘- / ⌘0（终端聚焦时这组键仍调终端字号）。`setZoomFactor` 整窗生效，启动时按设置恢复
- **窄窗口 / 放大后不再横向溢出**：`body` 去掉 1180px 硬下限（窗口本身已有 minWidth）；工作区四个侧栏按可用宽度等比收缩，固定列保底 140–180px；`≤1080px` 隐藏 TODO/项目头的次要链接与 `≤900px` 再收一级，避免「前 项」「添 加」被挤成竖排；Chat composer 在窄面板下改为换行而不是把模型选择挤出面板

### Changed
- **知识库页不再自带「问知识库」**：问答归 Chat，页头按钮改为「在 Chat 中问」（跳工作区 Chat，预填「只基于本地知识库回答 + 页面引用」）；资料 tab 里保留的只是检索式问答（范围三档 + 页码引用），不再和 Chat 抢心智

### Added
- **模型整理知识库**（`wiki.curate.llm`）：新按钮「模型整理 (N)」逐页调用 Ark 重写摘要与要点，只改这两段、原文摘录与 reviewed 页面不动；按正文 hash 缓存、确认框标页数、结果回显实际 tokens，无 key 时明确报错。纯函数在 `electron/wiki-curate.mjs`，`npm run wiki:curate:selftest`（24 项，加 `-- --ark` 可跑一次真实调用）
- 头部的「整理知识库」改名为「整理结构」，和模型整理区分开：前者免费秒级只重排大纲

### Fixed
- **知识库左栏点一下就置顶**：页面列表内嵌了「最近 4」分组，而 `openPage()` 每次都 `wiki.touch` → `recents.unshift()`，于是点哪页哪页就跳到最前面。现在去掉内嵌分组，列表沿用插件原顺序（新建的在前）并保持稳定，打开页面也不再写 `wiki.touch`（用调试端口在真实数据上复现并验证）
- **人物列表也同样不再跳位**：`peopleList` / `profile` 原来按 `updated_at` 排序，建模或改写「一句话概括」会刷新它，导致刚操作过的人在左栏跳到最前面；改成按 `created_at` + 姓名排，前端刷新时也锁住已有行位置
- **人物导入崩溃**（`people` 表 11 列、INSERT 只给 10 个值）：`one_liner` 列是后来 ALTER 加的，`upsertPerson` 还在用无列名的 `VALUES (?,…)`；改成显式列名，以后再加列也不会再踩
- **资料左栏「集合」顺序固定**：原来按资料顺序取前 4 个 parser，资料一重排集合就跟着挪；现在按数量降序 + 名称固定排序
- **资料列表在任何操作后不再重排**：`listDocuments` 原来按 `COALESCE(indexed_at, created_at)` 排序，而「重新解析 / 换引擎」会刷新 `indexed_at`，于是被操作的那份资料会突然跳到最前面；现在按导入时间排序（`created_at` + `rowid` 兜底），操作只更新索引状态、不再影响顺序
- **勾选集会自动清理已删除的资料**：删除后 `checked` 里残留的 id 会让「只基于勾选的 N 份资料」虚高，现在 `load()` 时对齐现有资料，预览中的资料被删也会退回提问视图

### Changed
- **主库换引擎**：`harness.db` 从 `sql.js`（WASM，每次 persist 整库 `export()` + 写盘）换成内置 `node:sqlite` + WAL；写入走事务与 prepared statement 缓存，`undefined` / `boolean` 参数统一归一化。4720 行的一份库，落盘 p50 **26.8ms → 7.3ms**（`npm run db:bench`）
- **落盘不再可能杀主进程**：`persist()` 定时器内写失败会 rollback + 记日志，下一次 persist 重试；退出时 `flush()` 会把 WAL 合并回主文件再 `close()`，`导出数据库备份` 仍然是单文件
- `sql.js` 从 `dependencies` 移到 `devDependencies`（只给基准脚本用），打包裁剪规则与 `asarUnpack` 的 wasm 条目一并移除
- 新增 `npm run db:selftest`（往返 / 参数归一化 / WAL 合并 / 单文件备份 5 项）与 `npm run db:bench`（sql.js vs node:sqlite 落盘对比）

### Added
- **人物建模**：新增 `electron/persona/model.mjs` + `personaModel` —— 从聊天记录算可观测特征（话量/句长/回复时延/提问与礼貌用语/笑声与表情/活跃时段/高频词/群私聊结构/最常互动的人），带证据原话写入 observations；可选 Ark 生成人设卡草稿（写入 pending）；人物页新增「建模」按钮
- **记忆工具补齐**：条目搜索 / 降级（修正方向 L4→L3→L2→L1）/ 过期-恢复 / 来源查看 / note 晋升 / 批量验证 / 注入预算可调（持久化）/ Dream 可关闭且限制单次建议数 / 整库导出 Markdown；MCP 新增 `memory_entry_write`、`memory_promote_note`
- **人物（原「人像」）改成人物建模页**：左栏人物列表常驻、中间是唯一人设卡、右栏是复核队列 / 变化与矛盾 / 注入预览 / 决策辅助；主 CTA 从「导入聊天记录」改成「确认待确认」，导入收进次级入口
- **人物字段扩到五组**：新增处事方式（`decision` `conflict` `stress` `commitment` `communication`）与说话风格（`style` `voice`）——旧字段全是陈述性事实，回答不了「他会怎么反应 / 怎么说」；旧库不用迁移
- **人物卡 / 注入 / 漂移**：新增 `personaPeople` `personaCard` `personaInject` `personaDrift` 四个动作；卡片每节带 quote 证据与置信级别，敏感观察不进卡也不进注入，注入按预算逐条裁剪
- 左栏导航与文案统一用「人物」，避免和头像 / 人像摄影混淆

### Added
- **微信 key 获取脚本**：`scripts/wechat-key-macos.sh` 串起「Frida Gadget + 调试副本」路线（clone → sip.prepare → keys.hunt → decrypt），`--dry-run` 先看命令、`--yes` 才执行；`docs/product/DATASET-wechat.md` 写清 hardened runtime/SIP 为什么挡住 lldb、以及三条路的取舍

- **知识解析引擎注册与路由（K1）**：借鉴 WeKnora `EngineRegistration` / `NewReader`，新增 `electron/knowledge/engines/`（注册表、路由、独立超时、统一 `Page[]` 归一化）；接入自建 MinerU（V1 + legacy）、MinerU Cloud、自建 PaddleOCR-VL、PaddleOCR-VL Cloud，以及 `custom` / `extras` 自研 HTTP 引擎；知识页新增引擎状态、默认引擎、端点/密钥/超时配置；`npm run knowledge:engines:selftest`
- Super Agent / Mission 模式：主管 Agent（`role=supervisor`）、Plan Card 人工审批、child Todo + Delegation + worker run、Mission 面板与收件箱
- Mission MCP：`electron/mcp-bridge.mjs`（stdio ↔ Main HTTP）+ `mission_plan` / `task_delegate` / `task_review` / `task_steer` / `task_retry` / `mission_finish`
- Mission 调度：worktree 并行、依赖 `blockedBy`、Supervisor/子任务并发上限、Mission 时长预算、取消级联、重启恢复
- `dsh-supervisor.patch.yml`：关闭 dsh 原生 subagent / Team / workflow，保证 Mission 单一调度源
- `npm run verify:mission`：SQLite + MCP bridge + dsh supervisor profile 的 keyless 验证
- 应用内「说明」页 + `docs/guides/USAGE-super-agent.md`：Super Agent 从准备 Agent 到确认 Mission 的完整使用路径、常见问题与限制
- 终端：预览标签可拖入 split 窗格（左/右/上/下），终端右键「在右侧打开预览」；预览成为可拆分的 pane
- 插件宿主：utilityProcess 插件、manifest、命令、事件、storage、设置页、目录安装/启停
- Wiki 内置 first-party 插件：原生 Source / Page / Citation / Review、Memory 顶层索引 + run prompt 注入、Dream 维护检查、CodeMirror 编辑、多 tab、可拖拽左右分屏、布局恢复、搜索、Graph、Wiki MCP tools、任务 / Chat 联动；恢复「打开本地目录」，可浏览 / 编辑 Markdown 并导入为 Source

### Added

- **Chat 进度可见性**：运行状态固定在消息滚动区上方，不再只在「滚到底部」时出现；显示当前阶段（执行命令 / 读取 / 修改 / 搜索）、已用时间、步数、最近动作，可展开完整步骤
- **Chat 对齐 DeepSeek 网页对话**：消息阅读列居中（宽面板最大 760px）、助手 Markdown 支持标题 / 列表 / 引用 / 分隔线、思考过程默认折叠、助手消息底部复制 / 重新生成、空态快捷任务卡片
- **WADE 开发环境迁移**：从 YieldMind 迁入 `.wade.yml`（worktree / feature-plan label / PR 流程 / bot review），模型切换到本机已认证的 DeepSeek，新增 `npm run verify:wade` 预检（配置 / 模型 / label / git 身份）
- **场景工作台**：每个项目一份文字场景配置（worktree / runtime / agent / concurrency / acceptance / notes），支持校验、AI 建议、项目进展与终端总览
- **运行时与终端元数据**：`runtimes` 派生视图（host + CLI + caps + 模式 + 可用性）、`terminals` 持久化（项目 / 任务 / run / agent / cwd / 状态 / exitCode / 最近输出）
- **多 Agent 并行**：普通 TODO 可选多个 Agent，每个独立 run / worktree；终端 Agent 自动开标签；Chat 可选择纠偏目标 run
- **分配预览 / 纯聊天 / 全局进展**：Chat 派活前建议、只聊会话、可选范围的进展 dock
- **场景与 worktree 策略**：`worktree: auto | always | never`，项目 Scene 覆盖全局；任务行可打开 / 清理 worktree
- **Mission terminal child**：Mission 子任务可使用终端 Agent，退出后结算 delegation
- **Wiki 存储拆分**：`wiki-index.json` 轻量 metadata + `pages/<id>.md` / `sources/<id>.txt` 正文分片 + `wiki-search.json` 搜索索引；单页按需读，旧 `wiki.json` 自动迁移并保留 `.bak`；1000 页面实测 list 23ms / search 5ms / 单页 1ms
- **Wiki 增强**：问 Wiki（本地检索抽句 + 引用）、收藏 / 最近、标签筛选、`#tag` 点击、双链 hover / 红链创建 / 反链上下文 / unlinked mentions / 图谱筛选、Markdown/PDF 导出、全量本地导入
- **快速记录独立小窗**：`⌘⇧K` 不切主窗口，剪贴板预填，直接存为 draft
- **统计 / 设置 / 数据迁移**：统计按 runtime 分组；设置增加 worktree 默认与 Runtime 视图；新增 `scenes` / `terminals` 表与 run 的 runtime / worktree_cleaned 迁移

### Added

- **知识视图**：`src/components/Knowledge.tsx` 接上已有知识索引——导入 PDF/Office/EPUB/网页、一条查询同时返回资料与页面、带页码引用的问答；删除资料会把引用它的页面标 stale；新增 MCP 工具 `knowledge_search` / `knowledge_ask`
- **记忆四层 + Dream 五动作**：`electron/memory`（L1–L4 / note / suggestions / rejects），run 启动按预算注入 L4 并可查看「本次注入」；Dream 产出 校正/构建/补洞/晋升/剪枝 建议，接受即执行、拒绝不再打扰；新增 MCP `memory_inject` / `memory_search` / `memory_note_write`
- **人像记忆**：`electron/persona` 导入聊天导出 → 规则抽取进待确认 → 三层画像 / 时间线 / 冲突标记 / 决策辅助（无证据返回未知 + 可用关系）+ MCP `persona_lookup`
- **即时通信网关**：`electron/im`（Telegram 长轮询 + 飞书/微信 webhook 出入站），消息进入同一套会话，结果三段式回传、审批用数字回复；设置新增「即时通信」分区
- **`wiki.ask` 走模型**：有 Ark key 时用知识库页面作候选集生成带引用答案，失败自动回落到检索式

### Fixed
- 修复：终端创建报 `posix_spawnp failed` —— `node-pty` 的 `spawn-helper` 丢失执行位（644）；新增 `scripts/fix-pty-perms.mjs`（postinstall + electron-builder afterPack 都会修）、`npm run verify:pty` 体检，并在 E2E 增加 TERM-01 用例防回归
- 修复：`knowledgeIngestText` 传错字段（text→markdown）导致粘贴资料 0 chunk、搜不到
- 修复：删除资料时页面标过期用 doc id 比 uri，永远不命中；改为按文档 uri/标题匹配
- 修复：`wiki.ask` 模型回答没有 `[[页面]]` 时仍报 found=true，现按引用判定
- 修复：IM 网关启动时若未启用就不再监听，改设置后需要重启才生效；现在 im* 改动会重启网关
- 修复：IM 入站没有出站通道时直接抛错导致消息丢失；现在入站照常落任务，回执可选
- 修复：IM 消息在无可用 Agent 时被丢弃；改为落「待执行」任务并提示等你派活
- 修复：终端 ⚠ 卡住标记按 cwd 匹配会误报；改为 running + todoId 匹配
- 修复：记忆注入预算过小时把 L4 全砍掉；改为至少保留一半预算

- 终端 5 分钟无输出标记 `stalled` 并在标签显示 ⚠；手工终端接入任务可选择保持目录或切到 worktree
- `dshEnv`（含 API key）改用 `safeStorage` 加密存储，启动时自动迁移明文

### Changed

- **Chat 可编辑已发送消息**：用户气泡 hover 出「复制 / 编辑」；编辑后 `⌘Enter` 保存并发送 —— 任务没在跑则按新文本重发（新 run `trigger=edit`，消息重新绑定），正在跑则作为纠偏投递；顺手修掉 `regenerate` 没用上 `lastUser` 导致重跑 prompt 为空的问题
- **编辑后重发不再「结果跑错位置」**：新增 `messages.superseded_by`，编辑时把它之后的旧回答/旧追问软置为已被取代（不删数据），新回答紧跟在编辑后的提问下面，会话里留一条「替换其后 N 条消息」
- **修复存量会话的问答错位**：早期「编辑后重发」只改了文本、没隐藏旧回答，启动时 `repairEditedThreads()` 对每个 edit run 补标 `superseded_by`（幂等、不删数据），历史会话也恢复成「问题 → 新回答」

- **中断收口**：应用退出 / 重启时仍在跑的 ACP run 会被结算为 `interrupted`（退出时立即结算，启动时兜底扫描），`endedAt` 用最后一条消息时间，任务回到待执行并在会话里留一条 system 说明 —— 不再出现永远「进行中」的僵尸 run

- TODO 收敛为 4 组（待执行 / 进行中 / 待确认 / 已完成），新增「待处理」筛选；等待输入置顶高亮，已完成组可撤销确认
- 移除独立收件箱页，待确认 / 失败 / 等待输入统一进 TODO「待处理」；导航与设置里的收件箱入口同步移除
- 终端新增「＋ Agent」：不先建任务即可起原生 CLI Agent；终端可「接入」当前选中任务，运行进入 TODO
- 任务行显示当前 / 最近 run 的 worktree 分支与路径，点击在 Finder 打开
- 预览 Surface 补齐后退 / 前进 / 停止 / 硬刷新 / 缩放 / 页内查找 / DevTools / 外部打开 / 设备宽度
- LLM Wiki：停笔 1s 自动保存；删除页面 / 资料进回收站，可恢复或彻底删除；`⌘⇧K` 全局快速记录；中文按字模糊搜索；`#标签` 补全
- **Wiki 视觉收口**：页面改用 `PageHeader`，低频动作收进 `⋯`；左栏 / 编辑面 / 右栏合成一个主面（hairline 分栏）；编辑器改无衬线单栏 660px、隐藏行号、取消整行高亮；字数与保存状态下沉到底部状态条；右栏统一中文标签与 tabular 数字；图谱按 页面 / 资料 / 文件 分级着色
- **Wiki 页头找回常用动作**：导入资料 / 生成 Wiki / 整理 Wiki / 问 Wiki 回到页头直接可见，`⋯` 只留本地目录 / 图谱 / 记忆 / 分屏 / 导出（仍只有一个 primary）
- **全站视觉收口**：语义色 / 中性色 / 圆角全部改走 Design System token（`--green/--amber/--red/--purple`、`--radius-*`、`--surface-hover`、`--faint`），暗色不再单独硬编码；选中与运行色从蓝色收成中性 `--brand`；`.page-head` 标题统一 22px；按 CDP 文本审计把 13 处内容型中文提到 ≥11.5px
- **Chat 思考与工具可读**：`tool_call` 消息首行改成 `Bash · 完成 · ls -1`（状态中文化、带命令/路径），把 `tool_call_update.content` 里的输出并入正文；思考过程（`agent_thought_chunk`）从折叠工具组拆成独立「思考」块，默认两行可展开
- **Chat 详情面板可拖选**：展开后冻结计时、历史行按 10s 粒度刷新，展开时把面板带进视野 —— 拖选文字不再被每秒重渲染打断
- **Chat 详情更有料**：老消息的 `bash · completed` 在渲染时归一化成「Bash · 完成」并补上命令/路径第二行；默认最近 6 步，可「看全部」展开该 run 的所有步骤
- **Chat 运行中进展可见**
## [0.2.0-alpha.2] - 2026-11-07

### Added

- **Git / Source Control**：独立 Git 页（分支 / ahead-behind / 暂存 / Diff +N -M / 提交（⌘Enter）/ Amend / 推送 / 拉取 / 分支切换与新建 / 最近提交 / 非仓库一键 init）；右侧栏新增 Git 迷你面板（会话历史旁）；资源管理器带 git 装饰（修改·新增·暂存·删除着色，`.gitignore` 文件与目录淡色斜体，目录有改动显示状态点）
- **文件预览**：Markdown 富文本 / 源码切换 + 目录（TOC，跳过代码围栏，点击跳转高亮）；HTML 预览 / 可视化 / 源码三段，可视化内建 **GrapesJS** 画布（拖组件、改文字、调样式，保存回写完整 HTML 并保留 head，CSS 写入唯一 `<style data-grapes>`；懒加载）
- **缺模型密钥的可操作引导**：Chat 错误卡片列出要设的环境变量与两种配法，一键跳到 设置 → 执行 → 模型密钥 并聚焦；设置里新增 `dshEnv`（KEY=VALUE 注入本地 dsh）；统计页失败行也可直接去配置
- **设置易用性**：跨分区搜索（⌘F，命中跳转并高亮）、逐项「恢复默认」、本页恢复默认、「已自动保存」提示、分区 ↑↓ 导航
- **主机与统计**：主机 caps 探测 / 页面可见时心跳 / 主机级并发 / Agent 运行位置；统计改为运行健康口径（成功率 / 中位耗时 / 排队 p50 / Token（未上报不写 0））+ 趋势 + 4 类失败 + 分组 + 下钻 + CSV
- **TODO**：多行收集箱批量建任务（去前缀/去重/上限 100）、行内编辑（标题/描述/验收/优先级/截止/标签）、分配执行 Agent、「问清楚」预填 Chat

### Fixed
- **Wiki/Chat 顺序相关修复**：`recoverMissions` 把 todoId 误写进 `messages.run_id`，导致会话出现 `run-divider t168` 假分隔条与孤立系统消息（改为写 run.id，启动时清理历史遗留）；安装脚本对残留进程补 SIGKILL，应用加单实例锁，避免旧窗口一直显示旧界面
- **进展条回到消息流末尾**：发完问题后进展不再出现在面板顶端（和提问之间隔着上一轮回答），改为紧跟最新一条消息，回答就落在同一位置；顶部只保留头部的「进行中 · 停止」

- 切到收件箱 / 统计再回工作区时终端丢失（工作区改为常驻挂载、只切显隐）
- TODO 编辑提示文案移除（保留双击 / ⌘E 与行内「编辑」按钮）

### Changed

- 产品名统一为 **Cockpit Harness**（窗口标题 / 安装包 / ACP 客户端标识），旧 userData 与 `ymh.*` 本地键自动迁移
- 依赖升级：electron 45 / TypeScript 7 / Vite 8（rolldown）
- 文档：`docs/arch/ARCH-hosts-stats.md`、`ARCH-git.md`、`ARCH-terminal-ux.md`（预览与可视化）、`ARCH-settings.md`（易用性）；知乎文章与对比截图改为本地素材不入库

## [0.2.0-alpha.1] - 2026-11-06

首个公开 Alpha，代号 **Liftoff**。

### Added

- Chat 分派 → TODO → Agent run 的完整闭环；支持 steer / 排队 / 停止 / 重试
- 终端：多标签、任意窗格拆分、拖拽比例、窗格焦点切换
- 终端：查找高亮、右键菜单、链接打开、字号缩放、退出重启、挂载前输出回放
- 预览：dev server 预览与本地 HTML 文件共用一个 `PreviewSurface`，支持渲染/源码切换、元素拾取
- 文件预览：Markdown 渲染（marked + DOMPurify）、HTML sandboxed webview、相对文档链接跳转
- 资源管理器：右键菜单、新建/重命名/复制/删除/Finder/在终端打开、行内编辑
- 项目 / 收件箱 / 统计 / 主机 / 设置五套页面；Rail 带未读徽标
- 统计：项目范围切换、按 Agent/项目/主机分组、失败分类、CSV 导出
- 主机：SSH 添加/编辑/探测、并发上限、Agent 运行位置切换
- 命令面板：命令 + 任务 + 会话全局搜索、分组、上下文安全调度
- 设置：终端字号/回滚、模型选择、预览地址、数据备份/恢复
- 深浅色主题、柔和卡片化布局、窄视口工具栏降级
- GitHub Actions 三平台打包与 Release 附件

### Changed

- Chat / Terminal 的工具栏与状态提示统一为低饱和、紧凑风格
- 终端 split / 文件预览切换不再重建 webContents，减少白屏与重新加载
- ACP 审批支持完整 optionId，显示审批队列；模型按会话保存
- 主机并发输入改为失焦/Enter 提交，避免逐字符写库

### Known limitations

- Alpha 阶段：数据库 schema / IPC / UI 仍可能变更，升级前请备份
- 未做代码签名 / 公证；macOS Gatekeeper 与 Windows SmartScreen 会提示
- 未实现：附件/图片粘贴、消息重新生成、文件树多选/拖拽、会话置顶/删除、run 日志详情、自定义快捷键
- Linux 构建为 x86_64；macOS 首发为 Apple Silicon（arm64）
