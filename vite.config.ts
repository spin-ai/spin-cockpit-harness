import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5199,
    strictPort: true,
    watch: { ignored: ["**/docs/**", "**/release/**", "**/dist/**"] },
  },
  // Only the app's index.html is an entry; docs/ contains vendored reference/reference sources.
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: "dist" },
});
