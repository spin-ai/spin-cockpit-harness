/**
 * Plugin utility process runtime.
 *
 * Loads one plugin's ESM entry, exposes a narrow RPC context, and forwards
 * API/command/event calls to the Electron main process PluginHost.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const port = process.parentPort;
const pluginDir = process.argv[2];
let manifest = null;
let moduleRef = null;
let dataDir = "";

const api = new Map();
const commands = new Map();
const listeners = new Map();
const pending = new Map();
let nextId = 1;

function send(message) {
  try { port?.postMessage(message); } catch { /* host gone */ }
}

function request(method, params = {}) {
  const id = `p${nextId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 30000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (err) => { clearTimeout(timer); reject(err); } });
    send({ type: "api", id, method, params });
  });
}

const ctx = {
  get manifest() { return manifest; },
  get dataDir() { return dataDir; },
  log: {
    info: (message) => send({ type: "log", level: "info", message: String(message) }),
    warn: (message) => send({ type: "log", level: "warn", message: String(message) }),
    error: (message) => send({ type: "log", level: "error", message: String(message) }),
  },
  api: {
    handle(method, handler) {
      api.set(String(method), handler);
      return () => api.delete(String(method));
    },
  },
  commands: {
    register(id, handler) {
      commands.set(String(id), handler);
      return () => commands.delete(String(id));
    },
  },
  events: {
    on(event, handler) {
      const key = String(event);
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(handler);
      return () => listeners.get(key)?.delete(handler);
    },
  },
  settings: {
    get: (key) => request("settings.get", { key: String(key) }),
    set: (key, value) => request("settings.set", { key: String(key), value }),
  },
  storage: {
    get: (key) => request("storage.get", { key: String(key) }),
    set: (key, value) => request("storage.set", { key: String(key), value }),
    delete: (key) => request("storage.delete", { key: String(key) }),
  },
  todos: {
    list: (filter) => request("todos.list", { filter: filter || {} }),
    get: (id) => request("todos.get", { id: String(id) }),
    create: (input) => request("todos.create", { input: input || {} }),
    update: (id, patch) => request("todos.update", { id: String(id), patch: patch || {} }),
  },
  runs: {
    list: (filter) => request("runs.list", { filter: filter || {} }),
    stop: (runId) => request("runs.stop", { runId: String(runId) }),
  },
  missions: {
    list: (filter) => request("missions.list", { filter: filter || {} }),
    finish: (id, summary) => request("missions.finish", { id: String(id), summary: String(summary || "") }),
  },
  fs: {
    pickDirectory: (options) => request("fs.pickDirectory", { options: options || {} }),
    readProjectFile: (rel) => request("fs.readProjectFile", { rel: String(rel) }),
    writeProjectFile: (rel, text) => request("fs.writeProjectFile", { rel: String(rel), text: String(text) }),
    reveal: (file) => request("fs.reveal", { file: String(file) }),
  },
  net: {
    fetchJson: async (url, init) => {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  },
  executors: { register: () => { throw new Error("executor plugins are not enabled yet"); } },
  tools: { register: () => { throw new Error("agent tool plugins are not enabled yet"); } },
  chat: {
    draft: (input) => request("chat.draft", { input: input || {} }),
  },
  links: {
    attach: (todoId, link) => request("links.attach", { todoId: String(todoId), link: link || {} }),
    list: (todoId) => request("links.list", { todoId: String(todoId) }),
  },
  secrets: {
    get: (key) => request("secrets.get", { key: String(key) }),
    set: (key, value) => request("secrets.set", { key: String(key), value: String(value) }),
    delete: (key) => request("secrets.delete", { key: String(key) }),
  },
  notify: (message, options) => request("notify", { message: String(message), options: options || {} }),
  ui: {
    openView: (id) => request("ui.openView", { id: String(id) }),
  },
};

function onMessage(event) {
  const msg = event?.data ?? event;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "response") {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || "plugin API failed"));
    return;
  }
  if (msg.type === "activate") {
    manifest = msg.manifest;
    dataDir = msg.dataDir || "";
    (async () => {
      try {
        moduleRef = await import(pathToFileURL(path.join(pluginDir, manifest.main || "main.mjs")).href);
        if (typeof moduleRef.activate !== "function") throw new Error("plugin has no activate(ctx) export");
        await moduleRef.activate(ctx);
        send({ type: "ready" });
      } catch (err) {
        send({ type: "activate-error", error: String(err?.stack || err) });
      }
    })();
    return;
  }
  if (msg.type === "invoke") {
    (async () => {
      try {
        const handler = api.get(String(msg.method));
        if (!handler) throw new Error(`unknown plugin method: ${msg.method}`);
        const result = await handler(msg.params || {});
        send({ type: "invoke-result", id: msg.id, ok: true, result });
      } catch (err) {
        send({ type: "invoke-result", id: msg.id, ok: false, error: String(err?.message || err) });
      }
    })();
    return;
  }
  if (msg.type === "command") {
    (async () => {
      try {
        const handler = commands.get(String(msg.commandId));
        if (!handler) throw new Error(`command not registered: ${msg.commandId}`);
        send({ type: "command-result", id: msg.id, ok: true, result: await handler(msg.args) });
      } catch (err) {
        send({ type: "command-result", id: msg.id, ok: false, error: String(err?.message || err) });
      }
    })();
    return;
  }
  if (msg.type === "event") {
    const set = listeners.get(String(msg.event));
    if (!set) return;
    for (const handler of set) {
      Promise.resolve(handler(msg.payload)).catch((err) => send({ type: "log", level: "error", message: `event ${msg.event}: ${String(err?.message || err)}` }));
    }
    return;
  }
  if (msg.type === "deactivate") {
    Promise.resolve(moduleRef?.deactivate?.()).finally(() => process.exit(0));
  }
}

port?.on("message", onMessage);
port?.start?.();
process.on("uncaughtException", (err) => send({ type: "log", level: "error", message: String(err?.stack || err) }));
process.on("unhandledRejection", (err) => send({ type: "log", level: "error", message: String(err?.stack || err) }));
