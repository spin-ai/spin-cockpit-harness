import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../../src/wiki.css";
import "./site.css";

// GitHub Pages 没有 Electron preload：补最小 harness API 给共享的 GitWiki 组件
if (!window.harness) {
  (window as unknown as { harness: unknown }).harness = {
    openExternal: (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return Promise.resolve(true);
    },
    clipboardWrite: (text: string) => navigator.clipboard?.writeText(text),
  };
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
