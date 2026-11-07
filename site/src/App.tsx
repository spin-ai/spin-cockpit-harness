import { useEffect, useState } from "react";
import { GitWiki } from "../../src/components/GitWiki";
import { WIKI_PAGES } from "../../src/wiki/pages";

function readHash() {
  const match = window.location.hash.match(/^#\/wiki\/([a-z0-9-]+)$/);
  return match?.[1] || "home";
}

function initialTheme() {
  try {
    const stored = localStorage.getItem("cockpit-docs-theme");
    if (stored === "dark" || stored === "light") return stored === "dark";
  } catch { /* ignore */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function App() {
  const [pageId, setPageId] = useState(readHash);
  const [dark, setDark] = useState(initialTheme);

  useEffect(() => {
    const onHash = () => setPageId(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.mode = dark ? "dark" : "light";
    try { localStorage.setItem("cockpit-docs-theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);

  useEffect(() => {
    const page = WIKI_PAGES.find((item) => item.id === pageId);
    document.title = page ? `${page.title} · Cockpit Harness Docs` : "Cockpit Harness Docs";
  }, [pageId]);

  const go = (id: string) => {
    if (readHash() === id) setPageId(id);
    else window.location.hash = `#/wiki/${id}`;
  };

  return (
    <div className="docs-shell">
      <header className="docs-top">
        <a className="docs-brand" href="#/wiki/home">
          <b>Cockpit Harness</b>
          <span>Docs</span>
        </a>
        <nav>
          <a href="https://github.com/spin-ai/spin-cockpit-harness" target="_blank" rel="noreferrer">GitHub</a>
          <button type="button" onClick={() => setDark((value) => !value)}>
            {dark ? "☀ 浅色" : "☾ 深色"}
          </button>
        </nav>
      </header>
      <main className="docs-body">
        <GitWiki pageId={pageId} onNavigate={go} sourceLabel="GitHub Pages" />
      </main>
    </div>
  );
}
