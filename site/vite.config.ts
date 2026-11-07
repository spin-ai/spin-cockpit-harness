import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = process.env.GITHUB_REPOSITORY?.split("/").pop() || "";
const base = process.env.DOCS_BASE || (repo ? `/${repo}/` : "/");

export default defineConfig({
  root,
  base,
  plugins: [react()],
  // 复用应用里的 public/wiki 图片，不在 site/ 再复制一份
  publicDir: path.resolve(root, "../public"),
  server: { port: 5198, strictPort: true },
  build: {
    outDir: path.resolve(root, "../dist-pages"),
    emptyOutDir: true,
  },
});
