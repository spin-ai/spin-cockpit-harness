# Cockpit Harness · 抖音配音文稿（11 段定稿）

> 来源：WorkBuddy 2026-11-15 的 `cockpit-harness-voiceover.html` 定稿。
> 定位：第一人称、行业热点开场、情绪只给四处；不是产品发布。
> 时长：11 段，成片约 **60.8s**（竖版 1080×1920 / 横版 1920×1080 / 30fps）。

## 1. 当前配音状态

- 火山引擎 TTS **还没拿到** `VOLC_TTS_APPID / TOKEN / VOICE`。
- 已核对 Pi Agent 的 `~/.pi/agent/models.json`：volcengine 走 `https://ark.cn-beijing.volces.com/api/plan/v3`，key 与 `ARK_API_KEY` 相同，只覆盖 chat / VLM / embedding；`/audio/speech`、`/tts` 均 404，不能直接拿来做语音合成。
- 成片先用 **Edge 神经语音** `zh-CN-XiaoxiaoNeural`、`rate +30%`、`pitch -2Hz` 做占位，方便审片；听感更柔和，不抢“第一人称复盘”的语气。
- 后期对人声做了轻 EQ、压缩和 22ms 的短空间感；音乐是 96 BPM 的合成铺底，sidechain 让人声优先。
- 火山引擎适配器已写在 `scripts/video/tts.cjs`：填环境变量后 `TTS_ENGINE=volcengine npm run video:douyin` 直接重跑。

## 2. 分段文稿

| # | 场景 | 时间 | 文稿 | 念法 |
|---|---|---|---|---|
| 01 | hook | 0.0–5.6 | DeepSeek 上周说，一个人最多盯五个 Agent。多了就顾不过来。 | “DeepSeek 上周说”快、平；“一个人最多盯五个”逐字放慢；停 0.3s；“多了就顾不过来”轻，像自己嘀咕 |
| 02 | problem | 5.3–9.6 | 我也是这样，开到最后，我记不住谁在等。 | “我也是这样”要轻；最后一句放平收住，尾音往下掉 |
| 03 | reveal | 9.3–14.8 | 于是，我写了个东西，Cockpit Harness。让 Agent 为我打工。 | “于是”单独一顿；“我写了个东西”说轻；产品名两词连读；最后一句语速稍提但不扬 |
| 04 | terminal | 14.5–21.4 | 打一行字，它开个真终端，任务排队跑。每个 run 一个独立 worktree，改完我点确认。 | 前半像操作解说；“每个 run 一个独立 worktree”顿开；“改完我点确认”慢下来 |
| 05 | super | 21.1–28.3 | 活再大点，扔给 Super Agent。它拆成几份分下去。以前我最忙，现在我最闲。 | “活再大点”起得随意；最后一句慢、音高略降，带一点不敢信的笑 |
| 06 | scene | 28.0–34.1 | 状态能变成办公室、作战室、航母甲板。Agent 也有社会组织了。 | 三个场景名逐个递进；最后一句轻、带一点笑，不要念成结论 |
| 07 | wiki | 33.8–38.9 | 领域内的知识进 wiki，补进上下文，它就越懂你的活。 | “wiki”读英文；“补进上下文”稍快；最后六个字收住，“你的活”咬清 |
| 08 | memory | 39.1–44.8 | 跑过的活都进入记忆。记忆分四层，通过做梦来自我整理。 | “记忆分四层”短促；“做梦”轻挑；后四个字放平收尾 |
| 09 | persona | 44.6–49.3 | 构建人物画像。跟谁合作，说得出凭什么。 | “构建人物画像”短、平；最后五个字咬住，尾音下压，不要带笑 |
| 10 | tech | 49.0–55.8 | 解析、编排、整理、记忆、画像。现在都在讲编排，难的是同时转。 | 五个词逐个顿开，每个停 0.25s；“难的是同时转”语气实，不要扬 |
| 11 | cta | 55.5–60.8 | 代码开源，跑你自己机器上。GitHub 搜 Cockpit Harness。 | 音量和语速都往下收，不提气，不加感叹 |

全片情绪只给四处：01 的“顾不过来”、02 的自知、05 的“现在我最闲”、09 的“说得出凭什么”。其余一律平。

## 3. 纯文本（按段粘贴）

```text
DeepSeek 上周说，一个人最多盯五个 Agent。多了就顾不过来。
我也是这样，开到最后，我记不住谁在等。
于是，我写了个东西，Cockpit Harness。让 Agent 为我打工。
打一行字，它开个真终端，任务排队跑。每个 run 一个独立 worktree，改完我点确认。
活再大点，扔给 Super Agent。它拆成几份分下去。以前我最忙，现在我最闲。
状态能变成办公室、作战室、航母甲板。Agent 也有社会组织了。
领域内的知识进 wiki，补进上下文，它就越懂你的活。
跑过的活都进入记忆。记忆分四层，通过做梦来自我整理。
构建人物画像。跟谁合作，说得出凭什么。
解析、编排、整理、记忆、画像。现在都在讲编排，难的是同时转。
代码开源，跑你自己机器上。GitHub 搜 Cockpit Harness。
```

## 4. 合成参数

```text
语言        zh-CN
语速        1.0（火山引擎）；Edge 占位用 +30%
音高        0（火山）/ -2Hz（Edge 占位）
音量        1.0
采样率      24000 Hz 或 48000 Hz
格式        wav 优先，后期统一 48k 单声道
分段        11 段独立合成
段首留白    0.5s
段尾留白    0.7s
```

**读音**

- DeepSeek：/ˈdiːpsiːk/，不要念“深度求索”
- Agent：/ˈeɪdʒənt/，不要拆成 A-Gent（01、03、05、06）
- Cockpit Harness：两词连读，重音在 Cockpit 第一音节
- run / worktree / wiki：读英文；worktree 连读，wiki 读 /ˈwɪki/
- 数字全部汉字：五个 / 六个 / 四层

## 5. 切换火山引擎

```bash
export VOLC_TTS_APPID=...
export VOLC_TTS_TOKEN=...
export VOLC_TTS_CLUSTER=volcano_tts
export VOLC_TTS_VOICE=<voice_type>
TTS_ENGINE=volcengine npm run video:douyin
```

- 可选：`VOLC_TTS_SPEED=1.0` / `VOLC_TTS_PITCH=1.0` / `VOLC_TTS_VOLUME=1.0`
- 也可以把凭据放在 `~/.pi/agent/volc-tts.json`（`{ "appid": "...", "token": "...", "cluster": "volcano_tts", "voice": "..." }`），或 `models.json` 的 `providers.volcengine.tts`；`tts.cjs` 会自动读取，环境变量优先。
- 不设 `TTS_ENGINE` 时：有火山凭据自动用火山，否则用 Edge。
- 火山返回的音频会自动测时长并重算场景时间线；不需要手工改时间。

## 6. 30 秒版（可选）

保留 `01 → 02 → 03 → 04（简） → 05 → 11`，其余场景只留画面不出声。

| 段 | 文稿 |
|---|---|
| 01 | DeepSeek 上周说，一个人最多盯五个 Agent。多了就顾不过来。 |
| 02 | 我也是这样，开到最后，我记不住谁在等。 |
| 03 | 于是，我写了个东西，Cockpit Harness。让 Agent 为我打工。 |
| 04 | 打一行字，它开个真终端。改完我点确认。 |
| 05 | 活再大点，扔给 Super Agent。以前我最忙，现在我最闲。 |
| 11 | 代码开源，跑你自己机器上。GitHub 搜 Cockpit Harness。 |
