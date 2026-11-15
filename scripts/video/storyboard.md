# 抖音介绍视频 · 分镜 / 文案 / 发布

> 规格：**竖版 1080×1920 / 横版 1920×1080 · 30fps · H.264 + AAC · 约 60.8s**
> 产物（已 gitignore）：`.preview/douyin/`、`.preview/douyin-wide/`
> 重新生成：`npm run video:douyin`；横版：`npm run video:wide`；Pages 版：`npm run video:pages`
> 只出关键帧：`npm run video:douyin -- --preview`

## 1. 这一版讲什么

第一人称复盘，不是产品发布：

```text
行业热点（5 个上限） → 我也是这样 → 我写了个东西 → 能派活 → 能分工
→ 能看见 → 能记住 → 人物画像 → 承认难在哪 → 开源
```

- 受众：正在用 Claude Code / Codex / Cursor，同时开一堆终端的人。
- 姿态：有判断、有账本；可以自嘲，不能自贬。
- 禁词：赋能、闭环、一站式、极大提升、重新定义、让效率提升 N 倍。
- 情绪只给四处：01 的“顾不过来”、02 的自知、05 的“现在我最闲”、09 的“说得出凭什么”。

## 2. 分镜（时间由配音实际时长自动计算）

| 时间 | 场景 | 画面 | 屏显 | 旁白 |
|---|---|---|---|---|
| 0.0–5.6 | hook | 6 个终端卡片铺满，第 6 个红框；随后收拢 | `一个人最多 / 盯 5 个 Agent` → `多了，就顾不过来。` / `五个是设计上限，我开了六个` | DeepSeek 上周说，一个人最多盯五个 Agent。多了就顾不过来。 |
| 5.3–9.6 | problem | 六张便签 | `开到最后 / 我记不住谁在等` | 我也是这样，开到最后，我记不住谁在等。 |
| 9.3–14.8 | reveal | Logo + 三张产品图 | `我写了个东西 / Cockpit Harness` / `让 Agent 为我打工` | 于是，我写了个东西，Cockpit Harness。让 Agent 为我打工。 |
| 14.5–21.4 | terminal | 工作区截图 | `打一行字 / 它开个真终端` + `改完，我点确认` | 打一行字，它开个真终端，任务排队跑。每个 run 一个独立 worktree，改完我点确认。 |
| 21.1–28.3 | super | Mission 面板 | `活再大点 / 扔给 Super Agent` + `以前我最忙 · 现在我最闲` | 活再大点，扔给 Super Agent。它拆成几份分下去。以前我最忙，现在我最闲。 |
| 28.0–34.1 | scene | 办公室 / 作战室 / 航母 3D 三段 | `状态能变成 / 办公室 · 作战室 / 航母甲板` | 状态能变成办公室、作战室、航母甲板。Agent 也有社会组织了。 |
| 33.8–38.9 | wiki | Wiki + 图谱 | `领域内的知识 / 进 wiki` / `补进上下文，它就越懂你的活` | 领域内的知识进 wiki，补进上下文，它就越懂你的活。 |
| 39.1–44.8 | memory | 四层记忆合成卡片（示例数据） | `跑过的活 / 都进入记忆` / `记忆分四层，通过做梦来自我整理` | 跑过的活都进入记忆。记忆分四层，通过做梦来自我整理。 |
| 44.6–49.3 | persona | 人物画像合成卡片（示例人物） | `构建人物画像` / `跟谁合作，说得出凭什么` | 构建人物画像。跟谁合作，说得出凭什么。 |
| 48.3–55.0 | tech | 五行难点 | `五个技术难点` / `现在都在讲编排，难的是同时转` | 解析、编排、整理、记忆、画像。现在都在讲编排，难的是同时转。 |
| 55.5–60.8 | cta | Logo + 二维码 | `代码开源 / 跑你自己机器上` / `GitHub 搜 Cockpit Harness` | 代码开源，跑你自己机器上。GitHub 搜 Cockpit Harness。 |

## 3. 发布文案

**标题（选一个）**

1. `JetBrains 这周做的事，我上个月自己写了一个`
2. `一个人最多盯 5 个 Agent，我开了 6 个`
3. `给六个终端点确认，点到我开始写工具`

**话题**

`#AI编程 #AIAgent #程序员 #开源项目 #效率工具 #JetBrains #独立开发`

**置顶评论**

```text
开源地址：github.com/spin-ai/spin-cockpit-harness
Air 是在 IDE 里加 Agent；我是把已经开着的终端、任务、worktree 收进一个窗口。
Alpha，macOS / Windows / Linux，本地优先。
```

**封面**

- `.preview/douyin/cover.png`：`一个人最多 / 盯 5 个 Agent` + 6 个终端卡片（第 6 个红框）。
- 备选 `cover-alt.png`：`多了，就顾不过来。`

**音乐**

- 成片自带一段 96 BPM 的轻量合成铺底（`scripts/video/music.cjs`），人声 sidechain 自动让位；没有第三方版权素材。
- 如果要跟抖音热门音乐，仍可用 **静音版** 上传，再用平台音乐；配音版里的铺底不会抢人声。
- 音乐音量在 `render-douyin.cjs` 的 `volume=0.62` / `weights=1 0.9` 里调。

## 4. 配音状态

- 当前成片是 **Edge 神经语音** `zh-CN-XiaoxiaoNeural`（`rate +30%` / `pitch -2Hz`）的占位版，偏柔和、现代；后期加了轻 EQ、压缩和一点空间感。
- 记忆 / 画像两段改成 **纯 HTML 合成卡片**（`示例数据` / `示例人物`），不再使用真实联系人、真实笔记的截图。
- 火山引擎 TTS 适配器已就绪（`scripts/video/tts.cjs`），但没有 `VOLC_TTS_APPID / TOKEN / VOICE`；Pi Agent 的 volcengine 配置是 Ark plan 网关（chat / VLM / embedding），不含语音合成。
- 凭据可放环境变量，或 `~/.pi/agent/volc-tts.json`（`appid / token / cluster / voice`），脚本会自动读取。
- 填好环境变量后：

```bash
export VOLC_TTS_APPID=...
export VOLC_TTS_TOKEN=...
export VOLC_TTS_CLUSTER=volcano_tts
export VOLC_TTS_VOICE=<voice_type>
TTS_ENGINE=volcengine npm run video:douyin
```

脚本会重新分段合成、重新测时长、重算时间线，不需要手改时间。

## 5. 30 秒版

保留 `01 → 02 → 03 → 04（简） → 05 → 11`，其余场景只留画面不出声。

| 段 | 文稿 |
|---|---|
| 01 | DeepSeek 上周说，一个人最多盯五个 Agent。多了就顾不过来。 |
| 02 | 我也是这样，开到最后，我记不住谁在等。 |
| 03 | 于是，我写了个东西，Cockpit Harness。让 Agent 为我打工。 |
| 04 | 打一行字，它开个真终端。改完我点确认。 |
| 05 | 活再大点，扔给 Super Agent。以前我最忙，现在我最闲。 |
| 11 | 代码开源，跑你自己机器上。GitHub 搜 Cockpit Harness。 |

## 6. 工程

```text
scripts/video/
  scenes.cjs          11 个场景、旁白、屏显、图片路径
  stage.css           竖版 1080×1920 舞台
  stage-wide.css      横版 1920×1080 覆盖
  music.cjs           96 BPM 轻量铺底合成（无版权素材）
  tts.cjs             Volcengine / Edge 分段合成
  render-douyin.cjs   TTS → 时间线 → Electron 逐帧 → ffmpeg
  publish-web.cjs     横版母片 → public/video 1600×900 Pages 版
  voiceover.md        文稿、念法、合成参数
  voiceover.txt       纯文本
  storyboard.md       本文件
```

**安全区**：关键文字在 `x 76–1004 / y 250–1500`；底部 ~400px、右侧 ~120px 留给抖音 UI。

**素材**：办公室 / 作战室 / 航母用 `docs/assets/article/sc-*.{png,jpg}`；记忆 / 画像用合成卡片；其余用 `public/wiki/cover-*.png`。所有画面不含真实联系人、真实笔记或本地路径。

## 7. GitHub Pages 横版

```bash
npm run video:douyin     # 先出竖版 + 音频
npm run video:wide       # 复用音频，出 1920×1080 横版
npm run video:pages      # 压成 1600×900 / 4.5MB，写到 public/video/
```

- 页面入口：`site/src/Landing.tsx` 的 `#video` 区块，`<video controls poster>` 直接引用 `public/video/cockpit-harness-intro.mp4`。
- Pages 工作流已包含 `public/video/**`，push 后自动部署。
- 横版和竖版共用同一套旁白、时间线与铺底音乐；竖版输出到 `.preview/douyin/`，横版输出到 `.preview/douyin-wide/`。
