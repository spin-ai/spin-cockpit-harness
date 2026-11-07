import type { ElementContext, State } from "./types";

declare global {
  interface GitFile { path: string; index: string; worktree: string; staged: boolean; untracked: boolean; conflict: boolean; }
  interface GitStatus { isRepo: boolean; root?: string; branch?: string; upstream?: string; oid?: string; detached?: boolean; ahead?: number; behind?: number; files?: GitFile[]; ignored?: string[]; }
  interface Window {
    harness: {
      getState(): Promise<State>;
      action(type: string, payload?: unknown): Promise<{ ok: boolean; result?: unknown }>;
      onState(cb: (s: State) => void): () => void;
      chooseProject(): Promise<string | null>;
      switchProject(id: string): Promise<string>;
      pickProjectFolder(): Promise<string | null>;
      createTerminal(cwd: string, opts?: { command?: string; projectId?: string; todoId?: string; cols?: number; rows?: number }): Promise<{ id: string; cwd: string; agent?: unknown; run?: unknown }>;
      attachTerminal(id: string): Promise<{ data: string; url?: string | null; exited?: boolean; exitCode?: number | null; missing?: boolean }>;
      terminalInput(id: string, data: string): Promise<void>;
      closeTerminal(id: string): Promise<void>;
      terminalResize(id: string, cols: number, rows: number): Promise<void>;
      clipboardRead(): Promise<string>;
      clipboardWrite(text: string): Promise<void>;
      openExternal(url: string): Promise<boolean>;
      onTerminalData(cb: (p: { id: string; data: string }) => void): () => void;
      onTerminalUrl(cb: (p: { id: string; url: string }) => void): () => void;
      onTerminalExit(cb: (p: { id: string; exitCode: number | null; signal: string | null }) => void): () => void;
      onPluginChatDraft(cb: (p: { text: string; context?: unknown }) => void): () => void;
      onPluginNotify(cb: (p: { message: string; level?: string }) => void): () => void;
      onPluginOpenView(cb: (p: { id: string }) => void): () => void;
      filesList(rel?: string, root?: string): Promise<{ root: string; rel: string; entries: { name: string; dir: boolean; path: string }[] }>;
      filesRead(rel: string, root?: string): Promise<{ text?: string; dataUrl?: string; size?: number; ext?: string; error?: string }>;
      filesCreate(rel: string, kind: "file" | "folder", name: string, root?: string): Promise<{ path: string; name: string }>;
      filesRename(rel: string, name: string, root?: string): Promise<{ path: string; name: string }>;
      filesDuplicate(rel: string, root?: string): Promise<{ path: string; name: string }>;
      filesTrash(rel: string, root?: string): Promise<boolean>;
      filesReveal(rel: string, root?: string): Promise<boolean>;
      filesWrite(rel: string, root: string | undefined, text: string): Promise<{ ok: boolean; size: number }>;
      gitStatus(root?: string): Promise<GitStatus>;
      gitDiff(root: string | undefined, path: string, staged?: boolean): Promise<{ diff: string }>;
      gitStage(root: string | undefined, paths: string[]): Promise<{ ok: boolean }>;
      gitUnstage(root: string | undefined, paths: string[]): Promise<{ ok: boolean }>;
      gitDiscard(root: string | undefined, paths: string[]): Promise<{ ok: boolean }>;
      gitCommit(root: string | undefined, message: string, amend?: boolean): Promise<{ ok: boolean; output?: string; error?: string | null }>;
      gitPush(root?: string): Promise<{ ok: boolean; output?: string; error?: string | null }>;
      gitPull(root?: string): Promise<{ ok: boolean; output?: string; error?: string | null }>;
      gitBranches(root?: string): Promise<{ branches: string[]; branch: string; upstream: string; detached: boolean }>;
      gitCheckout(root: string | undefined, branch: string, create?: boolean): Promise<{ ok: boolean; output?: string; error?: string | null }>;
      gitLog(root?: string): Promise<{ commits: { hash: string; subject: string; author: string; when: string }[] }>;
      gitInit(root?: string): Promise<{ ok: boolean; error?: string | null }>;
      previewPick(webContentsId: number, root?: string): Promise<ElementContext>;
      previewCancel(webContentsId: number): Promise<void>;
      previewDetach(webContentsId: number): Promise<void>;
      ensureGrape(): Promise<{ url: string; started: boolean }>;
    };
  }
}
export {};
