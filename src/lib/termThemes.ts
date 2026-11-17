// Colour schemes for terminal profiles (lib/termProfiles.ts).
// Plain data, so the server layout's boot script can read it too.
//
// "vlens" follows the app: its terminal colours for light or dark, and the accent
// as the cursor. The others are the well-known schemes, with full ANSI palettes.

export interface TermPalette {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface TermTheme {
  id: string;
  label: string;
  palette: TermPalette | null; // null: follow the app
  group?: "terminal-app"; // copied from macOS Terminal.app's built-in profiles
  dark?: Partial<TermPalette>; // replaces colours while the app is dark (Terminal.app's Basic does this)
  // The profile's own font, size and cursor, where it has them.
  profile?: { fontFamily?: string; fontSize?: number; lineHeight?: number; cursorStyle?: "block" | "bar" | "underline"; cursorBlink?: boolean };
}

export const TERM_THEMES: TermTheme[] = [
  { id: "vlens", label: "Vlens", palette: null },
  {
    id: "dracula",
    label: "Dracula",
    palette: {
      background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", selectionBackground: "#44475a",
      black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
      blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
      brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5",
      brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff",
    },
  },
  {
    id: "nord",
    label: "Nord",
    palette: {
      background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", selectionBackground: "#434c5e",
      black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
      blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
      brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4",
    },
  },
  {
    id: "one-dark",
    label: "One Dark",
    palette: {
      background: "#282c34", foreground: "#abb2bf", cursor: "#528bff", selectionBackground: "#3e4451",
      black: "#3f4451", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
      blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
      brightBlack: "#5c6370", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b",
      brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#ffffff",
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    palette: {
      background: "#1a1b26", foreground: "#c0caf5", cursor: "#c0caf5", selectionBackground: "#33467c",
      black: "#15161e", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68",
      blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6",
      brightBlack: "#414868", brightRed: "#f7768e", brightGreen: "#9ece6a", brightYellow: "#e0af68",
      brightBlue: "#7aa2f7", brightMagenta: "#bb9af7", brightCyan: "#7dcfff", brightWhite: "#c0caf5",
    },
  },
  {
    id: "catppuccin",
    label: "Catppuccin Mocha",
    palette: {
      background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#f5e0dc", selectionBackground: "#585b70",
      black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af",
      blue: "#89b4fa", magenta: "#f5c2e7", cyan: "#94e2d5", white: "#bac2de",
      brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af",
      brightBlue: "#89b4fa", brightMagenta: "#f5c2e7", brightCyan: "#94e2d5", brightWhite: "#a6adc8",
    },
  },
  {
    id: "gruvbox",
    label: "Gruvbox Dark",
    palette: {
      background: "#282828", foreground: "#ebdbb2", cursor: "#ebdbb2", selectionBackground: "#504945",
      black: "#282828", red: "#cc241d", green: "#98971a", yellow: "#d79921",
      blue: "#458588", magenta: "#b16286", cyan: "#689d6a", white: "#a89984",
      brightBlack: "#928374", brightRed: "#fb4934", brightGreen: "#b8bb26", brightYellow: "#fabd2f",
      brightBlue: "#83a598", brightMagenta: "#d3869b", brightCyan: "#8ec07c", brightWhite: "#ebdbb2",
    },
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    palette: {
      background: "#002b36", foreground: "#839496", cursor: "#93a1a1", selectionBackground: "#073642",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
      brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    palette: {
      background: "#fdf6e3", foreground: "#657b83", cursor: "#586e75", selectionBackground: "#eee8d5",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
      brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  {
    id: "github-light",
    label: "GitHub Light",
    palette: {
      background: "#ffffff", foreground: "#1f2328", cursor: "#0969da", selectionBackground: "#b6e3ff",
      black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#4d2d00",
      blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
      brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37", brightYellow: "#633c01",
      brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#8c959f",
    },
  },
];

// macOS Terminal.app's built-in profiles, with the colours, font, size and cursor
// read from Terminal.app's own profile files. Profiles that don't set ANSI
// colours use Terminal.app's standard ones. Terminal.app draws some of these
// see-through (Pro, Homebrew, Red Sands, the Clear ones, Silver Aerogel); here
// they're solid, in the same colour. Solid Colors' background picture isn't copied.
export const TERMINAL_APP_THEMES: TermTheme[] = [
  {
    "id": "mac-basic",
    "label": "Basic",
    "group": "terminal-app",
    "palette": {
      "black": "#000000",
      "red": "#990000",
      "green": "#00a600",
      "yellow": "#999900",
      "blue": "#0000b2",
      "magenta": "#b200b2",
      "cyan": "#00a6b2",
      "white": "#bfbfbf",
      "brightBlack": "#666666",
      "brightRed": "#e50000",
      "brightGreen": "#00d900",
      "brightYellow": "#e5e500",
      "brightBlue": "#0000ff",
      "brightMagenta": "#e500e5",
      "brightCyan": "#00e5e5",
      "brightWhite": "#e5e5e5",
      "background": "#ffffff",
      "foreground": "#000000",
      "cursor": "#808080",
      "selectionBackground": "#b2d6ff"
    },
    "profile": {
      "fontSize": 11.0,
      "cursorStyle": "block",
      "cursorBlink": false
    },
    "dark": {
      "background": "#1e1e1e",
      "foreground": "#ffffff",
      "selectionBackground": "#3f638b"
    }
  },
  {
    "id": "mac-clear-dark",
    "label": "Clear Dark",
    "group": "terminal-app",
    "palette": {
      "black": "#35424c",
      "red": "#b45648",
      "green": "#6caa71",
      "yellow": "#c4ac62",
      "blue": "#6d96b4",
      "magenta": "#bd7bcd",
      "cyan": "#7ccbcd",
      "white": "#dee5eb",
      "brightBlack": "#465c6d",
      "brightRed": "#df6c5a",
      "brightGreen": "#79be7e",
      "brightYellow": "#e5c872",
      "brightBlue": "#67b5ed",
      "brightMagenta": "#d389e5",
      "brightCyan": "#84dde0",
      "brightWhite": "#e5eff5",
      "background": "#191d27",
      "foreground": "#e0e0e0",
      "cursor": "#808080",
      "selectionBackground": "#273d4c"
    },
    "profile": {
      "fontSize": 12.0,
      "cursorStyle": "block",
      "cursorBlink": false
    }
  },
  {
    "id": "mac-clear-light",
    "label": "Clear Light",
    "group": "terminal-app",
    "palette": {
      "black": "#2d3840",
      "red": "#b45648",
      "green": "#6caa71",
      "yellow": "#c4ac62",
      "blue": "#5685a8",
      "magenta": "#ad64be",
      "cyan": "#69c6c9",
      "white": "#c1c8cc",
      "brightBlack": "#506573",
      "brightRed": "#df6c5a",
      "brightGreen": "#79be7e",
      "brightYellow": "#e5c872",
      "brightBlue": "#49a2e1",
      "brightMagenta": "#d389e5",
      "brightCyan": "#77e1e5",
      "brightWhite": "#d8e1e7",
      "background": "#ffffff",
      "foreground": "#2d3840",
      "cursor": "#7f7f7f",
      "selectionBackground": "#dfe8ee"
    },
    "profile": {
      "fontSize": 12.0,
      "cursorStyle": "block",
      "cursorBlink": false
    }
  },
  {
    "id": "mac-grass",
    "label": "Grass",
    "group": "terminal-app",
    "palette": {
      "black": "#000000",
      "red": "#990000",
      "green": "#00a600",
      "yellow": "#999900",
      "blue": "#0000b2",
      "magenta": "#b200b2",
      "cyan": "#00a6b2",
      "white": "#bfbfbf",
      "brightBlack": "#666666",
      "brightRed": "#e50000",
      "brightGreen": "#00d900",
      "brightYellow": "#e5e500",
      "brightBlue": "#0000ff",
      "brightMagenta": "#e500e5",
      "brightCyan": "#00e5e5",
      "brightWhite": "#e5e5e5",
      "background": "#13773d",
      "foreground": "#fff0a5",
      "cursor": "#8e2800",
      "selectionBackground": "#b64926"
    },
    "profile": {
      "fontSize": 12.0,
      "cursorStyle": "block",
      "cursorBlink": false,
      "fontFamily": "Courier, \"Courier New\", monospace"
    }
  },
  {
    "id": "mac-homebrew",
    "label": "Homebrew",
    "group": "terminal-app",
    "palette": {
      "black": "#000000",
      "red": "#990000",
      "green": "#00a600",
      "yellow": "#999900",
      "blue": "#0000b2",
      "magenta": "#b200b2",
      "cyan": "#00a6b2",
      "white": "#bfbfbf",
      "brightBlack": "#666666",
      "brightRed": "#e50000",
      "brightGreen": "#00d900",
      "brightYellow": "#e5e500",
      "brightBlue": "#0000ff",
      "brightMagenta": "#e500e5",
      "brightCyan": "#00e5e5",
      "brightWhite": "#e5e5e5",
      "background": "#000000",
      "foreground": "#28fe14",
      "cursor": "#38fe27",
      "selectionBackground": "#0900e9a6"
    },
    "profile": {
      "fontSize": 12.0,
      "cursorStyle": "block",
      "cursorBlink": true,
      "fontFamily": "\"Andale Mono\", Menlo, monospace"
    }
  },
  {
    "id": "mac-man-page",
    "label": "Man Page",
    "group": "terminal-app",
    "palette": {
      "black": "#000000",
      "red": "#990000",
      "green": "#00a600",
      "yellow": "#999900",
      "blue": "#0000b2",
      "magenta": "#b200b2",
      "cyan": "#00a6b2",
      "white": "#bfbfbf",
      "brightBlack": "#666666",
      "brightRed": "#e50000",
      "brightGreen": "#00d900",
      "brightYellow": "#e5e500",
      "brightBlue": "#0000ff",
      "brightMagenta": "#e500e5",
      "brightCyan": "#00e5e5",
      "brightWhite": "#e5e5e5",
      "background": "#fef49c",
      "foreground": "#000000",
      "cursor": "#808080",
      "selectionBackground": "#bfb875"
    },
    "profile": {
      "fontSize": 11.0,
      "cursorStyle": "block",
      "cursorBlink": false
    }
  },
  {
    "id": "mac-novel",
    "label": "Novel",
    "group": "terminal-app",
    "palette": {
      "black": "#000000",
      "red": "#990000",
      "green": "#00a600",
      "yellow": "#999900",
      "blue": "#0000b2",
      "magenta": "#b200b2",
      "cyan": "#00a6b2",
      "white": "#bfbfbf",
      "brightBlack": "#666666",
      "brightRed": "#e50000",
      "brightGreen": "#00d900",
      "brightYellow": "#e5e500",
      "brightBlue": "#0000ff",
      "brightMagenta": "#e500e5",
      "brightCyan": "#00e5e5",
      "brightWhite": "#e5e5e5",
      "background": "#dfdbc3",
      "foreground": "#3b2322",
      "cursor": "#3a2322",
      "selectionBackground": "#747350c2"
    },
    "profile": {
      "fontSize": 12.0,
      "cursorStyle": "block",
      "cursorBlink": false,
      "fontFamily": "Courier, \"Courier New\", monospace"
    }
  },
  {
    "id": "mac-ocean",
    "label": "Ocean",
    "group": "terminal-app",
    "palette": {
      "black": "#000000",
      "red": "#990000",
      "green": "#00a600",
      "yellow": "#999900",
      "blue": "#0000b2",
      "magenta": "#b200b2",
      "cyan": "#00a6b2",
      "white": "#bfbfbf",
      "brightBlack": "#666666",
      "brightRed": "#e50000",
      "brightGreen": "#00d900",
      "brightYellow": "#e5e500",
      "brightBlue": "#0000ff",
      "brightMagenta": "#e500e5",
      "brightCyan": "#00e5e5",
      "brightWhite": "#e5e5e5",
      "background": "#224fbc",
      "foreground": "#ffffff",
      "cursor": "#808080",
      "selectionBackground": "#216dff"
    },
    "profile": {
      "fontSize": 11.0,
      "cursorStyle": "block",
      "cursorBlink": false
    }
  },
  {
    "id": "mac-pro",
    "label": "Pro",
    "group": "terminal-app",
    "palette": {
      "black": "#000000",
      "red": "#990000",
      "green": "#00a600",
      "yellow": "#999900",
      "blue": "#0000b2",
      "magenta": "#b200b2",
      "cyan": "#00a6b2",
      "white": "#bfbfbf",
      "brightBlack": "#666666",
      "brightRed": "#e50000",
      "brightGreen": "#00d900",
      "brightYellow": "#e5e500",
      "brightBlue": "#0000ff",
      "brightMagenta": "#e500e5",
      "brightCyan": "#00e5e5",
      "brightWhite": "#e5e5e5",
      "background": "#000000",
      "foreground": "#f2f2f2",
      "cursor": "#4d4d4d",
      "selectionBackground": "#414141"
    },
    "profile": {
      "fontSize": 10.0,
      "cursorStyle": "block",
      "cursorBlink": false,
      "fontFamily": "Monaco, Menlo, monospace"
    }
  },
  {
    "id": "mac-red-sands",
    "label": "Red Sands",
    "group": "terminal-app",
    "palette": {
      "black": "#000000",
      "red": "#990000",
      "green": "#00a600",
      "yellow": "#999900",
      "blue": "#0000b2",
      "magenta": "#b200b2",
      "cyan": "#00a6b2",
      "white": "#bfbfbf",
      "brightBlack": "#666666",
      "brightRed": "#e50000",
      "brightGreen": "#00d900",
      "brightYellow": "#e5e500",
      "brightBlue": "#0000ff",
      "brightMagenta": "#e500e5",
      "brightCyan": "#00e5e5",
      "brightWhite": "#e5e5e5",
      "background": "#7a251e",
      "foreground": "#d7c9a7",
      "cursor": "#ffffff",
      "selectionBackground": "#3d1916"
    },
    "profile": {
      "fontSize": 11.0,
      "cursorStyle": "underline",
      "cursorBlink": false
    }
  },
  {
    "id": "mac-silver-aerogel",
    "label": "Silver Aerogel",
    "group": "terminal-app",
    "palette": {
      "black": "#000000",
      "red": "#990000",
      "green": "#00a600",
      "yellow": "#999900",
      "blue": "#0000b2",
      "magenta": "#b200b2",
      "cyan": "#00a6b2",
      "white": "#bfbfbf",
      "brightBlack": "#666666",
      "brightRed": "#e50000",
      "brightGreen": "#00d900",
      "brightYellow": "#e5e500",
      "brightBlue": "#0000ff",
      "brightMagenta": "#e500e5",
      "brightCyan": "#00e5e5",
      "brightWhite": "#e5e5e5",
      "background": "#808080",
      "foreground": "#000000",
      "cursor": "#d9d9d9",
      "selectionBackground": "#65668a"
    },
    "profile": {
      "fontSize": 11.0,
      "cursorStyle": "block",
      "cursorBlink": false
    }
  },
  {
    "id": "mac-solid-colors",
    "label": "Solid Colors",
    "group": "terminal-app",
    "palette": {
      "black": "#000000",
      "red": "#990000",
      "green": "#00a600",
      "yellow": "#999900",
      "blue": "#0000b2",
      "magenta": "#b200b2",
      "cyan": "#00a6b2",
      "white": "#bfbfbf",
      "brightBlack": "#666666",
      "brightRed": "#e50000",
      "brightGreen": "#00d900",
      "brightYellow": "#e5e500",
      "brightBlue": "#0000ff",
      "brightMagenta": "#e500e5",
      "brightCyan": "#00e5e5",
      "brightWhite": "#e5e5e5",
      "background": "#ffffff",
      "foreground": "#000000",
      "cursor": "#bfbfbf",
      "selectionBackground": "#b2d6ff"
    },
    "profile": {
      "fontSize": 11.0,
      "cursorStyle": "block",
      "cursorBlink": false
    }
  },
];
TERM_THEMES.push(...TERMINAL_APP_THEMES);

// The app's own terminal colours (--term-bg / --term-text in globals.css; keep in
// sync). For previews and the editor's colour fallbacks.
export const VLENS_TERM = { light: { background: "#16140f", foreground: "#e8e2d4" }, dark: { background: "#121110", foreground: "#e8e2d4" } };

export const termThemeById = (id: string | null | undefined) => TERM_THEMES.find((t) => t.id === id) ?? TERM_THEMES[0];

// The chosen profile's background and text colours (light, then dark), saved alongside it, so the
// boot script can set them before the first paint (no flash of the wrong colours).
export const TERM_COLORS_KEY = "lens.termColors";
export const TERM_BOOT_SNIPPET = `try{var tc=JSON.parse(localStorage.getItem("${TERM_COLORS_KEY}")||"null");if(tc){var dk=document.documentElement.dataset.theme==="dark"?2:0,rs=document.documentElement.style;if(tc[dk])rs.setProperty("--term-profile-bg",tc[dk]);if(tc[dk+1])rs.setProperty("--term-profile-text",tc[dk+1])}}catch(e){}`;
