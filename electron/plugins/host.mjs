/**
 * PluginHost: discovery, lifecycle, commands, events and a small trusted API.
 *
 * Plugins run in Electron utilityProcesses. This is isolation for crashes, not
 * an OS sandbox: installing a plugin means trusting its code.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { shell, utilityProcess } from "electron";

const API_VERSION = 1;
const PLUGIN_MANIFEST = "plugin.json";

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function pluginMainPath(dir, manifest) {
  const main = String(manifest?.main || "main.mjs").replace(/^[/\\]+/, "");
  const full = path.resolve(dir, main);
  if (full !== dir && !full.startsWith(dir + path.sep)) throw new Error("plugin main outside plugin directory");
  return full;
}

function validateManifest(raw, dir) {
  if (!raw || typeof raw !== "object") throw new Error("plugin.json is invalid");
  const id = String(raw.id || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,100}$/.test(id)) throw new Error("plugin.id is invalid");
  const apiVersion = Number(raw.apiVersion || 0);
  if (apiVersion !== API_VERSION) throw new Error(`plugin requires apiVersion ${apiVersion}, host supports ${API_VERSION}`);
  if (!raw.name || !raw.version) throw new Error("plugin name/version is required");
  if (!raw.main) throw new Error("plugin.main is required");
  pluginMainPath(dir, raw);
  const permissions = Array.isArray(raw.permissions) ? raw.permissions.map(String) : [];
  return {
    ...raw,
    id,
    name: String(raw.name).slice(0, 120),
    version: String(raw.version).slice(0, 40),
    apiVersion,
    permissions,
    contributes: raw.contributes && typeof raw.contributes === "object" ? raw.contributes : {},
  };
}

export class PluginHost {
  constructor({ app, getWin, store, actions, dialog, onChange }) {
    this.app = app;
    this.getWin = getWin;
    this.store = store;
    this.actions = actions;
    this.dialog = dialog;
    this.onChange = onChange;
    this.children = new Map();
    this.activating = new Map();
    this.pending = new Map();
    this.logs = new Map();
    this.started = false;
    const here = path.dirname(fileURLToPath(import.meta.url));
    this.builtinRoot = app.isPackaged
      ? path.join(process.resourcesPath, "plugins")
      : path.join(here, "..", "..", "plugins");
    this.userRoot = path.join(app.getPath("userData"), "plugins");
    this.runtimePath = app.isPackaged
      ? path.join(process.resourcesPath, "app.asar.unpacked", "electron", "plugins", "runtime.mjs")
      : path.join(here, "runtime.mjs");
    this.nextRequest = 1;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    fs.mkdirSync(this.userRoot, { recursive: true });
    await this.discover();
    for (const plugin of this.store.state.plugins || []) {
      if (plugin.enabled) await this.startPlugin(plugin).catch((err) => this.setError(plugin, err));
    }
    this.sync();
  }

  sync() {
    this.store.persist();
    this.onChange?.();
  }

  statePlugins() {
    if (!Array.isArray(this.store.state.plugins)) this.store.state.plugins = [];
    return this.store.state.plugins;
  }

  async discover() {
    const found = [];
    const seen = new Set();
    // builtin 先于 userRoot：同一个 id 的旧用户副本不能覆盖内置插件
    for (const [root, builtin] of [[this.builtinRoot, true], [this.userRoot, false]]) {
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        const raw = readJson(path.join(dir, PLUGIN_MANIFEST));
        if (!raw) continue;
        try {
          const manifest = validateManifest(raw, dir);
          if (seen.has(manifest.id)) {
            console.warn(`[plugins] skip duplicate ${manifest.id} at ${dir} (prefer builtin)`);
            continue;
          }
          seen.add(manifest.id);
          found.push({ manifest, dir, builtin });
        } catch (err) {
          console.warn(`[plugins] invalid ${dir}: ${String(err?.message || err)}`);
        }
      }
    }
    const state = this.statePlugins();
    for (const item of found) {
      const existing = state.find((p) => p.id === item.manifest.id);
      if (!existing) {
        state.push({
          id: item.manifest.id, version: item.manifest.version, path: item.dir,
          enabled: item.builtin && item.manifest.defaultEnabled !== false,
          builtin: item.builtin, manifest: item.manifest, permissions: item.manifest.permissions || [],
          installedAt: Date.now(), lastError: null, lastRunAt: null,
        });
      } else {
        existing.version = item.manifest.version;
        existing.path = item.dir;
        existing.builtin = item.builtin;
        existing.manifest = item.manifest;
        existing.permissions = item.manifest.permissions || [];
      }
    }
    // Remove records whose plugin disappeared from disk (except failed installs).
    this.store.state.plugins = state.filter((p) => found.some((f) => f.manifest.id === p.id) || !p.path || fs.existsSync(p.path));
  }

  record(id) {
    return this.statePlugins().find((p) => p.id === id) || null;
  }

  dataDir(id) {
    const dir = path.join(this.userRoot, id, "data");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  logPath(id) {
    const dir = path.join(this.userRoot, id, "logs");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "runtime.log");
  }

  appendLog(id, level, message) {
    const line = `[${new Date().toISOString()}] ${level} ${String(message).slice(0, 4000)}\n`;
    try { fs.appendFileSync(this.logPath(id), line); } catch { /* ignore */ }
    if (level === "error") console.warn(`[plugin:${id}] ${message}`);
  }

  async executeCommand(pluginId, commandId, args = {}) {
    const plugin = this.record(pluginId);
    if (!plugin) throw new Error("plugin not found");
    if (!plugin.enabled) throw new Error("plugin is disabled");
    const child = await this.startPlugin(plugin).catch((err) => { this.setError(plugin, err); throw err; });
    return this.command(child, plugin, commandId, args);
  }

  async command(child, plugin, commandId, args = {}) {
    return new Promise((resolve, reject) => {
      const id = `c${this.nextRequest++}`;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("plugin command timeout")); }, 30000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      child.postMessage({ type: "command", id, commandId, args });
    });
  }

  async invoke(pluginId, method, params = {}) {
    const plugin = this.record(pluginId);
    if (!plugin) throw new Error("plugin not found");
    if (!plugin.enabled) throw new Error("plugin is disabled");
    const child = await this.startPlugin(plugin);
    return new Promise((resolve, reject) => {
      const id = `v${this.nextRequest++}`;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("plugin request timeout")); }, 30000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      child.postMessage({ type: "invoke", id, method, params });
    });
  }

  async startPlugin(plugin) {
    // 正在激活时不要去拿「还没 ready」的 child：那会让 invoke 早于 api.handle 注册，
    // 报 "unknown plugin method: wiki.*"（启动后第一次点页面很容易撞上）
    if (this.activating?.has(plugin.id)) return this.activating.get(plugin.id);
    if (this.children.has(plugin.id)) return this.children.get(plugin.id);
    if (!plugin.enabled) throw new Error("plugin is disabled");
    if (!fs.existsSync(this.runtimePath)) throw new Error(`plugin runtime not found: ${this.runtimePath}`);
    if (!plugin.manifest?.main) throw new Error("plugin main is missing");
    const dir = path.resolve(plugin.path);
    pluginMainPath(dir, plugin.manifest);
    const child = utilityProcess.fork(this.runtimePath, [dir], {
      env: { ...process.env, COCKPIT_PLUGIN_ID: plugin.id, COCKPIT_PLUGIN_DIR: dir },
      stdio: "pipe",
    });
    this.children.set(plugin.id, child);
    child.on("message", (message) => this.handleMessage(plugin.id, message));
    child.on("exit", (code) => {
      this.children.delete(plugin.id);
      const p = this.record(plugin.id);
      if (p && p.enabled) this.appendLog(plugin.id, "warn", `runtime exited (${code})`);
      this.onChange?.();
    });
    child.stderr?.on("data", (buf) => this.appendLog(plugin.id, "info", buf.toString().slice(-2000)));
    const activation = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("plugin activate timeout")), 15000);
        const ready = (evt) => {
          const msg = evt?.data ?? evt;
          if (msg?.type === "ready") { clearTimeout(timer); child.off("message", ready); resolve(); }
          else if (msg?.type === "activate-error") { clearTimeout(timer); child.off("message", ready); reject(new Error(msg.error)); }
        };
      child.on("message", ready);
      child.postMessage({
        type: "activate",
        manifest: plugin.manifest,
        dir,
        dataDir: this.dataDir(plugin.id),
      });
    }).finally(() => this.activating.delete(plugin.id));
    this.activating.set(plugin.id, activation);
    try {
      await activation;
    } catch (err) {
      this.stopPlugin(plugin.id, false);
      throw err;
    }
    plugin.lastError = null;
    plugin.lastRunAt = Date.now();
    this.appendLog(plugin.id, "info", `activated ${plugin.version}`);
    this.sync();
    return child;
  }

  stopPlugin(id, deactivate = true) {
    const child = this.children.get(id);
    if (!child) return;
    this.children.delete(id);
    try { child.postMessage({ type: "deactivate" }); } catch { /* ignore */ }
    setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, deactivate ? 800 : 0);
  }

  async setEnabled(id, enabled) {
    const plugin = this.record(id);
    if (!plugin) throw new Error("plugin not found");
    plugin.enabled = Boolean(enabled);
    if (plugin.enabled) await this.startPlugin(plugin).catch((err) => { this.setError(plugin, err); throw err; });
    else this.stopPlugin(id, true);
    this.sync();
    return plugin;
  }

  setError(plugin, err) {
    plugin.lastError = String(err?.message || err).slice(0, 800);
    this.appendLog(plugin.id, "error", plugin.lastError);
    this.sync();
  }

  async handleMessage(pluginId, message) {
    const msg = message?.data ?? message;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "log") { this.appendLog(pluginId, msg.level || "info", msg.message || ""); return; }
    if (msg.type === "ready" || msg.type === "activate-error") return;
    if (msg.type === "invoke-result" || msg.type === "command-result") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || "plugin failed"));
      return;
    }
    if (msg.type === "api") {
      try {
        const result = await this.handleApi(pluginId, msg.method, msg.params || {});
        this.children.get(pluginId)?.postMessage({ type: "response", id: msg.id, ok: true, result });
      } catch (err) {
        this.children.get(pluginId)?.postMessage({ type: "response", id: msg.id, ok: false, error: String(err?.message || err).slice(0, 1000) });
      }
    }
  }

  kv(pluginId, key, scope = "settings") {
    const id = scope === "storage" ? `storage:${key}` : key;
    if (!Array.isArray(this.store.state.pluginKv)) this.store.state.pluginKv = [];
    return this.store.state.pluginKv.find((x) => x.pluginId === pluginId && x.key === id) || null;
  }

  setKv(pluginId, key, value, scope = "settings") {
    const id = scope === "storage" ? `storage:${key}` : key;
    if (!Array.isArray(this.store.state.pluginKv)) this.store.state.pluginKv = [];
    const row = this.store.state.pluginKv.find((x) => x.pluginId === pluginId && x.key === id);
    if (row) { row.value = value; row.updatedAt = Date.now(); }
    else this.store.state.pluginKv.push({ pluginId, key: id, value, updatedAt: Date.now() });
    this.store.persist();
  }

  async handleApi(pluginId, method, params) {
    const plugin = this.record(pluginId);
    if (!plugin) throw new Error("plugin not found");
    const permission = (name) => (plugin.permissions || []).includes(name);
    switch (method) {
      case "settings.get": return this.kv(pluginId, String(params.key), "settings")?.value ?? null;
      case "settings.set": this.setKv(pluginId, String(params.key), params.value, "settings"); return true;
      case "storage.get": return this.kv(pluginId, String(params.key), "storage")?.value ?? null;
      case "storage.set": this.setKv(pluginId, String(params.key), params.value, "storage"); return true;
      case "storage.delete": {
        this.store.state.pluginKv = (this.store.state.pluginKv || []).filter((x) => !(x.pluginId === pluginId && x.key === `storage:${params.key}`));
        this.store.persist();
        return true;
      }
      case "todos.list": {
        const list = this.store.state.todos.map((t) => ({ id: t.id, key: t.key, title: t.title, desc: t.desc, status: t.status, projectId: t.projectId }));
        return list;
      }
      case "todos.get": return this.store.state.todos.find((t) => t.id === params.id) || null;
      case "todos.create": {
        if (!permission("tasks:write")) throw new Error("permission denied: tasks:write");
        const input = params.input || {};
        const todo = this.actions.createTodo({ title: String(input.title || "").slice(0, 200), desc: String(input.desc || ""), priority: input.priority || "P2" });
        if (Array.isArray(input.tags) && input.tags.length) {
          todo.tags = [...new Set([...(todo.tags || []), ...input.tags.map(String)])];
          todo.updatedAt = Date.now();
          this.store.persist();
        }
        return { id: todo.id, key: todo.key, title: todo.title, status: todo.status };
      }
      case "todos.update": {
        if (!permission("tasks:write")) throw new Error("permission denied: tasks:write");
        const patch = params.patch || {};
        return this.actions.updateTodo({ id: params.id, ...patch });
      }
      case "runs.list": return this.store.state.runs.map((r) => ({ id: r.id, todoId: r.todoId, status: r.status, error: r.error }));
      case "runs.stop": this.actions.stop({ runId: params.runId }); return true;
      case "missions.list": return this.store.state.todos.filter((t) => t.kind === "mission").map((t) => ({ id: t.id, title: t.title, state: t.missionState, status: t.status }));
      case "missions.finish": {
        const mission = this.store.state.todos.find((t) => t.id === params.id && t.kind === "mission");
        if (!mission) throw new Error("mission not found");
        if (mission.missionState !== "in_review") throw new Error("mission is not in review");
        this.actions.confirm({ id: mission.id });
        return true;
      }
      case "links.attach": {
        if (!Array.isArray(this.store.state.todoLinks)) this.store.state.todoLinks = [];
        const link = params.link || {};
        const row = { id: `tl${crypto.randomUUID().slice(0, 8)}`, todoId: params.todoId, pluginId, kind: String(link.kind || "external"), ref: String(link.ref || ""), title: String(link.title || ""), createdAt: Date.now() };
        this.store.state.todoLinks.push(row);
        this.store.persist();
        return row;
      }
      case "links.list": return (this.store.state.todoLinks || []).filter((l) => l.todoId === params.todoId && l.pluginId === pluginId);
      case "fs.pickDirectory": {
        if (!permission("fs:vault")) throw new Error("permission denied: fs:vault");
        const res = await this.dialog.showOpenDialog(this.getWin(), { properties: ["openDirectory", "createDirectory"] });
        return res.canceled ? null : res.filePaths[0] || null;
      }
      case "fs.reveal": {
        if (!permission("fs:vault")) throw new Error("permission denied: fs:vault");
        shell.showItemInFolder(String(params.file || ""));
        return true;
      }
      case "fs.readProjectFile": {
        if (!permission("fs:project")) throw new Error("permission denied: fs:project");
        const root = this.store.state.projectPath || process.cwd();
        const full = path.resolve(root, String(params.rel || ""));
        if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("path outside project");
        return fs.readFileSync(full, "utf8");
      }
      case "fs.writeProjectFile": {
        if (!permission("fs:project")) throw new Error("permission denied: fs:project");
        const root = this.store.state.projectPath || process.cwd();
        const full = path.resolve(root, String(params.rel || ""));
        if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("path outside project");
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, String(params.text || ""));
        return true;
      }
      case "chat.draft": {
        const input = params.input || {};
        const win = this.getWin();
        win?.webContents.send("harness:plugin-chat-draft", { text: String(input.text || ""), context: input.context || null });
        return true;
      }
      case "notify": {
        this.getWin()?.webContents.send("harness:plugin-notify", { message: String(params.message || ""), level: params.options?.level || "info" });
        return true;
      }
      case "ui.openView": {
        this.getWin()?.webContents.send("harness:plugin-open-view", { id: String(params.id || "") });
        return true;
      }
      case "secrets.get": return null;
      case "secrets.set": return true;
      case "secrets.delete": return true;
      default: throw new Error(`unsupported plugin API: ${method}`);
    }
  }

  commands() {
    const out = [];
    for (const p of this.statePlugins()) {
      if (!p.enabled) continue;
      for (const c of p.manifest?.contributes?.commands || []) out.push({ pluginId: p.id, id: c.id, title: c.title || c.id, description: c.description || "" });
    }
    return out;
  }

  views() {
    const out = [];
    for (const p of this.statePlugins()) {
      if (!p.enabled) continue;
      for (const v of p.manifest?.contributes?.views || []) out.push({ pluginId: p.id, ...v });
    }
    return out;
  }

  emit(event, payload) {
    for (const [id, child] of this.children) {
      const plugin = this.record(id);
      if (!plugin?.enabled) continue;
      const events = plugin.manifest?.contributes?.events || [];
      if (!events.includes(event)) continue;
      try { child.postMessage({ type: "event", event, payload }); } catch { /* ignore */ }
    }
  }

  async installFromZip(file) {
    const zip = new AdmZip(file);
    const temp = path.join(this.userRoot, `.install-${crypto.randomUUID()}`);
    fs.mkdirSync(temp, { recursive: true });
    try {
      for (const entry of zip.getEntries()) {
        const name = String(entry.entryName || "").replace(/\\/g, "/");
        if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("插件包包含非法路径");
      }
      zip.extractAllTo(temp, true);
      let root = temp;
      const direct = path.join(temp, PLUGIN_MANIFEST);
      if (!fs.existsSync(direct)) {
        const dirs = fs.readdirSync(temp, { withFileTypes: true }).filter((e) => e.isDirectory());
        const found = dirs.find((e) => fs.existsSync(path.join(temp, e.name, PLUGIN_MANIFEST)));
        if (!found) throw new Error("插件包没有 plugin.json");
        root = path.join(temp, found.name);
      }
      return await this.installFromFolder(root);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }

  async installFromFolder(dir) {
    if (!dir) return null;
    const raw = readJson(path.join(dir, PLUGIN_MANIFEST));
    if (!raw) throw new Error("选择的目录没有 plugin.json");
    const manifest = validateManifest(raw, dir);
    const target = path.join(this.userRoot, manifest.id);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(dir, target, { recursive: true });
    const plugin = validateManifest(raw, target);
    let record = this.record(plugin.id);
    if (record) {
      record.path = target; record.version = plugin.version; record.manifest = plugin; record.permissions = plugin.permissions || []; record.enabled = false;
    } else {
      record = {
        id: plugin.id, version: plugin.version, path: target, enabled: false, builtin: false,
        manifest: plugin, permissions: plugin.permissions || [], installedAt: Date.now(), lastError: null, lastRunAt: null,
      };
      this.statePlugins().push(record);
    }
    this.sync();
    return record;
  }

  async remove(id) {
    const plugin = this.record(id);
    if (!plugin) throw new Error("plugin not found");
    if (plugin.builtin) throw new Error("内置插件不能卸载，只能禁用");
    this.stopPlugin(id, false);
    this.store.state.plugins = this.statePlugins().filter((p) => p.id !== id);
    this.store.state.pluginKv = (this.store.state.pluginKv || []).filter((kv) => kv.pluginId !== id);
    this.store.state.todoLinks = (this.store.state.todoLinks || []).filter((l) => l.pluginId !== id);
    fs.rmSync(plugin.path, { recursive: true, force: true });
    this.sync();
    return true;
  }

  async stopAll() {
    for (const id of [...this.children.keys()]) this.stopPlugin(id, false);
  }
}
