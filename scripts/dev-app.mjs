// `npm run app`: the Vlens window on a hot-reloading dev server, in one command.
// Starts `next dev` on port 3467, waits until it answers, then opens the Electron
// window on it. Quitting the window stops the dev server too.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3467;
const url = `http://127.0.0.1:${port}`;

const dev = spawn("npx", ["next", "dev", "--turbopack", "-H", "127.0.0.1", "-p", String(port)], { cwd: root, stdio: "inherit" });
let app = null;

const stop = (code = 0) => {
  app?.kill();
  dev.kill();
  process.exit(code);
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
dev.on("exit", (code) => {
  if (!app) console.error(`\nThe dev server stopped (code ${code}). Is port ${port} already in use?`);
  stop(code ?? 1);
});

// The first page load compiles the app, so wait for it before opening the window.
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}

app = spawn("npm", ["run", "app"], { cwd: path.join(root, "desktop"), stdio: "inherit" });
app.on("exit", () => stop());
