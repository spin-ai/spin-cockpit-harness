import type { ElementContext, State } from "./types";
declare global {
  interface Window {
    harness: {
      getState(): Promise<State>;
      action(type: string, payload?: unknown): Promise<{ ok: boolean; result?: unknown }>;
      onState(cb: (s: State) => void): () => void;
      chooseProject(): Promise<string | null>;
      switchProject(id: string): Promise<string>;
      pickProjectFolder(): Promise<string | null>;
      createTerminal(cwd: string, opts?: { command?: string; projectId?: string }): Promise<{ id: string; cwd: string; agent?: unknown }>;
      attachTerminal(id: string): Promise<{ data: string; exited?: boolean; exitCode?: number | null; missing?: boolean }>;
      terminalInput(id: string, data: string): Promise<void>;
      closeTerminal(id: string): Promise<void>;
      terminalResize(id: string, cols: number, rows: number): Promise<void>;
      clipboardRead(): Promise<string>;
      clipboardWrite(text: string): Promise<void>;
      openExternal(url: string): Promise<boolean>;
      onTerminalData(cb: (p: { id: string; data: string }) => void): () => void;
      onTerminalUrl(cb: (p: { id: string; url: string }) => void): () => void;
      onTerminalExit(cb: (p: { id: string; exitCode: number | null; signal: string | null }) => void): () => void;
      filesList(rel?: string, root?: string): Promise<{ root: string; rel: string; entries: { name: string; dir: boolean; path: string }[] }>;
      filesRead(rel: string, root?: string): Promise<{ text?: string; dataUrl?: string; size?: number; ext?: string; error?: string }>;
      previewPick(webContentsId: number, root?: string): Promise<ElementContext>;
      previewCancel(webContentsId: number): Promise<void>;
      previewDetach(webContentsId: number): Promise<void>;
    };
  }
}
export {};
