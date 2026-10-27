// Builds the Lens web server for the Mac app and stages it in desktop/app-server.
// Uses its own build folder (next-app), so a running dev server isn't touched.
// No leading dot: electron-builder leaves dot-folders out of the app.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = "next-app";
const out = path.join(root, "desktop", "app-server");

// Always build from scratch: a reused build cache once shipped stale CSS.
fs.rmSync(path.join(root, dist), { recursive: true, force: true });
console.log("Building the Lens server…");
execFileSync("npx", ["next", "build"], { cwd: root, stdio: "inherit", env: { ...process.env, LENS_DIST_DIR: dist } });

fs.rmSync(out, { recursive: true, force: true });
// The standalone server, plus the static files and public/ it doesn't copy itself.
fs.cpSync(path.join(root, dist, "standalone"), out, { recursive: true });
fs.cpSync(path.join(root, dist, "static"), path.join(out, dist, "static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
// Lens's own data lives in ~/Library/Application Support, never in the app.
fs.rmSync(path.join(out, "data"), { recursive: true, force: true });
console.log(`Staged the server in ${path.relative(root, out)}`);
