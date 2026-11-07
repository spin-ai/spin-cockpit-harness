import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown, slugifyHeading } from "../markdown";
import { WIKI_GROUPS, WIKI_PAGES, wikiPage } from "../wiki/pages";

type Heading = { id: string; text: string; level: number };

function headingsOf(markdown: string): Heading[] {
  const out: Heading[] = [];
  for (const match of markdown.matchAll(/^(#{2,4})\s+(.+)$/gm)) {
    const text = match[2].replace(/[*_`~]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
    if (text) out.push({ id: slugifyHeading(text), text, level: match[1].length });
  }
  return out;
}

function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~|-]/g, " ")
    .replace(/\s+/g, " ");
}

/** Git 视图里的项目 Wiki：内容随仓库版本发布，页面之间用 #/wiki/<id> 跳转。 */
export function GitWiki({ branch, head }: { branch?: string | null; head?: string | null }) {
  const [activeId, setActiveId] = useState("home");
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const page = wikiPage(activeId);
  const queryText = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!queryText) return WIKI_PAGES;
    return WIKI_PAGES.filter((item) => `${item.title} ${item.summary} ${plainText(item.body)}`.toLowerCase().includes(queryText));
  }, [queryText]);

  const body = useMemo(() => page.body.replace(/^#\s+.*\n+/, ""), [page]);
  const html = useMemo(() => renderMarkdown(body), [body]);
  const headings = useMemo(() => headingsOf(body), [body]);
  const index = WIKI_PAGES.findIndex((item) => item.id === page.id);
  const prev = index > 0 ? WIKI_PAGES[index - 1] : null;
  const next = index >= 0 && index < WIKI_PAGES.length - 1 ? WIKI_PAGES[index + 1] : null;

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeId]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [queryText]);

  // ⌘F 聚焦 Wiki 搜索；Esc 清空
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key === "Escape" && document.activeElement === searchRef.current) {
        event.preventDefault();
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = (id: string) => {
    setActiveId(id);
    setQuery("");
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("#/wiki/")) {
      event.preventDefault();
      const id = href.slice(7);
      if (WIKI_PAGES.some((item) => item.id === id)) open(id);
      return;
    }
    if (/^https?:/i.test(href)) {
      event.preventDefault();
      void window.harness.openExternal(href);
    }
  };

  const scrollTo = (id: string) => {
    const target = contentRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="git-wiki">
      <aside className="git-wiki-side">
        <div className="git-wiki-side-head">
          <span className="mono tiny faint">PROJECT WIKI</span>
          <span className="tiny muted">{WIKI_PAGES.length} 页</span>
        </div>
        <input
          ref={searchRef}
          className="git-wiki-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索页面 / 内容"
          title="⌘F 搜索"
        />
        <div className="git-wiki-list">
          {WIKI_GROUPS.map((group) => {
            const items = filtered.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <section key={group} className="git-wiki-group">
                <div className="git-wiki-group-head">{group}</div>
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={`git-wiki-link ${item.id === page.id ? "on" : ""}`}
                    onClick={() => open(item.id)}
                    title={item.summary}
                  >
                    <span>{item.title}</span>
                    <em>{item.id}</em>
                  </button>
                ))}
              </section>
            );
          })}
          {filtered.length === 0 && <div className="git-wiki-empty">没有匹配的页面</div>}
        </div>
        <div className="git-wiki-side-foot">
          <span>{branch ? `Git · ${branch}` : "本地文档"}</span>
          {head && <span className="mono">{head.slice(0, 7)}</span>}
        </div>
      </aside>

      <main className="git-wiki-main">
        <div className="git-wiki-content" ref={contentRef} onClick={onClick}>
          <header className="git-wiki-page-head">
            <div className="git-wiki-kicker">{page.group} · {branch ? "GIT WIKI" : "PROJECT WIKI"}</div>
            <h1>{page.title}</h1>
            <p>{page.summary}</p>
            <div className="git-wiki-meta">
              <span className="mono">{page.id}.md</span>
              <span>随仓库版本发布</span>
              {branch && <span>分支 {branch}</span>}
              {head && <span className="mono">HEAD {head.slice(0, 7)}</span>}
            </div>
          </header>
          <article className="md-render git-wiki-markdown" dangerouslySetInnerHTML={{ __html: html }} />
          <footer className="git-wiki-pager">
            {prev ? <button className="git-wiki-pager-btn" onClick={() => open(prev.id)}><span>← 上一篇</span><b>{prev.title}</b></button> : <span />}
            {next ? <button className="git-wiki-pager-btn next" onClick={() => open(next.id)}><span>下一篇 →</span><b>{next.title}</b></button> : <span />}
          </footer>
        </div>
      </main>

      <aside className="git-wiki-toc">
        <div className="git-wiki-toc-head">本页目录</div>
        {headings.length > 0
          ? headings.map((heading) => (
              <button
                key={`${heading.level}-${heading.id}`}
                className={`git-wiki-toc-link level-${heading.level}`}
                onClick={() => scrollTo(heading.id)}
                title={heading.text}
              >
                {heading.text}
              </button>
            ))
          : <div className="git-wiki-empty">无小节</div>}
        <div className="git-wiki-toc-foot">
          <button className="link" onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>回到顶部 ↑</button>
        </div>
      </aside>
    </div>
  );
}
