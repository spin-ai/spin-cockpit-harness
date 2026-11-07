import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown, slugifyHeading } from "../markdown";
import { WIKI_GROUPS, WIKI_PAGES, wikiPage } from "../wiki/pages";
import { WIKI_DEMOS } from "../wiki/demos";
import { WikiFlowDemo } from "./WikiFlowDemo";

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
export function GitWiki({ branch, head, pageId, onNavigate, sourceLabel }: {
  branch?: string | null;
  head?: string | null;
  /** 外部路由（GitHub Pages）：当前页面 id 与导航回调 */
  pageId?: string;
  onNavigate?: (id: string) => void;
  /** 非 Electron 环境（GitHub Pages）的来源标签 */
  sourceLabel?: string;
}) {
  const [activeId, setActiveId] = useState(() => (pageId && WIKI_PAGES.some((p) => p.id === pageId) ? pageId : "home"));
  const [activeHeading, setActiveHeading] = useState("");
  const [query, setQuery] = useState("");
  const [lightbox, setLightbox] = useState<{ images: { src: string; alt: string }[]; index: number } | null>(null);
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
    if (pageId && pageId !== activeId) setActiveId(pageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeId]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [queryText]);

  // 右侧目录滚动高亮
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const onScroll = () => {
      const edge = root.getBoundingClientRect().top + 32;
      let current = "";
      for (const heading of headings) {
        const el = root.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`);
        if (el && el.getBoundingClientRect().top <= edge) current = heading.id;
      }
      setActiveHeading(current || headings[0]?.id || "");
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [headings, activeId]);

  // 代码块复制按钮
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    for (const pre of root.querySelectorAll("pre")) {
      if (pre.querySelector(".wiki-copy")) continue;
      const code = pre.querySelector("code");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wiki-copy";
      button.textContent = "复制";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = code?.textContent || pre.textContent || "";
        void window.harness.clipboardWrite(text);
        button.textContent = "已复制";
        window.setTimeout(() => { button.textContent = "复制"; }, 1200);
      });
      pre.appendChild(button);
    }
  }, [html, activeId]);

  // 图片灯箱：Esc 关闭，左右切换
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setLightbox((current) => {
          if (!current) return null;
          const delta = event.key === "ArrowRight" ? 1 : -1;
          return { ...current, index: (current.index + delta + current.images.length) % current.images.length };
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

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
    onNavigate?.(id);
  };

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const image = (event.target as HTMLElement).closest("img");
    if (image && contentRef.current) {
      const all = [...contentRef.current.querySelectorAll("img")];
      const index = all.indexOf(image as HTMLImageElement);
      if (index >= 0) {
        event.preventDefault();
        setLightbox({
          images: all.map((el) => ({ src: (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src, alt: (el as HTMLImageElement).alt })),
          index,
        });
        return;
      }
    }
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
          <span>{branch ? `Git · ${branch}` : sourceLabel || "本地文档"}</span>
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
          {WIKI_DEMOS[page.id] && <WikiFlowDemo {...WIKI_DEMOS[page.id]} />}
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
                className={`git-wiki-toc-link level-${heading.level} ${activeHeading === heading.id ? "on" : ""}`}
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

      {lightbox && (
        <div className="wiki-lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <button className="wiki-lightbox-close" onClick={() => setLightbox(null)}>×</button>
          <button
            className="wiki-lightbox-nav prev"
            disabled={lightbox.images.length < 2}
            onClick={(event) => { event.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index - 1 + lightbox.images.length) % lightbox.images.length }); }}
          >←</button>
          <figure onClick={(event) => event.stopPropagation()}>
            <img src={lightbox.images[lightbox.index]?.src} alt={lightbox.images[lightbox.index]?.alt} />
            <figcaption>
              {lightbox.images[lightbox.index]?.alt || "预览图"}
              <span>{lightbox.index + 1} / {lightbox.images.length}</span>
            </figcaption>
          </figure>
          <button
            className="wiki-lightbox-nav next"
            disabled={lightbox.images.length < 2}
            onClick={(event) => { event.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index + 1) % lightbox.images.length }); }}
          >→</button>
        </div>
      )}
    </div>
  );
}
