import { useEffect, useState } from "react";
import { GitWiki } from "../../src/components/GitWiki";
import { WIKI_PAGES } from "../../src/wiki/pages";
import { Landing } from "./Landing";

function wikiIdFromHash(hash: string) {
  const match = hash.match(/^#\/wiki\/([a-z0-9-]+)$/);
  return match?.[1] || null;
}

function initialTheme() {
  try {
    const stored = localStorage.getItem("cockpit-docs-theme");
    if (stored === "dark" || stored === "light") return stored === "dark";
  } catch { /* ignore */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const [dark, setDark] = useState(initialTheme);
  const wikiId = wikiIdFromHash(hash);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.mode = dark ? "dark" : "light";
    try { localStorage.setItem("cockpit-docs-theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);

  useEffect(() => {
    if (!wikiId) {
      document.title = "Cockpit Harness · 多 Agent 编排工作台";
      return;
    }
    const page = WIKI_PAGES.find((item) => item.id === wikiId);
    document.title = page ? `${page.title} · Cockpit Harness Docs` : "Cockpit Harness Docs";
  }, [wikiId]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [wikiId]);

  const go = (id: string) => {
    if (wikiId === id) setHash(`#/wiki/${id}`);
    else window.location.hash = `#/wiki/${id}`;
  };

  const toggleTheme = () => setDark((value) => !value);

  if (!wikiId) {
    return <Landing dark={dark} onToggleTheme={toggleTheme} />;
  }

  return (
    <div className="docs-shell">
      <header className="docs-top">
        <a className="docs-brand" href="#/">
          <b>Cockpit Harness</b>
          <span>Docs</span>
        </a>
        <nav>
          <a href="#/">首页</a>
          <a href="https://github.com/spin-ai/spin-cockpit-harness" target="_blank" rel="noreferrer">GitHub</a>
          <button type="button" onClick={toggleTheme}>
            {dark ? "☀ 浅色" : "☾ 深色"}
          </button>
        </nav>
      </header>
      <main className="docs-body">
        <GitWiki pageId={wikiId} onNavigate={go} sourceLabel="GitHub Pages" />
      </main>
    </div>
  );
}
