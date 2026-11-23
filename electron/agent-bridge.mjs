/**
 * 终端 Agent 的窄回调通道：只在「本次 run / 这条终端」范围内做三件事。
 *
 * 为什么不是 ORCA 那种全量 CLI：我们的内置 bot 直接走主进程工具表，不需要子进程 + token；
 * 真正缺的是终端里的 pty agent —— 它只有 shell，没有 IPC。这里给它一条只读身份、
 * 写一条进度、写一次结论的最小入口；不暴露任意 action、不绕过审批。
 */

export const AGENT_CLI_COMMANDS = ["whoami", "note", "report", "ask"];

const VALUE_FLAGS = new Set(["--text", "--text-file", "--timeout"]);

/** argv → { command, text, textFile, json, error }。不做 I/O，单测直接覆盖。 */
export function parseAgentCliArgs(argv = []) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
  const command = args[0] || "";
  if (!AGENT_CLI_COMMANDS.includes(command)) {
    return { error: `用法：harness ${AGENT_CLI_COMMANDS.join(" | ")} [--text "..."] [--text-file path]` };
  }
  let text = "";
  let textFile = "";
  let timeout = "";
  let json = false;
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") { json = true; continue; }
    if (!VALUE_FLAGS.has(arg)) return { error: `不认识参数：${arg}` };
    const value = args[i + 1];
    if (value === undefined || value === "" || VALUE_FLAGS.has(value)) return { error: `${arg} 需要一个值` };
    if (arg === "--text") text = value;
    else if (arg === "--text-file") textFile = value;
    else {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0) return { error: "--timeout 需要正数秒" };
      timeout = String(Math.round(seconds));
    }
    i += 1;
  }
  if (["note", "report", "ask"].includes(command) && !text && !textFile) {
    return { error: `${command} 需要 --text "..." 或 --text-file <path>` };
  }
  return { command, text, textFile, timeout, json };
}

/** 主进程 / CLI 共用的截断口径 */
export function clipAgentText(text, max = 4000) {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** 生成 PATH 里的 `harness` 垫片：Electron 以 node 模式跑 CLI 脚本。 */
export function agentCliShimContent({ platform = process.platform, electronPath = "", scriptPath = "" } = {}) {
  if (!electronPath || !scriptPath) throw new Error("缺少 electronPath / scriptPath");
  if (platform === "win32") {
    return [
      "@echo off",
      "setlocal",
      'set "ELECTRON_RUN_AS_NODE=1"',
      `"${electronPath}" "${scriptPath}" %*`,
      "",
    ].join("\r\n");
  }
  const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
  return [
    "#!/bin/sh",
    `exec env ELECTRON_RUN_AS_NODE=1 ${quote(electronPath)} ${quote(scriptPath)} "$@"`,
    "",
  ].join("\n");
}

export function agentCliBinName(platform = process.platform) {
  return platform === "win32" ? "harness.cmd" : "harness";
}

/**
 * 远端 host 的 PATH 垫片（POSIX shell，只依赖 curl + base64）。
 * 为什么不是 Node：远端只保证有 shell；CLI 正文用 base64 传，避免 shell 里拼 JSON 的引号地狱。
 * 这是 pty / ACP 远端 agent 的最小回调；和本机 `harness` 共用同一个 token 服务。
 */
export function remoteAgentCliShimContent() {
  // String.raw：保留 sh 的反斜杠；脚本里不要用 ${...}（JS 会当成插值）
  return String.raw`#!/bin/sh
set -e
url="$COCKPIT_AGENT_URL"
token="$COCKPIT_AGENT_TOKEN"
if [ -z "$url" ] || [ -z "$token" ]; then
  echo "这条终端不在受管 run 里（没有 COCKPIT_AGENT_URL / TOKEN）" >&2
  exit 2
fi
cmd="$1"
if [ -z "$cmd" ]; then
  echo "用法：harness whoami | note --text ... | report --text ... | ask --text ..." >&2
  exit 2
fi
shift || true
text=""
timeout=""
while [ $# -gt 0 ]; do
  case "$1" in
    --text) text="$2"; shift 2 ;;
    --text-file) text=$(cat "$2"); shift 2 ;;
    --timeout) timeout="$2"; shift 2 ;;
    --json) shift ;;
    *) echo "不认识参数：$1" >&2; exit 2 ;;
  esac
done
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
call() {
  curl -sS -X POST "$url/call" \
    -H "Authorization: Bearer $token" \
    -H "content-type: application/json" \
    --data "$1"
}
case "$cmd" in
  whoami)
    call '{"command":"whoami"}'
    ;;
  note|report)
    if [ -z "$text" ]; then echo "$cmd 需要 --text 或 --text-file" >&2; exit 2; fi
    body=$(printf '{"command":"%s","textB64":"%s"}' "$cmd" "$(b64 "$text")")
    out=$(call "$body")
    echo "$out"
    case "$out" in *'"ok":true'*) exit 0 ;; *) exit 1 ;; esac
    ;;
  ask)
    if [ -z "$text" ]; then echo "ask 需要 --text 或 --text-file" >&2; exit 2; fi
    if [ -z "$timeout" ]; then timeout=300; fi
    body=$(printf '{"command":"ask","textB64":"%s","timeout":"%s"}' "$(b64 "$text")" "$timeout")
    out=$(call "$body")
    id=$(printf '%s' "$out" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    echo "$out"
    if [ -z "$id" ]; then exit 1; fi
    start=$(date +%s)
    while :; do
      now=$(date +%s)
      if [ $((now - start)) -ge "$timeout" ]; then echo "审批超时" >&2; exit 2; fi
      sleep 1
      poll=$(call "{\"command\":\"ask_status\",\"id\":\"$id\"}")
      case "$poll" in
        *'"status":"answered"'*)
          case "$poll" in *'"allow":true'*) echo "✓ 允许"; exit 0 ;; *) echo "✗ 拒绝"; exit 1 ;; esac
          ;;
        *'"status":"expired"'*) echo "审批超时" >&2; exit 2 ;;
      esac
    done
    ;;
  *) echo "不认识命令：$cmd" >&2; exit 2 ;;
esac
`;
}
