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
  clipboardWrite: (text) => ipcRenderer.invoke("clipboard:write", { text }),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", { url }),
  filesList: (rel, root) => ipcRenderer.invoke("files:list", { rel, root }),
  filesRead: (rel, root) => ipcRenderer.invoke("files:read", { rel, root }),
  previewPick: (webContentsId, root) => ipcRenderer.invoke("preview:pick", { webContentsId, root }),
  previewCancel: (webContentsId) => ipcRenderer.invoke("preview:cancel", { webContentsId }),
  previewDetach: (webContentsId) => ipcRenderer.invoke("preview:detach", { webContentsId }),
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
});
