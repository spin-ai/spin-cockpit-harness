const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("harness", {
  getState: () => ipcRenderer.invoke("harness:state"),
  action: (type, payload) => ipcRenderer.invoke("harness:action", { type, payload }),
  onState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on("harness:state", handler);
    return () => ipcRenderer.removeListener("harness:state", handler);
  },
  /** 作用域增量：只带这个 bot 变了的切片（botTurns / botGroupMessages / botChats / itemCounts）。
   *  全量 harness:state 仍是首帧与兜底。 */
  onBotPatch: (cb) => {
    const handler = (_event, patch) => cb(patch);
    ipcRenderer.on("harness:bot-patch", handler);
    return () => ipcRenderer.removeListener("harness:bot-patch", handler);
  },
  chooseProject: () => ipcRenderer.invoke("harness:chooseProject"),
  pickProjectFolder: () => ipcRenderer.invoke("harness:pickProjectFolder"),
  createTerminal: (cwd, opts = {}) => ipcRenderer.invoke("terminal:create", { cwd, ...opts }),
  attachTerminal: (id) => ipcRenderer.invoke("terminal:attach", { id }),
  detachTerminal: (id) => ipcRenderer.invoke("terminal:detach", { id }),
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
  clipboardReadImage: () => ipcRenderer.invoke("clipboard:readImage"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", { url }),
  filesList: (rel, root) => ipcRenderer.invoke("files:list", { rel, root }),
  filesRead: (rel, root) => ipcRenderer.invoke("files:read", { rel, root }),
  filesCreate: (rel, kind, name, root) => ipcRenderer.invoke("files:create", { rel, kind, name, root }),
  filesRename: (rel, name, root) => ipcRenderer.invoke("files:rename", { rel, name, root }),
  filesDuplicate: (rel, root) => ipcRenderer.invoke("files:duplicate", { rel, root }),
  filesTrash: (rel, root) => ipcRenderer.invoke("files:trash", { rel, root }),
  filesReveal: (rel, root) => ipcRenderer.invoke("files:reveal", { rel, root }),
  filesPageImage: (rel, root, page, scale) => ipcRenderer.invoke("files:pageImage", { rel, root, page, scale }),
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
  previewPick: (webContentsId, root, rootHint) => ipcRenderer.invoke("preview:pick", { webContentsId, root, rootHint }),
  previewCancel: (webContentsId) => ipcRenderer.invoke("preview:cancel", { webContentsId }),
  previewDetach: (webContentsId) => ipcRenderer.invoke("preview:detach", { webContentsId }),
  /** 告诉主进程「现在用户看的是哪一个预览页」，Agent 的浏览器工具就作用在它上面 */
  previewActive: (webContentsId) => ipcRenderer.invoke("preview:active", { webContentsId }),
  // 截图导出（落盘 + 复制到剪贴板）
  previewCapture: (webContentsId, fullPage) => ipcRenderer.invoke("preview:capture", { webContentsId, fullPage }),
  // 录屏（主进程抓帧 → 渲染层 MediaRecorder 编 webm）
  previewRecordStart: (webContentsId, fps) => ipcRenderer.invoke("preview:record:start", { webContentsId, fps }),
  previewRecordStop: (id) => ipcRenderer.invoke("preview:record:stop", { id }),
  previewRecordSave: (data, mime) => ipcRenderer.invoke("preview:record:save", { data, mime }),
  onPreviewRecordFrame: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("preview:record:frame", handler);
    return () => ipcRenderer.removeListener("preview:record:frame", handler);
  },
  onPreviewRecordEnded: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("preview:record:ended", handler);
    return () => ipcRenderer.removeListener("preview:record:ended", handler);
  },
  onPreviewConsole: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("preview:console", handler);
    return () => ipcRenderer.removeListener("preview:console", handler);
  },
  filesPreviewDoc: (rel, root) => ipcRenderer.invoke("files:previewDoc", { rel, root }),
  // 预览页站点权限（摄像头 / 麦克风 / 剪贴板…）：按站点白名单
  previewPermissions: () => ipcRenderer.invoke("preview:permissions:list"),
  previewGrantPermission: (origin, permission) => ipcRenderer.invoke("preview:permissions:grant", { origin, permission }),
  previewRevokePermission: (origin, permission) => ipcRenderer.invoke("preview:permissions:revoke", { origin, permission }),
  onPreviewPermission: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("preview:permission", handler);
    return () => ipcRenderer.removeListener("preview:permission", handler);
  },
  // 远端预览：ssh -L 隧道（只绑本机回环）
  previewTunnel: (hostId, url) => ipcRenderer.invoke("preview:tunnel:open", { hostId, url }),
  previewTunnelClose: (key) => ipcRenderer.invoke("preview:tunnel:close", { key }),
  onPreviewTunnelClosed: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("preview:tunnel:closed", handler);
    return () => ipcRenderer.removeListener("preview:tunnel:closed", handler);
  },
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
  onImPaired: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:im-paired", handler);
    return () => ipcRenderer.removeListener("harness:im-paired", handler);
  },
  onBotDelta: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:bot-delta", handler);
    return () => ipcRenderer.removeListener("harness:bot-delta", handler);
  },
  onBotThought: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:bot-thought", handler);
    return () => ipcRenderer.removeListener("harness:bot-thought", handler);
  },
  onBotTool: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:bot-tool", handler);
    return () => ipcRenderer.removeListener("harness:bot-tool", handler);
  },
  onBotPhase: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:bot-phase", handler);
    return () => ipcRenderer.removeListener("harness:bot-phase", handler);
  },
  onBotGroupMessage: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:bot-group-message", handler);
    return () => ipcRenderer.removeListener("harness:bot-group-message", handler);
  },
  onBotMessage: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:bot-message", handler);
    return () => ipcRenderer.removeListener("harness:bot-message", handler);
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
  onPluginEvent: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("harness:plugin-event", handler);
    return () => ipcRenderer.removeListener("harness:plugin-event", handler);
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
