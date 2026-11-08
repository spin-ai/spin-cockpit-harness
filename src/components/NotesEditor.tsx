import { useEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { deleteMarkupBackward, insertNewlineContinueMarkup, markdown } from "@codemirror/lang-markdown";
import { autocompletion, startCompletion, type CompletionContext } from "@codemirror/autocomplete";
import { indentLess, indentMore, redo, undo } from "@codemirror/commands";
import { openSearchPanel, search } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { CheckSquareIcon, CodeIcon, LinkIcon, QuoteIcon, RedoIcon, RuleIcon, SearchIcon, TableIcon, UndoIcon } from "./Icons";

export type NotePickerItem = { path: string; title: string };

const notesTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--fg)", backgroundColor: "transparent" },
  ".cm-scroller": { fontFamily: "var(--font-sans)", fontSize: "13.5px", lineHeight: "1.72" },
  ".cm-content": { caretColor: "var(--brand)", padding: "20px 0 120px" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--brand)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--fg) 14%, transparent)",
  },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent", boxShadow: "inset 2px 0 0 color-mix(in srgb, var(--brand) 32%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-2)" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--fg)", borderColor: "var(--border)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels input, .cm-panels button": {
    color: "var(--fg)", backgroundColor: "var(--page-canvas)",
    border: "1px solid var(--border)", borderRadius: "5px",
  },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--amber) 24%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--amber) 40%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--fg) 8%, transparent)" },
  ".cm-tooltip": { backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--fg)" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 6px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--brand-soft)", color: "var(--fg)" },
  ".cm-completionLabel": { fontSize: "12px" },
  ".cm-completionDetail": { color: "var(--faint)", fontStyle: "normal", marginLeft: "8px" },
});

const notesHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading1, color: "var(--fg)", fontWeight: "700" },
  { tag: [tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], color: "var(--fg)", fontWeight: "600" },
  { tag: tags.strong, color: "var(--fg)", fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--brand)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--brand)" },
  { tag: tags.monospace, color: "var(--amber)", backgroundColor: "var(--page-canvas)" },
  { tag: tags.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--brand)" },
  { tag: tags.contentSeparator, color: "var(--faint)" },
  { tag: [tags.meta, tags.comment], color: "var(--faint)" },
]));

/** 当前选区；没有选区时插入占位文本并选中它。 */
function wrapSelection(view: EditorView, before: string, after: string, placeholder: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to) || placeholder;
  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
    scrollIntoView: true,
  });
  view.focus();
}

function selectedLines(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const start = view.state.doc.lineAt(from).from;
  const end = view.state.doc.lineAt(to).to;
  return { start, end, lines: view.state.sliceDoc(start, end).split("\n") };
}

/** 行前缀开关：列表 / 引用 / 任务。 */
function toggleLinePrefix(view: EditorView, prefix: string) {
  const { start, end, lines } = selectedLines(view);
  const all = lines.every((line) => !line.trim() || line.startsWith(prefix));
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    return all ? line.slice(prefix.length) : `${prefix}${line}`;
  }).join("\n");
  view.dispatch({ changes: { from: start, to: end, insert: next }, scrollIntoView: true });
  view.focus();
}

/** 标题级别开关。 */
function setHeading(view: EditorView, level: number) {
  const prefix = `${"#".repeat(level)} `;
  const { start, end, lines } = selectedLines(view);
  const all = lines.every((line) => !line.trim() || line.startsWith(prefix));
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    return all ? line.slice(prefix.length) : `${prefix}${line.replace(/^#{1,6}\s+/, "")}`;
  }).join("\n");
  view.dispatch({ changes: { from: start, to: end, insert: next }, scrollIntoView: true });
  view.focus();
}

function insertCodeBlock(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (selected) {
    view.dispatch({
      changes: { from, to, insert: `\`\`\`\n${selected}\n\`\`\`\n` },
      selection: { anchor: from + 4, head: from + 4 + selected.length },
      scrollIntoView: true,
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: "```\n\n```\n" },
      selection: { anchor: from + 4 },
      scrollIntoView: true,
    });
  }
  view.focus();
}

function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to) || "链接文字";
  const url = "https://";
  view.dispatch({
    changes: { from, to, insert: `[${selected}](${url})` },
    selection: { anchor: from + selected.length + 3, head: from + selected.length + 3 + url.length },
    scrollIntoView: true,
  });
  view.focus();
}

function insertWikiLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const cursor = from + 2 + selected.length;
  view.dispatch({
    changes: { from, to, insert: `[[${selected}]]` },
    selection: { anchor: cursor, head: cursor },
    scrollIntoView: true,
  });
  view.focus();
  window.setTimeout(() => startCompletion(view), 0);
}

function insertTable(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const table = "\n| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n";
  view.dispatch({ changes: { from, to, insert: table }, selection: { anchor: from + table.length }, scrollIntoView: true });
  view.focus();
}

function insertRule(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const text = "\n\n---\n\n";
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
  view.focus();
}

type Tool = { key: string; title: string; icon: React.ReactNode; action: (view: EditorView) => void };
const TOOLS: (Tool[] | "sep")[] = [
  [
    { key: "undo", title: "撤销 ⌘Z", icon: <UndoIcon size={14} />, action: (v) => { undo(v); v.focus(); } },
    { key: "redo", title: "重做 ⇧⌘Z", icon: <RedoIcon size={14} />, action: (v) => { redo(v); v.focus(); } },
  ],
  [
    { key: "h1", title: "一级标题", icon: <b className="notes-tool-h">H1</b>, action: (v) => setHeading(v, 1) },
    { key: "h2", title: "二级标题", icon: <b className="notes-tool-h">H2</b>, action: (v) => setHeading(v, 2) },
    { key: "h3", title: "三级标题", icon: <b className="notes-tool-h">H3</b>, action: (v) => setHeading(v, 3) },
  ],
  [
    { key: "bold", title: "粗体 ⌘B", icon: <b className="notes-tool-b">B</b>, action: (v) => wrapSelection(v, "**", "**", "粗体") },
    { key: "italic", title: "斜体 ⌘I", icon: <i className="notes-tool-i">I</i>, action: (v) => wrapSelection(v, "*", "*", "斜体") },
    { key: "strike", title: "删除线", icon: <s className="notes-tool-s">S</s>, action: (v) => wrapSelection(v, "~~", "~~", "删除线") },
    { key: "code", title: "行内代码", icon: <CodeIcon size={14} />, action: (v) => wrapSelection(v, "`", "`", "code") },
  ],
  [
    { key: "ul", title: "无序列表", icon: <span className="notes-tool-glyph">•</span>, action: (v) => toggleLinePrefix(v, "- ") },
    { key: "ol", title: "有序列表", icon: <span className="notes-tool-glyph">1.</span>, action: (v) => toggleLinePrefix(v, "1. ") },
    { key: "task", title: "任务列表", icon: <CheckSquareIcon size={14} />, action: (v) => toggleLinePrefix(v, "- [ ] ") },
    { key: "quote", title: "引用", icon: <QuoteIcon size={14} />, action: (v) => toggleLinePrefix(v, "> ") },
  ],
  [
    { key: "codeblock", title: "代码块", icon: <span className="notes-tool-glyph">{"{}"}</span>, action: insertCodeBlock },
    { key: "wikilink", title: "Wiki 链接；输入 [[ 也可补全", icon: <span className="notes-tool-glyph">[[</span>, action: insertWikiLink },
    { key: "link", title: "链接 ⌘K", icon: <LinkIcon size={14} />, action: insertLink },
    { key: "table", title: "表格", icon: <TableIcon size={14} />, action: insertTable },
    { key: "rule", title: "分隔线", icon: <RuleIcon size={14} />, action: insertRule },
  ],
  [
    { key: "search", title: "查找 / 替换 ⌘F", icon: <SearchIcon size={14} />, action: (v) => { openSearchPanel(v); } },
  ],
];

function countText(text: string) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9_'-]+/g) || []).length;
  return { chars: text.length, words: cjk + latin };
}

/**
 * CodeMirror 编辑面：Markdown 高亮 + 格式工具栏 + [[page]] / #tag 补全。
 * 预览仍然是独立渲染，避免把编辑器状态塞进 React。
 */
export function NotesEditor({ value, pages, tags: tagList, dirty = false, onChange, onSave }: {
  value: string;
  pages: NotePickerItem[];
  tags: string[];
  dirty?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const pagesRef = useRef(pages);
  const tagsRef = useRef(tagList);
  const [stats, setStats] = useState(() => countText(value));
  const [selectionLength, setSelectionLength] = useState(0);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  pagesRef.current = pages;
  tagsRef.current = tagList;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const completion = (context: CompletionContext) => {
      const word = context.matchBefore(/\[\[[^\]\n]*|#[^\s\n]*/);
      if (!word) return null;
      if (word.from === word.to && !context.explicit) return null;
      if (word.text.startsWith("[[")) {
        const query = word.text.slice(2).toLowerCase();
        const options = pagesRef.current
          .filter((p) => !query || `${p.title} ${p.path}`.toLowerCase().includes(query))
          .slice(0, 24)
          .map((p) => ({ label: p.title, detail: p.path, apply: `${p.title}]]` }));
        return { from: word.from + 2, options };
      }
      const query = word.text.slice(1).toLowerCase();
      return {
        from: word.from + 1,
        options: tagsRef.current.filter((tag) => !query || tag.toLowerCase().includes(query)).slice(0, 24).map((tag) => ({ label: tag, apply: tag })),
      };
    };

    const extensions: Extension[] = [
      basicSetup,
      markdown(),
      search({ top: true }),
      notesTheme,
      notesHighlight,
      EditorView.lineWrapping,
      autocompletion({ override: [completion], activateOnTyping: true, maxRenderedOptions: 24 }),
      Prec.high(keymap.of([
        { key: "Mod-b", run: (view) => { wrapSelection(view, "**", "**", "粗体"); return true; } },
        { key: "Mod-i", run: (view) => { wrapSelection(view, "*", "*", "斜体"); return true; } },
        { key: "Mod-Shift-x", run: (view) => { wrapSelection(view, "~~", "~~", "删除线"); return true; } },
        { key: "Mod-k", run: (view) => { insertLink(view); return true; } },
        { key: "Mod-Shift-k", run: (view) => { insertWikiLink(view); return true; } },
        { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current(); return true; } },
        { key: "Enter", run: insertNewlineContinueMarkup },
        { key: "Backspace", run: deleteMarkupBackward },
        { key: "Tab", run: indentMore },
        { key: "Shift-Tab", run: indentLess },
      ])),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) {
          setStats(countText(update.state.doc.toString()));
          const { from, to } = update.state.selection.main;
          setSelectionLength(Math.max(0, to - from));
        }
      }),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host,
    });
    viewRef.current = view;
    view.focus();
    return () => { view.destroy(); viewRef.current = null; };
    // The editor is keyed by document path; external value changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  const run = (action: (view: EditorView) => void) => {
    const view = viewRef.current;
    if (view) action(view);
  };

  return (
    <div className="notes-editor-shell">
      <div className="notes-editor-toolbar">
        {TOOLS.map((group, index) => group === "sep" ? null : (
          <div className="notes-tool-group" key={`g${index}`}>
            {index > 0 && <i className="notes-tool-sep" />}
            {group.map((tool) => (
              <button
                key={tool.key}
                type="button"
                className="notes-tool"
                title={tool.title}
                aria-label={tool.title}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(tool.action)}
              >{tool.icon}</button>
            ))}
          </div>
        ))}
      </div>
      <div className="notes-codemirror" ref={hostRef} />
      <div className="notes-editor-status">
        <span>{stats.words} 词 · {stats.chars} 字</span>
        {selectionLength > 0 && <span>选中 {selectionLength}</span>}
        <span className={`notes-save-state ${dirty ? "dirty" : ""}`}>{dirty ? "未保存" : "已保存"}</span>
        <span className="notes-editor-hint">⌘S 保存 · ⌘F 查找</span>
        <button type="button" className={`notes-save-btn ${dirty ? "dirty" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onSaveRef.current()} title="保存（⌘S）">保存</button>
      </div>
    </div>
  );
}
