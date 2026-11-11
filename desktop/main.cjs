// Vlens for Mac: starts the Vlens server that ships inside the app, then
// shows it in a window. Quitting the app stops the server.
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, nativeTheme, shell } = require("electron");
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

// The Mac's folder window, as a sheet on the Vlens window (preload.cjs). Only for
// Vlens's own pages.
ipcMain.handle("choose-folder", async (e, start) => {
  if (!e.senderFrame?.url?.startsWith(url)) return null;
  const owner = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(owner, {
    title: "Choose a folder for this session",
    buttonLabel: "Choose",
    defaultPath: typeof start === "string" && start ? start : app.getPath("home"),
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: "Vlens",
    // Like a Mac app: no title bar; the traffic lights sit at the top of the left rail
    // (the page makes room for them and lets its headers drag the window).
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 18 } } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1f1e1b" : "#faf9f5",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
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

// A menu item tells the page what to do (src/lib/menu.ts): no preload script
// needed, and the same actions work from the page's own shortcuts.
function send(action) {
  if (!win) {
    if (url) createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
  win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent("lens:menu", { detail: ${JSON.stringify(action)} }))`).catch(() => {});
}
// For keys the page handles itself (Enter, 1, 2, Esc, Shift+Tab): the menu shows
// them so you can learn them, but doesn't take them from the page.
const hint = (accelerator) => ({ accelerator, registerAccelerator: false });
const item = (label, action, accelerator, extra = {}) => ({ label, click: () => send(action), ...(accelerator ? { accelerator } : {}), ...extra });

function buildMenu() {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          item("Settings…", "settings", "CmdOrCtrl+,"),
          {
            label: "Open at Login",
            type: "checkbox",
            checked: openAtLogin,
            click: (it) => app.setLoginItemSettings({ openAtLogin: it.checked }),
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
      {
        label: "File",
        submenu: [
          item("New Session", "new-session", "CmdOrCtrl+N"),
          item("New Session in Worktree", "new-worktree", "Shift+CmdOrCtrl+N"),
          item("Open Folder…", "open-folder", "CmdOrCtrl+O"),
          { type: "separator" },
          item("Archive Session", "archive", "CmdOrCtrl+Backspace"),
          { type: "separator" },
          { role: "close", label: "Close Window" },
        ],
      },
      { role: "editMenu" },
      {
        label: "Session",
        submenu: [
          item("Allow", "allow", null, hint("1")),
          item("Always Allow", "always", null, hint("2")),
          item("Deny", "deny", null, hint("Esc")),
          { type: "separator" },
          item("Next Permission Mode", "next-mode", null, hint("Shift+Tab")),
          item("Stop Claude", "stop", "CmdOrCtrl+."),
          item("Compact Context", "compact", "Alt+CmdOrCtrl+K"),
          { type: "separator" },
          item("Fork Session", "fork", "Shift+CmdOrCtrl+F"),
          item("Fork in Terminal", "fork-terminal"),
          { type: "separator" },
          item("Continue in Terminal", "to-terminal", "Alt+CmdOrCtrl+T"),
          item("Take Over Here", "take-over", "Alt+CmdOrCtrl+H"),
        ],
      },
      {
        label: "Go",
        submenu: [
          item("Sessions", "go-sessions", "CmdOrCtrl+1"),
          item("Review", "go-review", "CmdOrCtrl+2"),
          { type: "separator" },
          item("Home", "go-home", "Shift+CmdOrCtrl+H"),
          item("History", "go-history", "CmdOrCtrl+Y"),
          item("Marketplace", "go-marketplace"),
          { type: "separator" },
          item("Quick Switcher…", "switcher", "CmdOrCtrl+K"),
          item("Next Waiting Session", "next-waiting", "CmdOrCtrl+]"),
        ],
      },
      {
        label: "View",
        submenu: [
          item("Toggle Sidebar", "toggle-sidebar", "Ctrl+CmdOrCtrl+S"),
          item("Toggle Inspector", "toggle-inspector", "Alt+CmdOrCtrl+I"),
          item("Toggle Terminal", "toggle-terminal", "Ctrl+`"),
          { type: "separator" },
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools", accelerator: "Alt+CmdOrCtrl+J" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          { label: "Vlens on GitHub", click: () => shell.openExternal("https://github.com/ArunpandianMurugesan/Vlens") },
          { label: "Claude Code docs", click: () => shell.openExternal("https://docs.claude.com/en/docs/claude-code/overview") },
        ],
      },
    ]),
  );
}

// ── Menu bar ───────────────────────────────────────────────────────────────
// A "V" in the menu bar: what waits on you (answer Vlens's own prompts right
// there), what's working and plan usage. Its number is how many
// things need you. Reads the page's server (/api/tray) every few seconds.
let tray = null;
let trayKey = "";

function api(pathname, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathname, url);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(u, { method, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}, timeout: 8000 }, (res) => {
      let out = "";
      res.on("data", (c) => (out += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error("bad response"));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}

const cut = (t, n = 48) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

async function answer(id, decision) {
  await api("/api/permission", "POST", { id, decision }).catch(() => {});
  trayKey = "";
  void refreshTray();
}

function trayMenu(d) {
  const items = [];
  const u = d.usage;
  items.push({ label: u ? `Vlens · 5h ${u.fiveHour ?? "–"}% · Week ${u.week ?? "–"}%` : "Vlens", enabled: false });
  if (d.asks.length || d.waiting.length) {
    items.push({ type: "separator" }, { label: "Waiting for you", enabled: false });
    for (const a of d.asks) {
      const open = () => send(`open-session:${a.session}`);
      items.push({
        label: `${cut(a.title, 40)} · ${a.where}`,
        sublabel: cut(a.kind === "tool" ? `${a.tool} ${a.summary}`.trim() : a.summary, 60),
        submenu:
          a.kind === "tool"
            ? [
                { label: "Allow", click: () => answer(a.id, "allow") },
                ...(a.always ? [{ label: "Always Allow", click: () => answer(a.id, "always") }] : []),
                { label: "Deny", click: () => answer(a.id, "deny") },
                { type: "separator" },
                { label: "Open in Vlens", click: open },
              ]
            : [{ label: a.kind === "plan" ? "Review the plan in Vlens" : "Answer in Vlens", click: open }],
      });
    }
    for (const w of d.waiting) items.push({ label: `${cut(w.title, 40)} · ${w.where}`, sublabel: cut(`${w.why}, answer it there`, 60), click: () => send(`open-session:${w.id}`) });
  }
  if (d.working.length) {
    items.push({ type: "separator" }, { label: "Working", enabled: false });
    for (const w of d.working.slice(0, 8)) items.push({ label: cut(w.title), sublabel: w.where, click: () => send(`open-session:${w.id}`) });
  }
  items.push(
    { type: "separator" },
    { label: "New Session…", click: () => send("new-session") },
    { label: "Quick Switcher…", click: () => send("switcher") },
    { label: "Open Vlens", click: () => (win ? (win.show(), win.focus()) : url && createWindow()) },
    { type: "separator" },
    { role: "quit", label: "Quit Vlens" },
  );
  return Menu.buildFromTemplate(items);
}

async function refreshTray() {
  if (!tray || !url) return;
  let d;
  try {
    d = await api("/api/tray");
  } catch {
    return;
  }
  const key = JSON.stringify(d);
  if (key === trayKey) return; // rebuilding the menu closes it if it's open
  trayKey = key;
  const n = d.asks.length + d.waiting.length;
  tray.setTitle(n ? ` ${n}` : "");
  tray.setToolTip(n ? `Vlens: ${n} waiting for you` : "Vlens");
  tray.setContextMenu(trayMenu(d));
}

function startTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "build", "trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Vlens");
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "Vlens", enabled: false }, { role: "quit", label: "Quit Vlens" }]));
  void refreshTray();
  setInterval(() => void refreshTray(), 5000);
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
    startTray();
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
