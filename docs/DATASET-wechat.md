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

## 本机实测结论（macOS 4.1.13）

- 消息库是 SQLCipher 加密（文件头 `86 d3 29 05`），**没有 key 读不出来**
- WeChat 是 **hardened runtime**（`flags=0x10000(runtime)`）+ 沙盒，SIP 已开启 →
  **无法用 lldb 附加进程抓 key**；`key_info.db` 里的 `key_info_data` 也是加密封装
- 微信自带只有「迁移/备份」：备份目录为空，迁移库只有任务元数据（无正文）

所以必须借助下面两种方式之一拿到 key 或导出文件。

## key 到底怎么拿（三条路，按推荐顺序）

### A1. Frida Gadget + 调试副本（SIP 保持开启，无需降级系统）★推荐

原理：`task_for_pid` 对 hardened runtime 的应用会被 taskgated 拒绝（sudo 也不行），
但**自己复制一份并 ad-hoc 重签**的副本不再受这个限制；在副本里注入 Frida Gadget，
hook CommonCrypto 的 `CCCrypt`/`CCCryptorCreate`，就能拿到传给 SQLCipher 的 key。

本仓库把它串成一条命令：

```bash
bash scripts/wechat-key-macos.sh --dry-run   # 先看会执行什么
bash scripts/wechat-key-macos.sh --yes       # 真跑
```

它会：clone 开源工具 → `sip.prepare`（复制/注入/重签）→ `keys.hunt`（退出微信、启动调试副本、
需重新扫码）→ `decrypt`（解出 `decrypted/`）→ 打印下一步导入命令。
原 `/Applications/WeChat.app` 不会被修改；代价是微信要短暂退出并重新登录。

### A2. 关 SIP + lldb（不推荐）

```bash
# 恢复模式里执行，然后重启；抓完再开回来
csrutil disable
sudo lldb -p "$(pgrep -x WeChat)" \
  -o 'br set -n sqlite3_key' -o 'breakpoint command add -o "memory read $rdi" ' -o 'c'
csrutil enable
```
风险高（系统安全降级、可能抓错参数），只在 A1 不可行时考虑。

### A3. `key_info.db` 离线推导？——不行

`LoginKeyInfoTable.key_info_data` 是 180 字节的加密封装（不是裸 key），
解它需要的封装密钥同样来自运行时；公开工具（含 Windows 版）最终也都是走内存扫描。
所以「只拷文件、不跑微信」拿不到 key。

## 实跑记录（这台机器，2026-11-14）

按 A1 真跑通过，全过程约 3 分钟，微信临时退出并在调试副本里跑过一次：

```bash
bash scripts/wechat-key-macos.sh --yes --only=sip.prepare   # 下载 Frida Gadget + 构建调试副本
cd .runtime/wechat4-db-decrypt
uv run python -m wxexport.keys.hunt --restart --timeout 420 --quiet 45   # 退出微信→启动副本→抓 key
uv run python -m wxexport.keys.map --db-dir "$HOME/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_ivx7yz1nfzgp22_ea49/db_storage"
uv run python -m wxexport.decrypt --db-dir "<上面同一个 db_storage>" --out-dir decrypted-live
```

两个坑（脚本和文档都已修正）：

1. `keys.map` / `decrypt` 默认读 `config.json` 里的 `db_dir`，它会挑**别的账号**目录 →
   所有库都「无密钥」。必须 `--db-dir` 指到当前账号的 `db_storage`。
2. 解码 WeChat 4.x 库时不能 `SELECT *`：`server_id` 等 64 位整数超出 JS 安全范围，
   `node:sqlite` 会直接抛错；要显式选列（`local_type` / `create_time` /
   `real_sender_id` / `message_content`）。

结果：13,830 条 / 377 个会话 / 2026-08-19 → 11-14，本人 888 条，落在 `datasets/wechat/`。

清理：抓完把调试副本与快照删掉即可（key 仍适用于原库）：

```bash
rm -rf .runtime/wechat4-db-decrypt/.runtime/WeChat-SIP.app .runtime/wechat4-db-decrypt/decrypted-live
rm -rf ~/Library/Containers/io.github.timfang4162.wechat4-macos-frida-export.sip
```

## 方式 A：第三方工具解密（拿到 key 后直读）

macOS 上可行的是「Frida Gadget + CommonCrypto 拦截」路线（会启动一个**调试副本**的微信，
不改原 App；需要先退出当前微信）。例如开源项目 `wechat4-db-decrypt`：

```bash
# 只贴命令示意，请先自行阅读该项目的 README 与许可证
uv run python -m wxexport.sip.prepare     # 生成可调试副本
uv run python -m wxexport.keys.hunt       # 抓 key（会重启微信到调试副本）
uv run python -m wxexport.decrypt         # 解密到 decrypted/
```

拿到 `decrypted/db_storage` 后（本仓库已支持直接读）：

```bash
npm run import:wechat -- --dir ~/Downloads/wechat4/decrypted/db_storage --self 我 --self-wxid wxid_xxx
```

脚本会自己解析 `session.db`（会话名）、`contact.db`（联系人备注）、
`Name2Id`（发送人 id → wxid）、`Msg_<md5>` 表（`local_type=1` 文本、`49` 取 `<title>`），
跳过图片/语音等压缩内容。

## 方式 B：第三方导出成 CSV / JSON（不需要 key）

部分工具（留痕 / WeChatMsg / 楼月）能直接导出 CSV/JSON/TXT，导出目录丢给脚本即可：

```bash
npm run import:wechat -- ~/Downloads/wechat-export --self 我
```

## 导出格式（任选一种，均为本地工具）

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
