import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, drawSelection, lineNumbers, highlightSpecialChars } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, StreamLanguage, foldGutter, foldKeymap } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";

/**
 * 代码编辑器（CodeMirror 6）。预览面板里所有文本 / 代码文件都用它：
 * - 行号、折叠、括号匹配、自动缩进、行内查找、多光标 —— 不再是只会滚动的 <pre>
 * - 语法高亮覆盖 js/ts/jsx/tsx/json、html/vue/svelte、css/scss/less、md、以及 legacy-modes 里的一大批语言
 * - 配色全部走 CSS 变量，亮暗主题自动跟随，不额外维护一套主题
 */

import { shell } from "@codemirror/legacy-modes/mode/shell";
import { python } from "@codemirror/legacy-modes/mode/python";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { go } from "@codemirror/legacy-modes/mode/go";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { c, cpp, java, csharp, objectiveC } from "@codemirror/legacy-modes/mode/clike";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";

const langCache = new Map<string, Extension>();

function stream(mode: Parameters<typeof StreamLanguage.define>[0]): Extension {
  return StreamLanguage.define(mode);
}

/** 按文件名 / 扩展名挑语言；认不出来的当纯文本（仍有行号与编辑能力） */
export function languageFor(name: string): Extension {
  const lower = String(name || "").toLowerCase();
  const base = lower.split("/").pop() || lower;
  const ext = (base.includes(".") ? base.split(".").pop() : "") || "";
  const key = `${base}|${ext}`;
  const hit = langCache.get(key);
  if (hit) return hit;
  const pick = (): Extension => {
    if (/^(dockerfile|containerfile)/.test(base)) return stream(dockerFile);
    if (base === "makefile" || base === "makefile.am") return stream(shell);
    switch (ext) {
      case "js": case "mjs": case "cjs": case "jsx":
        return javascript({ jsx: true });
      case "ts": case "mts": case "cts":
        return javascript({ typescript: true });
      case "tsx":
        return javascript({ jsx: true, typescript: true });
      case "json": case "jsonc": case "json5": case "map": case "webmanifest":
        return javascript();
      case "html": case "htm": case "xhtml": case "vue": case "svelte":
        return html();
      case "css": case "scss": case "less":
        return css();
      case "md": case "markdown": case "mdx":
        return markdown();
      case "xml": case "svg": case "plist": case "xib": case "storyboard":
        return stream(xml);
      case "yml": case "yaml":
        return stream(yaml);
      case "toml": case "ini": case "cfg": case "conf": case "env":
        return stream(properties);
      case "sh": case "bash": case "zsh": case "fish": case "ksh":
        return stream(shell);
      case "py": case "pyi": case "pyw":
        return stream(python);
      case "go": return stream(go);
      case "rs": return stream(rust);
      case "c": case "h": return stream(c);
      case "cc": case "cpp": case "cxx": case "hpp": case "hh": case "hxx": case "mm": case "m":
        return stream(ext === "m" || ext === "mm" ? objectiveC : cpp);
      case "java": return stream(java);
      case "cs": case "csx": return stream(csharp);
      case "kt": case "kts": case "scala": case "groovy": return stream(java);
      case "swift": return stream(swift);
      case "rb": case "rake": case "gemspec": return stream(ruby);
      case "lua": return stream(lua);
      case "sql": case "psql": return stream(standardSQL);
      case "hs": case "lhs": return stream(haskell);
      case "proto": return stream(protobuf);
      case "diff": case "patch": return stream(diff);
      case "properties": case "gitconfig": case "editorconfig": return stream(properties);
      default:
        return [];
    }
  };
  const ext2 = pick();
  langCache.set(key, ext2);
  return ext2;
}

/* 高亮：只用设计系统的语义色，亮暗都靠 CSS 变量翻转 */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], color: "var(--purple)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: "var(--green)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--amber)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--faint)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--brand)" },
  { tag: [t.typeName, t.className, t.tagName, t.namespace], color: "var(--indigo)" },
  { tag: [t.propertyName, t.attributeName, t.definition(t.variableName)], color: "var(--fg-2)" },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: "var(--muted)" },
  { tag: [t.heading, t.strong], color: "var(--fg)", fontWeight: "600" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.link, t.url], color: "var(--brand)", textDecoration: "underline" },
  { tag: [t.invalid], color: "var(--red)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--fg)", fontSize: "12.5px" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.55", overflow: "auto" },
  ".cm-content": { padding: "10px 0 40px", caretColor: "var(--fg)" },
  ".cm-line": { padding: "0 12px 0 6px" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--faint)", border: "0", paddingLeft: "4px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--fg) 4%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-2)" },
  ".cm-foldGutter span": { color: "var(--faint)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--fg)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--fg) 16%, transparent) !important",
  },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--amber) 26%, transparent)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--amber) 30%, transparent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--brand) 34%, transparent)" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--fg)" },
  ".cm-tooltip": { border: "1px solid var(--border)", borderRadius: "8px", backgroundColor: "var(--surface)", boxShadow: "var(--shadow-1)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--surface-selected)", color: "var(--fg)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--brand) 18%, transparent)", outline: "none" },
});

export function CodeEditor({ value, name, readOnly = false, wrap = false, onDraft, onSave, onPost }: {
  value: string;
  /** 用于推断语言（通常是文件名或相对路径） */
  name: string;
  readOnly?: boolean;
  /** 长行折行（md / txt 打开，代码默认不折） */
  wrap?: boolean;
  onDraft: (text: string) => void;
  onSave: () => void;
  /** 保存 / 光标移动后把编辑器接口交出去（供外部滚动定位等） */
  onPost?: (view: EditorView) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const draftRef = useRef(onDraft);
  const saveRef = useRef(onSave);
  const postRef = useRef(onPost);
  draftRef.current = onDraft;
  saveRef.current = onSave;
  postRef.current = onPost;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: true }),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(highlight),
      theme,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      keymap.of([
        { key: "Mod-s", run: () => { saveRef.current(); return true; } },
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...foldKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) draftRef.current(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) postRef.current?.(update.view);
      }),
    ];
    if (wrap) extensions.push(EditorView.lineWrapping);
    const lang = languageFor(name);
    if (Array.isArray(lang) ? lang.length : Boolean(lang)) extensions.push(lang);

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host,
    });
    viewRef.current = view;
    postRef.current?.(view);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 换文件才重建编辑器；同文件由外部 setValue 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, readOnly, wrap]);

  /* 外部改了内容（刷新 / ⌘S 回写 / 换文件）：只在真的不同时替换，避免把光标打回开头 */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div className="code-editor" ref={hostRef} />;
}
