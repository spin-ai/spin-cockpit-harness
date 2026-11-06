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
