// Shared by the server layout (which inlines the script) and the client theme
// store, so it can't live in a "use client" file.
export const THEME_KEY = "lens.theme";
export const ACCENT_KEY = "lens.accent";

// Runs in <head> before the first paint, so dark mode doesn't flash white.
// Keep it in sync with resolve() in theme.ts.
export const THEME_BOOT_SCRIPT = `try{var p=localStorage.getItem("${THEME_KEY}")||"system";var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";var a=localStorage.getItem("${ACCENT_KEY}");if(a)document.documentElement.dataset.accent=a}catch(e){}`;
