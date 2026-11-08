import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { renderMarkdown } from "../markdown";

export type MarkdownEditorHandle = { save: () => Promise<void>; focus: () => void };

/** ProseMirror 的表格（colgroup / 单元格里套 <p>）没法直接走 gfm 规则，这里手工转 pipe 表 */
function tableToMarkdown(node: HTMLElement) {
  const rows = [...node.querySelectorAll("tr")];
  if (!rows.length) return "";
  const cellsOf = (tr: Element) => [...tr.children].map((cell) => {
    const text = (cell as HTMLElement).innerText.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
    return text || " ";
  });
  const headRow = rows[0];
  const hasHeader = headRow.querySelector("th") != null;
  const head = cellsOf(headRow);
  const body = rows.slice(1).map(cellsOf);
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const out = [line(head), `| ${head.map(() => "---").join(" | ")} |`];
  if (hasHeader) out.push(...body.map(line));
  else out.splice(0, 2, ...rows.map((tr) => line(cellsOf(tr))), "");
  return `\n\n${out.filter((l) => l !== "").join("\n")}\n\n`;
}

const turndown = () => {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  td.use(gfm);
  td.remove(["button", "colgroup", "col"]);
  td.addRule("pmTable", {
    filter: (node: HTMLElement) => node.nodeName === "TABLE",
    replacement: (_content: string, node: HTMLElement) => tableToMarkdown(node),
  });
  return td;
};

const SLASH_ITEMS: { id: string; label: string; hint: string; run: (editor: ReturnType<typeof useEditor>) => void }[] = [
  { id: "h1", label: "标题 1", hint: "#", run: (e) => e?.chain().focus().setHeading({ level: 1 }).run() },
  { id: "h2", label: "标题 2", hint: "##", run: (e) => e?.chain().focus().setHeading({ level: 2 }).run() },
  { id: "h3", label: "标题 3", hint: "###", run: (e) => e?.chain().focus().setHeading({ level: 3 }).run() },
  { id: "ul", label: "无序列表", hint: "-", run: (e) => e?.chain().focus().toggleBulletList().run() },
  { id: "ol", label: "有序列表", hint: "1.", run: (e) => e?.chain().focus().toggleOrderedList().run() },
  { id: "quote", label: "引用", hint: ">", run: (e) => e?.chain().focus().toggleBlockquote().run() },
  { id: "code", label: "代码块", hint: "```", run: (e) => e?.chain().focus().toggleCodeBlock().run() },
  { id: "table", label: "表格", hint: "|", run: (e) => e?.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run() },
  { id: "hr", label: "分割线", hint: "---", run: (e) => e?.chain().focus().setHorizontalRule().run() },
];

/**
 * Markdown 富文本编辑器（TipTap / ProseMirror 内核，对齐 ORCA）
 * - 初始内容：marked 把 Markdown 渲染成 HTML 交给编辑器
 * - 保存：getHTML() → turndown + gfm → Markdown（表格转 pipe 表、列表归一为 `- item`）
 * - Markdown 输入规则由 StarterKit 提供（`# `、`- `、`1. `、`> `、``` 等）
 * - 空段落输入 `/` 打开块插入菜单
 */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, {
  markdown: string;
  onChange?: (markdown: string, html: string) => void;
  onSave?: (markdown: string) => void | Promise<void>;
  placeholder?: string;
}>(function MarkdownEditor({ markdown, onChange, onSave, placeholder = "开始写…（# 标题 · - 列表 · ``` 代码块 · / 插入块）" }, ref) {
  const initial = useMemo(() => renderMarkdown(markdown), []); // 只取首次内容，后续由编辑器自己维护
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const [slash, setSlash] = useState<{ x: number; y: number } | null>(null);
  const [stats, setStats] = useState({ chars: 0 });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder }),
    ],
    content: initial,
    editorProps: { attributes: { class: "md-prose", spellcheck: "true" } },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      setStats({ chars: ed.state.doc.textContent.replace(/\s/g, "").length });
      try { changeRef.current?.(turndown().turndown(html), html); } catch { /* ignore */ }
    },
  });

  const save = async () => {
    if (!editor) return;
    const html = editor.getHTML();
    const md = turndown().turndown(html)
      .replace(/^(\s*)[-*+]\s{2,}/gm, "$1- ")
      .replace(/^(\s*)(\d+)\.\s{2,}/gm, "$1$2. ")
      .replace(/\n{3,}/g, "\n\n");
    await saveRef.current?.(md);
  };

  useImperativeHandle(ref, () => ({ save, focus: () => editor?.commands.focus() }), [editor]);

  // 首次挂载时把字数算出来
  useEffect(() => {
    if (editor) setStats({ chars: editor.state.doc.textContent.replace(/\s/g, "").length });
  }, [editor]);

  // 文档被外部替换（切文件 / 保存后重载）时同步
  const keyRef = useRef(markdown);
  useEffect(() => {
    if (!editor) return;
    if (keyRef.current === markdown) return;
    keyRef.current = markdown;
    const html = renderMarkdown(markdown);
    if (editor.getHTML() !== html) editor.commands.setContent(html, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, editor]);

  if (!editor) return <div className="pane-empty">加载编辑器…</div>;

  const active = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); return; }
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setLink(); return; }
    if (e.key === "Escape" && slash) { e.preventDefault(); setSlash(null); return; }
    if (e.key === "/") {
      const { $from } = editor.state.selection;
      const empty = $from.parent.textContent.trim() === "";
      if (empty) {
        const coords = editor.view.coordsAtPos($from.pos);
        window.setTimeout(() => setSlash({ x: coords.left, y: coords.bottom + 6 }), 0);
      }
    }
  };

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("链接地址（https://… 或相对路径）", prev || "https://");
    if (url == null) return;
    if (!url.trim()) { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const T = ({ label, title, on, run, cls }: { label: string; title: string; on?: boolean; run: () => void; cls?: string }) => (
    <button type="button" className={`md-tool ${on ? "on" : ""} ${cls || ""}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>{label}</button>
  );

  return (
    <div className="md-editor">
      <div className="md-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <T label="H1" title="标题 1" on={active("heading", { level: 1 })} run={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <T label="H2" title="标题 2" on={active("heading", { level: 2 })} run={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <T label="H3" title="标题 3" on={active("heading", { level: 3 })} run={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <i className="md-tool-sep" />
        <T label="B" title="加粗（⌘B）" cls="bold" on={active("bold")} run={() => editor.chain().focus().toggleBold().run()} />
        <T label="I" title="斜体（⌘I）" cls="italic" on={active("italic")} run={() => editor.chain().focus().toggleItalic().run()} />
        <T label="S" title="删除线（⌘⇧X）" on={active("strike")} run={() => editor.chain().focus().toggleStrike().run()} />
        <T label="</>" title="行内代码（⌘E）" on={active("code")} run={() => editor.chain().focus().toggleCode().run()} />
        <i className="md-tool-sep" />
        <T label="•" title="无序列表" on={active("bulletList")} run={() => editor.chain().focus().toggleBulletList().run()} />
        <T label="1." title="有序列表" on={active("orderedList")} run={() => editor.chain().focus().toggleOrderedList().run()} />
        <T label="❝" title="引用" on={active("blockquote")} run={() => editor.chain().focus().toggleBlockquote().run()} />
        <T label="```" title="代码块" on={active("codeBlock")} run={() => editor.chain().focus().toggleCodeBlock().run()} />
        <T label="⊞" title="表格" on={active("table")} run={() => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()} />
        <T label="—" title="分割线" run={() => editor.chain().focus().setHorizontalRule().run()} />
        <i className="md-tool-sep" />
        <T label="🔗" title="链接（⌘K）" on={active("link")} run={setLink} />
        <T label="↶" title="撤销（⌘Z）" run={() => editor.chain().focus().undo().run()} />
        <T label="↷" title="重做（⌘⇧Z）" run={() => editor.chain().focus().redo().run()} />
        <span className="spacer" />
        <span className="md-toolbar-hint">{stats.chars} 字 · 输入 / 插入块 · ⌘⇧M 切源码</span>
      </div>

      <div className="md-editor-surface" onKeyDown={onKeyDown}>
        <EditorContent editor={editor} />
      </div>

      {slash && (
        <div className="md-slash" style={{ left: slash.x, top: slash.y }} onMouseDown={(e) => e.preventDefault()}>
          <div className="md-slash-head">插入块</div>
          {SLASH_ITEMS.map((item) => (
            <button
              key={item.id}
              className="md-slash-item"
              onClick={() => {
                // 清掉触发用的 "/"
                const { $from } = editor.state.selection;
                editor.chain().focus().deleteRange({ from: $from.pos - 1, to: $from.pos }).run();
                item.run(editor);
                setSlash(null);
              }}
            >
              <span>{item.label}</span><em>{item.hint}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
