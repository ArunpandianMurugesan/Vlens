// Shared by the server layout (which inlines the script) and the client theme
// store, so it can't live in a "use client" file.
export const THEME_KEY = "lens.theme";
export const ACCENT_KEY = "lens.accent";
export const SIDEBAR_KEY = "lens.sidebarCollapsed";

// Runs in <head> before the first paint, so dark mode doesn't flash white
// (and a hidden sidebar doesn't flash open).
// Keep it in sync with resolve() in theme.ts.
export const THEME_BOOT_SCRIPT = `try{var p=localStorage.getItem("${THEME_KEY}")||"system";var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";var a=localStorage.getItem("${ACCENT_KEY}");if(a)document.documentElement.dataset.accent=a;if(localStorage.getItem("${SIDEBAR_KEY}")==="1")document.documentElement.dataset.sidebar="collapsed"}catch(e){}`;
