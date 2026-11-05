import { spawn } from "node:child_process";
import { createServer } from "vite";

const server = await createServer({ server: { port: 5199, strictPort: true } });
await server.listen();
const url = server.resolvedUrls?.local?.[0] || "http://127.0.0.1:5199/";
console.log(`renderer ${url}`);

const electron = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["electron", "."],
  { stdio: "inherit", env: { ...process.env, VITE_DEV_SERVER_URL: url } },
);
electron.on("exit", async (code) => { await server.close(); process.exit(code ?? 0); });
const stop = async () => { electron.kill("SIGTERM"); await server.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
