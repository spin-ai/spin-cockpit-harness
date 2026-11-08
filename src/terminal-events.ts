/** 跨面板打开终端/文件预览的请求队列。
 *  - FilePanel 只负责把请求放进来并广播事件；
 *  - App 收到事件后确保终端面板展开；
 *  - TerminalPanel 挂载时/收到事件时消费队列，避免面板收起时事件丢失。
 */
export type FilePreviewRequest = { rel: string; name?: string; root?: string };

let pendingFile: FilePreviewRequest | null = null;
let pendingCwd: string | null = null;

export function requestFilePreview(detail: FilePreviewRequest) {
  pendingFile = detail;
  window.dispatchEvent(new CustomEvent("harness:open-file-preview", { detail }));
}

export function requestTerminalAt(cwd: string) {
  pendingCwd = cwd;
  window.dispatchEvent(new CustomEvent("harness:open-terminal-at", { detail: { cwd } }));
}

export function takeTerminalRequests(): { file: FilePreviewRequest | null; cwd: string | null } {
  const result = { file: pendingFile, cwd: pendingCwd };
  pendingFile = null;
  pendingCwd = null;
  return result;
}

export type TerminalAdoptRequest = { terminalId: string; cwd: string; title?: string; taskId?: string };
let pendingAdopt: TerminalAdoptRequest | null = null;

/** Chat → 终端：把已经创建好的 pty 接管为终端标签。 */
export function requestTerminalAdopt(detail: TerminalAdoptRequest) {
  pendingAdopt = detail;
  window.dispatchEvent(new CustomEvent("harness:adopt-terminal", { detail }));
}

export function takeTerminalAdopt(): TerminalAdoptRequest | null {
  const result = pendingAdopt;
  pendingAdopt = null;
  return result;
}
