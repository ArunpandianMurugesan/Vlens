// The one thing the page asks of the app itself: the Mac's own folder window
// (src/lib/chooseFolder.ts). Kept tiny on purpose; menus still talk to the page
// with lens:menu events (see main.cjs).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vlensApp", {
  // -> the chosen folder's path, or null if you cancelled.
  chooseFolder: (start) => ipcRenderer.invoke("choose-folder", typeof start === "string" ? start : null),
});
