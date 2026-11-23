import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("harness", {
  getState: () => ipcRenderer.invoke("harness:state"),
  action: (type, payload) => ipcRenderer.invoke("harness:action", { type, payload }),
  onState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on("harness:state", handler);
    return () => ipcRenderer.removeListener("harness:state", handler);
  },
  /** 作用域增量：只带这个 bot 变了的切片（botTurns / botGroupMessages / botChats / items）。
   *  全量 harness:state 仍是首帧与兜底。 */
  onBotPatch: (cb) => {
    const handler = (_event, patch) => cb(patch);
    ipcRenderer.on("harness:bot-patch", handler);
    return () => ipcRenderer.removeListener("harness:bot-patch", handler);
  },
  chooseProject: () => ipcRenderer.invoke("harness:chooseProject"),
  pickProjectFolder: () => ipcRenderer.invoke("harness:pickProjectFolder"),
});
