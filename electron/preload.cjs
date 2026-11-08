const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("harness", {
  getState: () => ipcRenderer.invoke("harness:state"),
  action: (type, payload) => ipcRenderer.invoke("harness:action", { type, payload }),
  onState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on("harness:state", handler);
    return () => ipcRenderer.removeListener("harness:state", handler);
  },
  chooseProject: () => ipcRenderer.invoke("harness:chooseProject"),
  pickProjectFolder: () => ipcRenderer.invoke("harness:pickProjectFolder"),
  createTerminal: (cwd, opts = {}) => ipcRenderer.invoke("terminal:create", { cwd, ...opts }),
  attachTerminal: (id) => ipcRenderer.invoke("terminal:attach", { id }),
  terminalInput: (id, data) => ipcRenderer.invoke("terminal:input", { id, data }),
  closeTerminal: (id) => ipcRenderer.invoke("terminal:close", { id }),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
  clipboardRead: () => ipcRenderer.invoke("clipboard:read"),
  quickCaptureSave: (text) => ipcRenderer.invoke("quick-capture:save", { text }),
  quickCaptureClose: () => ipcRenderer.invoke("quick-capture:close"),
  exportPdf: (html, title) => ipcRenderer.invoke("wiki:exportPdf", { html, title }),
  onQuickCaptureSubmit: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("quick-capture:submit", handler);
    return () => ipcRenderer.removeListener("quick-capture:submit", handler);
  },
  clipboardWrite: (text) => ipcRenderer.invoke("clipboard:write", { text }),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", { url }),
  filesList: (rel, root) => ipcRenderer.invoke("files:list", { rel, root }),
  filesRead: (rel, root) => ipcRenderer.invoke("files:read", { rel, root }),
  filesCreate: (rel, kind, name, root) => ipcRenderer.invoke("files:create", { rel, kind, name, root }),
  filesRename: (rel, name, root) => ipcRenderer.invoke("files:rename", { rel, name, root }),
  filesDuplicate: (rel, root) => ipcRenderer.invoke("files:duplicate", { rel, root }),
  filesTrash: (rel, root) => ipcRenderer.invoke("files:trash", { rel, root }),
  filesReveal: (rel, root) => ipcRenderer.invoke("files:reveal", { rel, root }),
  filesWrite: (rel, root, text) => ipcRenderer.invoke("files:write", { rel, root, text }),
  docsPick: () => ipcRenderer.invoke("docs:pick"),
  docsRead: (paths) => ipcRenderer.invoke("docs:read", { paths }),
  // Git（Source Control）：全部在项目根目录跑 git CLI
  gitStatus: (root) => ipcRenderer.invoke("git:status", { root }),
  gitDiff: (root, path, staged) => ipcRenderer.invoke("git:diff", { root, path, staged }),
  gitStage: (root, paths) => ipcRenderer.invoke("git:stage", { root, paths }),
  gitUnstage: (root, paths) => ipcRenderer.invoke("git:unstage", { root, paths }),
  gitDiscard: (root, paths) => ipcRenderer.invoke("git:discard", { root, paths }),
  gitCommit: (root, message, amend) => ipcRenderer.invoke("git:commit", { root, message, amend }),
  gitPush: (root) => ipcRenderer.invoke("git:push", { root }),
  gitPull: (root) => ipcRenderer.invoke("git:pull", { root }),
  gitBranches: (root) => ipcRenderer.invoke("git:branches", { root }),
  gitCheckout: (root, branch, create) => ipcRenderer.invoke("git:checkout", { root, branch, create }),
  gitLog: (root) => ipcRenderer.invoke("git:log", { root }),
  gitInit: (root) => ipcRenderer.invoke("git:init", { root }),
  previewPick: (webContentsId, root) => ipcRenderer.invoke("preview:pick", { webContentsId, root }),
  previewCancel: (webContentsId) => ipcRenderer.invoke("preview:cancel", { webContentsId }),
  previewDetach: (webContentsId) => ipcRenderer.invoke("preview:detach", { webContentsId }),
  ensureGrape: () => ipcRenderer.invoke("grape:ensure"),
  onTerminalData: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("terminal:data", handler);
    return () => ipcRenderer.removeListener("terminal:data", handler);
  },
  onTerminalUrl: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("terminal:url", handler);
    return () => ipcRenderer.removeListener("terminal:url", handler);
  },
  onTerminalExit: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("terminal:exit", handler);
    return () => ipcRenderer.removeListener("terminal:exit", handler);
  },
  onPluginChatDraft: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:plugin-chat-draft", handler);
    return () => ipcRenderer.removeListener("harness:plugin-chat-draft", handler);
  },
  onPluginNotify: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:plugin-notify", handler);
    return () => ipcRenderer.removeListener("harness:plugin-notify", handler);
  },
  onPluginOpenView: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:plugin-open-view", handler);
    return () => ipcRenderer.removeListener("harness:plugin-open-view", handler);
  },
  onQuickCapture: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("harness:quick-capture", handler);
    return () => ipcRenderer.removeListener("harness:quick-capture", handler);
  },
  onTerminalAdopt: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:terminal-adopt", handler);
    return () => ipcRenderer.removeListener("harness:terminal-adopt", handler);
  },
});
