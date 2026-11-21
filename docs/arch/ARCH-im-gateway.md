> 层：架构 · 状态：部分落地 · 核对：2026-11-15 · 覆盖：即时通信网关的目标渠道只做飞书以及它与桌面 Agent 的接线边界

# Arch · 即时通信网关（飞书）

> 需求来源：`../product/REQ-modules-original.md` §5（US-IMAgent-01 / 02）。
> 实施流水账（记忆 / 人像 / 知识 / IM 一轮落地）在 [`ARCH-memory-persona-im.md`](ARCH-memory-persona-im.md)，那篇是历史记录，**边界以本文为准**。

---

## 0. 结论：渠道范围只做飞书

| 渠道 | 是否在范围内 | 理由 |
|---|---|---|
| **飞书（自建应用 + 机器人）** | ✅ **唯一目标渠道** | 有正规开放 API；**事件订阅支持长连接（WebSocket），桌面端不需要公网地址**；open_id / chat_id 可做 allowlist；卡片消息能承载审批 |
| 个人微信 | ❌ 不做 | 无官方 API，走第三方注入有封号风险（REQ 里的待确认项），且要动本机微信进程 |
| Telegram | ❌ 非目标渠道 | 现有长轮询代码保留但不再投入；国内网络不可用，与企业场景不匹配 |
| Slack / 钉钉 / 企微 | ❌ 不做 | 同一套网关可以接，但没有需求认领；先不扩渠道 |

一句话：**先把飞书这一条路做到「能收、能回、能审批」，不做多渠道抽象。**

---

## 1. 飞书的三条接入路径，选长连接

| 路径 | 出站 | 入站 | 需要公网地址 | 结论 |
|---|---|---|---|---|
| 自定义机器人 Webhook | ✅ 只能发到它所在的那个群 | ❌ 收不到回调 | 否 | 仅够「推送通知」，不够「手机上继续处理」 |
| 自建应用 + 事件订阅（HTTP 回调） | ✅ | ✅ | **是**（回调必须公网可达，要内网穿透/域名） | 不适合纯桌面应用 |
| **自建应用 + 事件订阅（长连接）** | ✅ | ✅ | 否 | **选它**：应用内向飞书建 WebSocket，事件从这条连接推下来 |

选长连接的直接后果：**桌面进程就是网关**。应用退出 = 连接断开 = 飞书侧消息不会推下来，只能在下次启动后处理飞书侧仍保留的会话；不允许假装已经处理（与 REQ「桌面不在时明确告知并排队」一致）。

依赖代价：长连接要用飞书官方 Node SDK（`@larksuiteoapi/node-sdk` 的 `WSClient`），属于新增运行时依赖，需按 [`ARCH-package-size.md`](ARCH-package-size.md) 的口径评估体积。

---

## 2. 现状（代码位置）

| 能力 | 代码 | 现状 |
|---|---|---|
| 网关骨架 | `electron/im/gateway.mjs` · `createImGateway()` | 部分落地 |
| 出站 | `send()` | 只支持**自定义机器人 webhook**（`https://open.feishu.cn/open-apis/bot/v2/hook/…`），可选 `Authorization: Bearer`。**不能给单聊用户回消息** |
| 入站 | `startInbound()` | 本地 HTTP，`POST {chat_id, text}`，绑 `127.0.0.1`，可选 Bearer。**是自定义协议，不是飞书事件协议** |
| Telegram 长轮询 | `pollOnce()` / `loop()` | 真实可用，但**非目标渠道**（见 §0） |
| 会话映射 | `userData/im/sessions.json` | `chatId → todoId`，随消息落库 |
| 三段式卡片 | `formatImCard()` | 结果 / 执行步骤 / 协议身份，纯文本 |
| 审批卡 | `formatApprovalCard()` | 纯文本，回复数字 1..n 即选择（`electron/main.mjs` 的 `onMessage` 处理） |
| 设置项 | `imEnabled` `imWebhookUrl` `imWebhookToken` `imInboundPort` `imAllowIds` `imTelegram*` | 见 [`ARCH-settings.md`](ARCH-settings.md)。分区顺序已按「只做飞书」重排：**飞书**（启用 / 出站 webhook / token / allowlist）→ **入站（自定义 HTTP）** → **非目标渠道（实验）**（Telegram）。**IM 凭据当前是明文**（只有 `dshEnv` 走 `safeStorage`），设置页已写明 |
| 回传 run 结果 | `imNotifyRun()` | run 结束推三段式卡片；审批时推数字卡 |

状态机（已落地部分）：

```text
飞书/HTTP 入站 ──▶ allowlist（默认空 = 全忽略）
                 │
                 ├─ 纯数字且有待审批 ──▶ 该 run 的 permission 选项 ──▶ 回「已选择」
                 └─ 其它文本 ──▶ actions.send() ──▶ 同一套 thread / todo / run
                                        └─ 没有可用 Agent ──▶ 落「待执行」任务，不假装处理
run 结束 ──▶ imNotifyRun() ──▶ 三段式卡片回同一个 chatId
```

---

## 2.5 扫码配置（已落地，2026-11-17）

**能扫的与不能扫的**：飞书不会通过二维码下发 `app_secret`（自建应用的凭据只能在开放平台后台看到），所以这里做的不是"扫一下就有密钥"，而是**让手机当输入设备**：

```text
桌面：设置 → 即时通信 → 飞书 → 扫码配置
  ↓ 主进程起一次性 HTTP（0.0.0.0 随机端口，128-bit token，10 分钟 TTL）
桌面显示二维码 + 明文地址（同一网络内手机浏览器也能直接输入）
  ↓ 手机扫码 → GET /pair?t=…（单次）
手机页面：粘贴 App ID / App Secret / 允许的 open_id（表单不预填、不回显）
  ↓ POST /pair?t=…（只接受这一次）
主进程写入设置：appId 明文、secret 走 safeStorage（`enc:` 前缀）、allow_ids 合并
  ↓ 返回「已写入」→ 400ms 后关闭监听 → 桌面收到 harness:im-paired 关掉二维码
```

硬约束：

- 二维码**只含一次性 URL**，绝不放 secret；表单也不回填任何凭据。
- token 校验失败一律 403；字段做格式/长度校验（`cli_` 前缀、secret ≥ 8 位）。
- 成功后立刻停监听，第二次提交返回 409；TTL 到也停。
- 日志只记 appId，不记 secret（`scripts/im-pairing-selftest.mjs` 有一条断言）。
- 页面顶部写明「仅在可信网络下使用」；不接受局域网之外的反向代理配置。

**更简单的一条路（2026-11-17）**：设置页默认只留**一个粘贴框**。

```text
粘 cli_xxx + secret（分行/冒号/等号都行）  → 自动识别 → 保存（secret 加密）→ 强刷一次 token 验证
粘 https://open.feishu.cn/open-apis/bot/v2/hook/…  → 自动识别成 webhook 模式（只能发群、收不到 @）
```

- `parseFeishuSetup()` 是纯函数，认不出就返回 null，不做猜测；webhook 形态只接受 `open.feishu.cn` 域名。
- 验证 Token、出站 webhook、allowlist 收进「高级」；默认不要求填。
- **allowlist 为空时**：放行第一个跟 bot 说话的会话并写日志（否则"配好了却没人能说话"是更大的坑）；填了就严格匹配。
- 扫码配置仍然保留（「用手机扫码」），不是唯一入口。

**没解决的**：扫码只完成"凭据到位"，`tenant_access_token`、事件订阅长连接、发送与幂等仍是 §3 的 1→5 步；探测按钮也要等 token 交换做完才有意义。

## 2.6 飞书通道（P1 已落地，2026-11-17）

`electron/im/feishu.mjs`（不引 SDK，fetch 可注入便于离线自测）：

| 能力 | 实现 |
|---|---|
| `tenant_access_token` | 缓存到过期前 5 分钟；`force` 强刷；`401 / 99991663` 自动强刷重试一次 |
| 发送 | `POST /open-apis/im/v1/messages?receive_id_type=open_id\|chat_id`，`content` 是 `{"text":…}` 字符串 |
| 事件 v2 | `normalizeEvent()`：`url_verification` → 回 challenge；`im.message.receive_v1` → `{eventId, chatId, chatType, openId, text}`；其它事件忽略 |
| 幂等 | `createDedup()`：`event_id` 30 分钟窗口、上限 500 条 |
| 文本提取 | `content` 是 JSON 字符串，去掉 `@_user_N` 占位符 |

网关里的接线：

- **出站**：配置了 app 凭据就走开放接口（`oc_` → `chat_id`，`ou_` → `open_id`）；失败退回 webhook，不静默丢消息
- **入站**：本地 HTTP 收到 `schema=2.0` / `url_verification` 时先 ack（3 秒内不回会重推），再异步处理；校验 `header.token`（配了 `imFeishuVerificationToken` 才校验）、`event_id` 去重、allowlist（`chatId` 或 `openId` 命中才处理），陌生人只留日志
- **验收**：`npm run verify:feishu`（8 项）覆盖 token 缓存/过期刷新、发送体与 Bearer、事件规范化、坏 JSON、幂等

### 2.6.1 长连接（2026-11-17 已落地）

飞书后台「事件订阅」默认推荐长连接，不需要公网域名。实现：

- `electron/im/feishu-ws.mjs`：`@larksuiteoapi/node-sdk` 的 `WSClient` + `EventDispatcher`，订阅 `im.message.receive_v1`
- 事件走**同一套** `processFeishuPayload()`（与 HTTP 回调共用）：challenge / 校验 Token / `event_id` 去重 / allowlist / 派发
- 设置项 `imFeishuMode`：`ws`（默认，长连接） / `http`（公网回调，需要隧道）
- 启动失败不阻塞其它渠道：WS 失败只记日志，HTTP 入站仍可用
- 关闭/重启网关会停掉 WS；应用退出 = 断连，期间消息不补拉

代价：`@larksuiteoapi/node-sdk` 约 29MB（含 protobufjs / ws / axios），进安装包；这是目前唯一的重依赖。

**仍未做**：卡片消息（`interactive`）、`card.action.trigger` 按钮回传、离线补拉。

## 3. 飞书要补的东西（按依赖顺序）

1. **凭据**：`imFeishuAppId` / `imFeishuAppSecret`（+ 可选 `imFeishuVerificationToken`）。**必须走 `safeStorage`**，不能像现在 `imWebhookToken` 那样明文躺在设置 JSON 里。
   → 已落地：扫码配置（见 §2.5）写入，secret 存 `enc:` 密文。
2. **`tenant_access_token`**：`POST /open-apis/auth/v3/tenant_access_token/internal`，缓存到过期前 5 分钟；401 时强制刷新一次。
3. **事件订阅长连接**：SDK `WSClient` 订阅 `im.message.receive_v1`；启动时在 `startImGateway()` 里拉起，退出时优雅关闭。
4. **幂等**：用事件头的 `event_id` 去重。飞书回调超时会重推，没有幂等就会重复建任务。
5. **发送**：`POST /open-apis/im/v1/messages?receive_id_type=open_id|chat_id`，支持 `msg_type=text` 与 `interactive`（卡片）。
6. **allowlist**：`open_id` / `chat_id`，默认空 = 全忽略（沿用现有语义；不要默认 `*`）。
7. **卡片化**：审批卡改成 `interactive` 按钮；数字回复保留为兜底（旧客户端/降级场景）。
8. **离线语义**：应用退出即断开长连接；恢复后只处理仍可拉到的会话，UI 与设置页文案要写清「桌面关闭时飞书侧消息不会被处理，不会假装已处理」。

---

## 4. 安全与红线

- **陌生会话一律忽略并留日志**，不回复（避免探测）。
- **敏感人物事实默认不推 IM**（REQ US-IMAgent-02）：画像推断、关系强度、生成本地路径不进卡片。
- **凭据只在本机**：`app_secret` 用 `safeStorage`；日志与错误信息里不得出现 token / secret（与 `npm run verify:privacy` 的口径一致）。
- **飞书事件内容不可信**：`event.message.content` 是 JSON 字符串，按文本取出后仍走同一套 `actions.send()`，不解析其中的任何指令式结构。
- **回执必达**：长连接模式下没有「重推」保证，因此每条消息处理成功/失败都要明确回一条，失败要说清楚失败原因，不能静默。

---

## 5. 明确未做

- **没有任何飞书真实接入**：无自建应用凭据、无 `tenant_access_token`、无 `WSClient`、无事件订阅、无 `im/v1/messages` 发送。现在的「飞书」只有自定义机器人 webhook 出站。
- **没有 `@larksuiteoapi/node-sdk` 依赖**，长连接可行性只做了判断，没有落地验证。
- **入站不是飞书协议**：`startInbound()` 是自定义 `POST {chat_id, text}`，飞书的事件体需要额外的解析与验签层。
- **没有卡片消息**：`interactive` 卡片、按钮回调、`card.action.trigger` 全未做，审批仍是纯文本 + 数字。
- **没有事件幂等**：`event_id` 去重未实现，重推会重复建任务。
- **IM 凭据未加密**：`imWebhookToken` / `imTelegramToken` 明文存储，`safeStorage` 只覆盖 `dshEnv`。
- **没有渠道抽象层**：Telegram / 微信分支还在 `gateway.mjs` 里；按 §0 的口径它们是「保留但不投入」，不是「已支持」。
- **没有离线排队实现**：应用退出期间的消息不落任何队列，下次启动也不会补拉历史。
