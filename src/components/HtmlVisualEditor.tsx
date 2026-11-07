import { useEffect, useRef, useState } from "react";
import grapesjs, { type Editor } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";

export type VisualEditorApi = {
  /** 组合出完整 HTML（保留原 head，GrapesJS 的 CSS 放进 <style data-grapes>） */
  save: () => string;
  /** 丢弃未保存修改（内部重新加载原 HTML） */
  reset: () => void;
};

/**
 * HTML 可视化编辑器（GrapesJS）。
 * - 只接管 <body> 的内容与样式；<head> 里的 meta/title/script 原样保留
 * - 保存时把 GrapesJS 产出的 CSS 写进 `<style data-grapes>`，重复保存不会叠加
 * - 由父组件拿到 api，点「保存修改」/⌘S 时调用 api.save()
 */
export function HtmlVisualEditor({ html, fileKey, onApi, onDirty }: {
  html: string;
  /** 换文件时重新初始化编辑器 */
  fileKey: string;
  onApi?: (api: VisualEditorApi | null) => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const headRef = useRef("");
  const attrsRef = useRef("");
  const [error, setError] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setError("");
    const doc = new DOMParser().parseFromString(html || "<html><body></body></html>", "text/html");
    headRef.current = doc.head.innerHTML.replace(/<style[^>]*data-grapes[\s\S]*?<\/style>/gi, "").trim();
    attrsRef.current = doc.documentElement
      .getAttributeNames()
      .map((name) => ` ${name}="${doc.documentElement.getAttribute(name) ?? ""}"`)
      .join("");
    const css = [...doc.querySelectorAll("style")]
      .filter((el) => !el.hasAttribute("data-grapes"))
      .map((el) => el.textContent || "")
      .join("\n");

    let editor: Editor | null = null;
    try {
      editor = grapesjs.init({
        container: host,
        height: "100%",
        width: "auto",
        storageManager: false,
        fromElement: false,
        // 有些文件本身就带嵌套 <body>（历史保存导致），先剥干净
        components: doc.body.innerHTML.replace(/<\/?body[^>]*>/gi, ""),
        style: css,
        // 本地文件：不做资源上传，图片保持原 URL
        assetManager: { upload: false, embedAsBase64: false },
        canvas: { styles: [], scripts: [] },
        selectorManager: { componentFirst: true },
      });
      editorRef.current = editor;
      // 仅在 dev 下暴露给 E2E 脚本（打包产物里 import.meta.env.DEV === false）
      if (import.meta.env.DEV) (window as unknown as { __grapes?: Editor }).__grapes = editor;
      editor.on("update", () => onDirty?.(true));
      onApi?.({
        save: () => {
          const body = (editor?.getHtml() || "").replace(/^\s*<body[^>]*>/i, "").replace(/<\/body>\s*$/i, "");
          const style = editor?.getCss() || "";
          const head = headRef.current;
          return [
            "<!DOCTYPE html>",
            `<html${attrsRef.current}>`,
            "<head>",
            head,
            style.trim() ? `<style data-grapes>\n${style.trim()}\n</style>` : "",
            "</head>",
            "<body>",
            body,
            "</body>",
            "</html>",
            "",
          ].filter(Boolean).join("\n");
        },
        reset: () => {
          editor?.setComponents(doc.body.innerHTML.replace(/<\/?body[^>]*>/gi, ""));
          editor?.setStyle(css);
          onDirty?.(false);
        },
      });
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
    return () => {
      onApi?.(null);
      try { editor?.destroy(); } catch { /* ignore */ }
      editorRef.current = null;
    };
    // fileKey 表示「换文件」；同一文件内容变化（保存后）不重建编辑器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  return (
    <div className="html-visual-editor">
      <div className="html-visual-host" ref={hostRef} />
      {error && <div className="preview-error">{error}</div>}
    </div>
  );
}
