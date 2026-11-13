#!/usr/bin/env bash
# 微信 4.x（macOS）SQLCipher key 获取 —— 走「Frida Gadget + 调试副本」路线。
#
# 为什么不能直接抓：WeChat 是 hardened runtime（flags=0x10000(runtime)）+ 沙盒，
# SIP 开启时 task_for_pid/lldb 附加会被 taskgated 拒绝，哪怕用 sudo。
# 可行做法是给自己复制一份 WeChat.app、注入 Frida Gadget 并 ad-hoc 重签，
# 让「副本」在被 hook 的情况下启动，从 CommonCrypto 里截到 key。
#
# 本脚本只是把开源工具的步骤串起来，不破解、不改原 App、不联网上传任何数据。
# 会做的事：退出当前微信 → 启动调试副本（需要重新扫码登录）→ 抓 key → 解密本地库。
#
# 用法：
#   bash scripts/wechat-key-macos.sh --dry-run     # 只打印将要执行的命令
#   bash scripts/wechat-key-macos.sh --yes         # 真跑（会退出微信）
#   bash scripts/wechat-key-macos.sh --yes --only prepare
set -euo pipefail

TOOL_REPO="https://github.com/fangtimmy/wechat4-db-decrypt"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$ROOT/.runtime"
TOOL_DIR="$RUNTIME/wechat4-db-decrypt"
YES=0
DRY=0
ONLY=""

for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    --dry-run) DRY=1 ;;
    --only=*) ONLY="${arg#*=}" ;;
    -h|--help) sed -n '1,22p' "$0"; exit 0 ;;
  esac
done

say() { printf '\033[36m[wechat-key]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[wechat-key]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[wechat-key]\033[0m %s\n' "$*" >&2; exit 1; }
run() {
  if [ "$DRY" = "1" ]; then printf '  $ %s\n' "$*"; else eval "$@"; fi
}

[ "$(uname -s)" = "Darwin" ] || die "仅支持 macOS"
[ -d /Applications/WeChat.app ] || die "没找到 /Applications/WeChat.app"

command -v git >/dev/null || die "需要 git"
if command -v uv >/dev/null; then PY="uv"; else PY="python3"; fi
[ "$PY" = "uv" ] || warn "没有 uv，退回 python3（需要 pip 装依赖；推荐装 uv：brew install uv）"

say "步骤一览："
cat <<'TXT'
  1) 克隆开源工具到 .runtime/wechat4-db-decrypt（只读本地代码）
  2) sip.prepare   ：复制 WeChat.app → 调试副本 + 注入 FridaGadget + ad-hoc 重签
  3) keys.hunt     ：退出当前微信 → 启动调试副本（需重新扫码）→ hook CommonCrypto 抓 key
  4) decrypt       ：用抓到的 key 解密 message/*.db 到 decrypted/
  5) 用本仓库脚本把 decrypted 转成数据集
TXT

if [ "$YES" = "0" ] && [ "$DRY" = "0" ]; then
  cat <<'TXT'

这会**退出你正在用的微信**并启动一个调试副本；副本首次启动通常需要重新扫码登录。
原 /Applications/WeChat.app 不会被修改。确认继续请加 --yes 重跑。
TXT
  exit 2
fi

# 1) 工具
if [ ! -d "$TOOL_DIR/.git" ]; then
  say "克隆 $TOOL_REPO"
  run "mkdir -p '$RUNTIME'"
  run "git clone --depth 1 '$TOOL_REPO' '$TOOL_DIR'"
else
  say "工具已存在：$TOOL_DIR（跳过克隆）"
fi

say "安装依赖"
if [ "$PY" = "uv" ]; then
  run "cd '$TOOL_DIR' && uv sync"
else
  run "cd '$TOOL_DIR' && python3 -m pip install -e ."
fi

uvrun() {
  if [ "$PY" = "uv" ]; then echo "cd '$TOOL_DIR' && uv run python -m wxexport.$1"; else echo "cd '$TOOL_DIR' && python3 -m wxexport.$1"; fi
}

case "$ONLY" in
  "") MODULES=("sip.prepare" "keys.hunt" "decrypt") ;;
  *) MODULES=("$ONLY") ;;
esac

for module in "${MODULES[@]}"; do
  say "执行 wxexport.$module"
  run "$(uvrun "$module")"
done

say "查找解密产物"
DBDIR=""
if [ -d "$TOOL_DIR/decrypted" ]; then
  DBDIR="$(find "$TOOL_DIR/decrypted" -maxdepth 3 -type d -name db_storage | head -1 || true)"
  [ -n "$DBDIR" ] || DBDIR="$TOOL_DIR/decrypted"
fi
if [ -n "$DBDIR" ]; then
  say "已解密目录：$DBDIR"
  say "下一步（换成你的昵称与 wxid）："
  printf '  npm run import:wechat -- --dir "%s" --self 我 --self-wxid wxid_xxx\n' "$DBDIR"
  say "wxid 可以从账号目录名推断："
  ls -1 "$HOME/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files" 2>/dev/null | grep -E '^wxid_' | sed 's/^/  /' || true
else
  warn "没找到 decrypted/：看 $TOOL_DIR/hunt.log 与 README，必要时重跑 --only=keys.hunt"
fi
