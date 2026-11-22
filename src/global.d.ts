import type { BotGroupMessage, ElementContext, State } from "./types";

declare global {
  interface GitFile { path: string; index: string; worktree: string; staged: boolean; untracked: boolean; conflict: boolean; }
  interface GitStatus { isRepo: boolean; root?: string; branch?: string; upstream?: string; oid?: string; detached?: boolean; ahead?: number; behind?: number; wadeGate?: boolean; files?: GitFile[]; ignored?: string[]; }
  interface Window {
    harness: {
      getState(): Promise<State>;
      action(type: string, payload?: unknown): Promise<{ ok: boolean; result?: unknown }>;
      onState(cb: (s: State) => void): () => void;
      chooseProject(): Promise<string | null>;
      switchProject(id: string): Promise<string>;
      pickProjectFolder(): Promise<string | null>;
      createTerminal(cwd: string, opts?: { command?: string; projectId?: string; todoId?: string; agentId?: string; branch?: string | null; initialInput?: string; cols?: number; rows?: number }): Promise<{ id: string; cwd: string; agent?: unknown; run?: unknown }>;
      attachTerminal(id: string): Promise<{ data: string; url?: string | null; exited?: boolean; exitCode?: number | null; missing?: boolean }>;
      terminalInput(id: string, data: string): Promise<void>;
      closeTerminal(id: string): Promise<void>;
      terminalResize(id: string, cols: number, rows: number): Promise<void>;
      clipboardRead(): Promise<string>;
      clipboardWrite(text: string): Promise<void>;
      /** 读剪贴板里的图片（截图 workflow：截图 → ⌘V 或这个按钮） */
      clipboardReadImage(): Promise<{ ok: boolean; dataUrl?: string; size?: { width: number; height: number }; error?: string }>;
      quickCaptureSave(text: string): Promise<{ ok: boolean; error?: string; page?: string | null }>;
      quickCaptureClose(): Promise<void>;
      onQuickCaptureSubmit(cb: () => void): () => void;
      exportPdf(html: string, title: string): Promise<string | null>;
      openExternal(url: string): Promise<boolean>;
      onTerminalData(cb: (p: { id: string; data: string }) => void): () => void;
      onTerminalUrl(cb: (p: { id: string; url: string }) => void): () => void;
      onTerminalExit(cb: (p: { id: string; exitCode: number | null; signal: string | null }) => void): () => void;
      onImPaired(cb: (p: { appId: string; allowIds?: string }) => void): () => void;
      onBotDelta(cb: (p: { botId: string; delta: string; groupId?: string; name?: string }) => void): () => void;
      onBotTool(cb: (p: { botId: string; name: string; phase: "start" | "done"; groupId?: string; botName?: string }) => void): () => void;
      onBotPhase(cb: (p: { botId: string; phase: "thinking" | "tool" | "done"; groupId?: string; name?: string; tool?: string }) => void): () => void;
      onBotGroupMessage(cb: (p: { groupId: string; message: BotGroupMessage }) => void): () => void;
      onBotMessage(cb: (p: { botId: string; text: string; turnId: string }) => void): () => void;
      onPluginChatDraft(cb: (p: { text: string; context?: unknown }) => void): () => void;
      onPluginNotify(cb: (p: { message: string; level?: string }) => void): () => void;
      onPluginOpenView(cb: (p: { id: string }) => void): () => void;
      onQuickCapture(cb: () => void): () => void;
      onTerminalAdopt(cb: (p: { terminalId: string; cwd: string; title?: string; taskId?: string; branch?: string | null }) => void): () => void;
      filesList(rel?: string, root?: string): Promise<{ root: string; rel: string; entries: { name: string; dir: boolean; path: string }[] }>;
      filesRead(rel: string, root?: string): Promise<{ text?: string; size?: number; ext?: string; error?: string; native?: boolean; binary?: boolean; encoding?: string }>;
      /** 文档预览：docx / xlsx / pptx… 转成 HTML（已转义）或纯文本 */
      filesPreviewDoc(rel: string, root?: string): Promise<{ html?: string; kind?: string; truncated?: boolean; error?: string }>;
      /** 预览页站点权限：按站点授权（origin + Electron permission 名） */
      previewPermissions(): Promise<{ origin: string; permissions: { key: string; label: string }[] }[]>;
      previewGrantPermission(origin: string, permission: string): Promise<{ ok: boolean; sites: { origin: string; permissions: { key: string; label: string }[] }[] }>;
      previewRevokePermission(origin: string, permission?: string): Promise<{ ok: boolean; sites: { origin: string; permissions: { key: string; label: string }[] }[] }>;
      onPreviewPermission(cb: (p: { webContentsId: number; origin: string; permission: string; label: string; grantable: boolean }) => void): () => void;
      filesCreate(rel: string, kind: "file" | "folder", name: string, root?: string): Promise<{ path: string; name: string }>;
      filesRename(rel: string, name: string, root?: string): Promise<{ path: string; name: string }>;
      filesDuplicate(rel: string, root?: string): Promise<{ path: string; name: string }>;
      filesTrash(rel: string, root?: string): Promise<boolean>;
      filesReveal(rel: string, root?: string): Promise<boolean>;
      /** PDF 逐页渲图（主进程 pdfjs + skia）：预览里的阅读器按页取图 */
      filesPageImage(rel: string, root?: string, page?: number, scale?: number): Promise<{ dataUrl: string; width: number; height: number; pages: number; page: number; scale: number }>;
      filesWrite(rel: string, root: string | undefined, text: string): Promise<{ ok: boolean; size: number }>;
      docsPick(): Promise<{ path: string; name: string; text?: string; size?: number; error?: string }[]>;
      docsRead(paths: string[]): Promise<{ path: string; name: string; text?: string; size?: number; error?: string }[]>;
      gitStatus(root?: string): Promise<GitStatus>;
      gitDiff(root: string | undefined, path: string, staged?: boolean): Promise<{ diff: string }>;
      gitStage(root: string | undefined, paths: string[]): Promise<{ ok: boolean }>;
      gitUnstage(root: string | undefined, paths: string[]): Promise<{ ok: boolean }>;
      gitDiscard(root: string | undefined, paths: string[]): Promise<{ ok: boolean }>;
      gitCommit(root: string | undefined, message: string, amend?: boolean): Promise<{ ok: boolean; output?: string; error?: string | null }>;
      gitPush(root?: string): Promise<{ ok: boolean; output?: string; error?: string | null; wadeGate?: boolean; hint?: string | null }>;
      gitPull(root?: string): Promise<{ ok: boolean; output?: string; error?: string | null }>;
      gitBranches(root?: string): Promise<{ branches: string[]; branch: string; upstream: string; detached: boolean }>;
      gitCheckout(root: string | undefined, branch: string, create?: boolean): Promise<{ ok: boolean; output?: string; error?: string | null }>;
      gitLog(root?: string): Promise<{ commits: { hash: string; subject: string; author: string; when: string }[] }>;
      gitInit(root?: string): Promise<{ ok: boolean; error?: string | null }>;
      previewPick(webContentsId: number, root?: string, rootHint?: string): Promise<ElementContext>;
      previewCancel(webContentsId: number): Promise<void>;
      previewDetach(webContentsId: number): Promise<void>;
      previewActive(webContentsId: number): Promise<{ ok: boolean }>;
      previewCapture(webContentsId: number, fullPage?: boolean): Promise<{ ok: boolean; path?: string; copied?: boolean; error?: string }>;
      previewRecordStart(webContentsId: number, fps?: number): Promise<{ ok: boolean; id?: string; intervalMs?: number; error?: string }>;
      previewRecordStop(id: string): Promise<{ ok: boolean }>;
      previewRecordSave(data: Uint8Array, mime?: string): Promise<{ ok: boolean; path?: string; size?: number; error?: string }>;
      onPreviewRecordFrame(cb: (p: { id: string; width: number; height: number; jpeg: string }) => void): () => void;
      onPreviewRecordEnded(cb: (p: { id: string; reason: string }) => void): () => void;
      onPreviewConsole(cb: (p: { webContentsId: number; level: number; message: string; line: number; source: string }) => void): () => void;
      /** 远端预览隧道：返回 localUrl（隧道）或 direct（公网地址不走隧道） */
      previewTunnel(hostId: string, url: string): Promise<{ ok: boolean; url?: string; remote?: string; key?: string; hostName?: string; direct?: boolean; reused?: boolean; error?: string }>;
      previewTunnelClose(key: string): Promise<{ ok: boolean }>;
      onPreviewTunnelClosed(cb: (p: { key: string; hostName: string; error: string }) => void): () => void;
      ensureGrape(): Promise<{ url: string; started: boolean }>;
    };
  }
}
export {};
