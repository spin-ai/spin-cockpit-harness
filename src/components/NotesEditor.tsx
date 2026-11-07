import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";

export type NotePickerItem = { path: string; title: string };

/**
 * CodeMirror 编辑面：Markdown 高亮 + [[page]] / #tag 补全。
 * 预览仍然是独立渲染，避免把编辑器状态塞进 React。
 */
export function NotesEditor({ value, pages, tags, onChange, onSave }: {
  value: string;
  pages: NotePickerItem[];
  tags: string[];
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const pagesRef = useRef(pages);
  const tagsRef = useRef(tags);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  pagesRef.current = pages;
  tagsRef.current = tags;

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
      EditorView.lineWrapping,
      autocompletion({ override: [completion], activateOnTyping: true, maxRenderedOptions: 24 }),
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current(); return true; } },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
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

  return <div className="notes-codemirror" ref={hostRef} />;
}
