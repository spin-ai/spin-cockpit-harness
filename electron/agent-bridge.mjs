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
