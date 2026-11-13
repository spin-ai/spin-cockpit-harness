# 微信聊天记录 → 数据集

目标：把本机微信聊天整理成可当数据集用的格式，供「人像」「知识库」使用。

## 现状（为什么不能直接读 WeChat 的库）

macOS 上微信 4.x（xwechat）的库在：

```
~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/<账号>/db_storage/message/*.db
```

实测这些文件**是 SQLCipher 整库加密**的 —— 文件头不是 `SQLite format 3`：

```
86 d3 29 05 a3 24 e7 34 …
```

没有 key 读不出来，key 只有在微信进程内存里（或需要第三方工具从内存中提取）。所以本仓库的做法是：
**先导出为 CSV / JSON / TXT，再规整成数据集**，导入链路本身已经打通并可验证。

## 导出（任选一种，均为本地工具）

| 方式 | 产物 | 说明 |
|---|---|---|
| 留痕 / MemoTrace | CSV | 列含 `StrTalker, StrContent, CreateTime, IsSender, NickName` |
| WeChatMsg | JSON / CSV | 字段 `from/text/date` 或 `StrTalker/StrContent` |
| 楼月 | TXT / HTML | `时间 说话人` + 内容，或 `说话人: 内容` |
| 微信自带「备份到电脑」 | 微信备份格式 | 只能留档，不能直接解析 |

## 规整

```bash
npm run import:wechat -- ~/Downloads/wechat-export --self 你的昵称
# 只看统计：
npm run import:wechat -- ~/Downloads/wechat-export --dry-run
# 限制条数 / 指定输出：
npm run import:wechat -- ~/Downloads/wechat-export --out datasets/wechat --limit 5000
```

输出（`datasets/wechat/`，已加入 `.gitignore`）：

```
manifest.json            统计：会话、条数、时间范围、跳过/去重
<会话>/messages.jsonl    一行一条 {chat, at, speaker, text, out}
<会话>/dataset.json      人像导入格式 (from / text / date)
```

脚本行为：CSV 引号/换行安全解析；时间支持秒/毫秒/ISO；按「会话 + 时间 + 说话人 + 正文」去重；
按会话分组；统计中文条数；空内容与重复分别计数。

## 当数据集用

- 人像：`人像 → 导入 → 选择文件…` 选 `dataset.json`（抽取结果全进待确认）；或
  `personaImport({ text: <dataset.json 内容>, selfName: "我" })`
- 知识库检索：`知识库 → 文档 → 粘贴文本`，贴一段记录即可被检索与引用
- Agent：通过 `persona_lookup` / `knowledge_search` 使用

## 加密库直读（可选）

若后续拿到 SQLCipher key（例如第三方工具导出）：

```bash
brew install sqlcipher
npm run import:wechat -- --db message_0.db --key <hex>
```

脚本会用 `sqlcipher -json` 导出 `Msg_*` 表并按同一套规则归一化；缺 `sqlcipher` 时会明确提示。

## 隐私

- `datasets/**` 永不入库（`.gitignore`）；微信原始库只读，不复制、不移动
- 不要把导出结果放进 release 或分享；用完建议删除中间文件
