// Vlens for Mac: starts the Vlens server that ships inside the app, then
// shows it in a window. Quitting the app stops the server.
const { app, BrowserWindow, Menu, dialog, nativeTheme, shell } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const PREFERRED_PORT = 3459; // a fixed port keeps the browser storage (theme, hidden PRs) stable
// Dev mode (`npm run app` in desktop/) just opens the dev server instead.
const DEV_URL = process.env.LENS_DEV_URL;

// Electron's own browser data (cache, storage) goes in a subfolder, so it stays
// out of the files Vlens keeps in ~/Library/Application Support/Vlens.
// The dev window gets its own, so it can run next to the installed app.
// Vlens started as Claude Lens: copy its old folder over once (the same as
// src/lib/paths.ts, which runs too late for Electron's own data).
const dataDir = path.join(app.getPath("appData"), "Vlens");
const oldDataDir = path.join(app.getPath("appData"), "Claude Lens");
if (!fs.existsSync(dataDir) && fs.existsSync(oldDataDir)) {
  try {
    fs.cpSync(oldDataDir, dataDir, { recursive: true, filter: (src) => !path.basename(src).startsWith("Singleton") });
  } catch {}
}
app.setPath("userData", path.join(dataDir, DEV_URL ? "electron-dev" : "electron"));

let server = null;
let win = null;
let url = null;

const logDir = path.join(os.homedir(), "Library", "Logs", "Vlens");
fs.mkdirSync(logDir, { recursive: true });
const log = fs.createWriteStream(path.join(logDir, "server.log"), { flags: "a" });

// Apps opened from the Dock don't get your shell's PATH, so `claude`, `gh` and
// `git` wouldn't be found. Ask your login shell for it once at startup.
function loadShellPath() {
  const shellBin = process.env.SHELL || "/bin/zsh";
  try {
    const out = execFileSync(shellBin, ["-ilc", 'printf "__LENS_PATH__%s" "$PATH"'], { encoding: "utf8", timeout: 8000 });
    const found = out.split("__LENS_PATH__").pop().trim();
    if (found) process.env.PATH = found;
  } catch {}
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local", "bin")];
  process.env.PATH = [...new Set([...(process.env.PATH || "").split(":"), ...extra])].filter(Boolean).join(":");
}

function freePort(preferred) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => {
      const any = net.createServer();
      any.listen(0, "127.0.0.1", () => {
        const { port } = any.address();
        any.close(() => resolve(port));
      });
    });
    s.listen(preferred, "127.0.0.1", () => s.close(() => resolve(preferred)));
  });
}

function waitForServer(target, ms = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      http
        .get(target, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - started > ms) reject(new Error("The Vlens server didn't start in time."));
          else setTimeout(tryOnce, 200);
        });
    };
    tryOnce();
  });
}

function nodeBinary() {
  if (process.platform !== "darwin") return process.execPath;
  const name = app.getName();
  const helper = path.join(path.dirname(process.execPath), "..", "Frameworks", `${name} Helper.app`, "Contents", "MacOS", `${name} Helper`);
  return fs.existsSync(helper) ? helper : process.execPath;
}

async function startServer() {
  const port = await freePort(PREFERRED_PORT);
  const dir = path.join(process.resourcesPath, "server");
  // Electron's own Node runs the server, so you don't need Node installed. On a Mac
  // it runs as the Helper binary: the main one would put a second, blank icon in the
  // Dock, while the Helper is marked to stay out of it.
  server = spawn(nodeBinary(), [path.join(dir, "server.js")], {
    cwd: dir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1", // only this Mac can reach it
      LENS_PLUGIN_DIR: path.join(process.resourcesPath, "lens-plugin"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log, { end: false });
  server.stderr.pipe(log, { end: false });
  server.on("exit", (code) => {
    log.write(`\n[lens] server exited with code ${code}\n`);
    if (!app.isQuitting) {
      dialog.showErrorBox("Vlens stopped", `The Vlens server stopped (code ${code}). See ~/Library/Logs/Vlens/server.log.`);
      app.quit();
    }
  });
  const target = `http://127.0.0.1:${port}`;
  await waitForServer(target);
  return target;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: "Vlens",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1f1e1b" : "#faf9f5",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(url);

  // Links (GitHub, Jira, docs) open in your normal browser, not inside Vlens.
  const isLens = (u) => u.startsWith(url);
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/.test(u) && !isLens(u)) shell.openExternal(u);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, u) => {
    if (!isLens(u)) {
      e.preventDefault();
      if (/^https?:/.test(u)) shell.openExternal(u);
    }
  });
  win.on("closed", () => (win = null));
}

function buildMenu() {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Open at Login",
            type: "checkbox",
            checked: openAtLogin,
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
          },
          {
            label: "Show Server Log",
            click: () => shell.openPath(path.join(logDir, "server.log")),
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
      },
      { role: "windowMenu" },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit(); // already running: the first copy shows its window instead
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    loadShellPath();
    buildMenu();
    // A missing `claude` (or a signed-out one) is handled by the Get started page.
    try {
      url = DEV_URL || (await startServer());
    } catch (e) {
      dialog.showErrorBox("Vlens couldn't start", `${e.message}\nSee ~/Library/Logs/Vlens/server.log.`);
      app.quit();
      return;
    }
    createWindow();
  });

  // On a Mac, closing the window keeps the app running; clicking the Dock icon reopens it.
  app.on("activate", () => {
    if (!win && url) createWindow();
  });
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    app.isQuitting = true;
    if (server) server.kill("SIGTERM");
  });
}
