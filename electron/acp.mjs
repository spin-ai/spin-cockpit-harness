import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const DSH_BIN = process.env.DSH_BIN || "dsh";
const DSH_HOME = process.env.DSH_HOME || "";

/**
 * GUI 启动的 Electron 通常拿不到登录 shell 的 PATH；补上常见安装位置，
 * 否则从 Finder 打开 dmg 时 `spawn("dsh")` 会 ENOENT。
 */
export function dshPathEnv(base = process.env) {
  const extras = [
    path.join(os.homedir(), ".local", "bin"),
    path.join(os.homedir(), ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  const parts = String(base.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of extras) if (!parts.includes(dir)) parts.push(dir);
  return { ...base, PATH: parts.join(path.delimiter) };
}

export class AcpClient extends EventEmitter {
  constructor({ cwd, ssh, bin, home, model, effort }) {
    super();
    this.cwd = cwd;
    this.bin = bin || DSH_BIN;
    this.home = home || DSH_HOME;
    this.model = model || process.env.DSH_MODEL || "";
    this.effort = effort || process.env.DSH_EFFORT || "";
    this.nextId = 1;
    this.pending = new Map();
    this.permissions = new Map();
    this.proc = null;
    this.sessionId = null;
    this.closed = false;
    this.stderrTail = "";

    const env = dshPathEnv();
    if (this.home) env.DSH_HOME = this.home;
    if (ssh && ssh.host) {
      const target = ssh.user ? `${ssh.user}@${ssh.host}` : ssh.host;
      const args = ["-o", "BatchMode=yes", "-o", "ServerAliveInterval=15"];
      if (ssh.port) args.push("-p", String(ssh.port));
      args.push(target, `${this.bin} --profile acp`);
      this.proc = spawn("ssh", args, { env, stdio: ["pipe", "pipe", "pipe"] });
    } else {
      this.proc = spawn(this.bin, ["--profile", "acp"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    }
    this.proc.on("exit", (code, signal) => {
      this.closed = true;
      const detail = `dsh exited ${code ?? signal}`;
      for (const { reject } of this.pending.values()) {
        const err = new Error(detail);
        err.stderr = this.stderrTail;
        reject(err);
      }
      this.pending.clear();
      this.emit("exit", { code, signal });
    });
    this.proc.stderr.on("data", (b) => {
      const text = b.toString();
      this.stderrTail = (this.stderrTail + text).slice(-16000);
      this.emit("stderr", text);
    });
    readline.createInterface({ input: this.proc.stdout }).on("line", (line) => this.#line(line));
  }

  async start() {
    await this.request("initialize", {
      protocolVersion: 2,
      info: { name: "cockpit-harness", version: "0.2.0" },
      capabilities: {},
    }, 20000);
  }

  async newSession(cwd = this.cwd) {
    const res = await this.request("session/new", { cwd, mcpServers: [] });
    this.sessionId = res.sessionId;
    return res;
  }

  async configure() {
    const model = this.model;
    const effort = this.effort;
    if (model) { try { await this.request("session/set_config_option", { sessionId: this.sessionId, configId: "model", value: model }); } catch { /* ignore */ } }
    if (effort) { try { await this.request("session/set_config_option", { sessionId: this.sessionId, configId: "reasoning_effort", value: effort }); } catch { /* ignore */ } }
  }

  prompt(text) {
    return this.request("session/prompt", { sessionId: this.sessionId, prompt: [{ type: "text", text }] }, 600000);
  }

  cancel() { if (this.sessionId) this.notify("session/cancel", { sessionId: this.sessionId }); }

  async close() {
    try { if (this.sessionId) await this.request("session/close", { sessionId: this.sessionId }, 2000); } catch { /* ignore */ }
    try { this.proc.stdin.end(); } catch { /* ignore */ }
    setTimeout(() => { try { this.proc.kill("SIGTERM"); } catch { /* ignore */ } }, 200);
  }

  request(method, params, timeoutMs = 120000) {
    if (!this.proc || this.closed) return Promise.reject(new Error("dsh not running"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params) { this.#send({ jsonrpc: "2.0", method, params }); }

  respondPermission(requestId, allow, optionId = "") {
    const record = this.permissions.get(String(requestId));
    if (!record) return false;
    this.permissions.delete(String(requestId));
    const { id, params } = record;
    const options = params.options || [];
    const option = (optionId && options.find((o) => String(o.optionId) === String(optionId)))
      || (allow
        ? options.find((o) => String(o.kind || "").startsWith("allow")) || options[0]
        : options.find((o) => String(o.kind || "").startsWith("reject")) || options[options.length - 1]);
    this.#send({
      jsonrpc: "2.0", id,
      result: option?.optionId
        ? { outcome: { outcome: "selected", optionId: option.optionId } }
        : { outcome: { outcome: "cancelled" } },
    });
    return true;
  }

  #send(msg) { if (this.proc?.stdin.writable) this.proc.stdin.write(JSON.stringify(msg) + "\n"); }

  #line(line) {
    const text = line.trim();
    if (!text) return;
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || "acp error"), { data: msg.error.data }));
      else p.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined && msg.method) {
      if (msg.method === "session/request_permission") {
        const params = msg.params || {};
        this.permissions.set(String(msg.id), { id: msg.id, params });
        this.emit("permission", { ...params, requestId: String(msg.id) });
      } else {
        this.#send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unsupported" } });
      }
      return;
    }
    if (msg.method) this.emit("notification", msg.method, msg.params);
  }
}
