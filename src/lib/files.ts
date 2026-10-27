import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FileView } from "./types";

// Opening files Claude mentions or edits. Only files under your home folder,
// and never the folders that hold keys and credentials.
const HOME = os.homedir();
const PRIVATE = [".ssh", ".gnupg", ".aws", ".kube", ".docker", path.join("Library", "Keychains"), path.join(".config", "gh"), path.join(".config", "gcloud")];
const PRIVATE_FILE = /(^id_[a-z0-9]+(\.pub)?$|\.pem$|\.p12$|\.key$|^\.netrc$)/i;
const MAX_BYTES = 1.5 * 1024 * 1024;

export function resolvePath(input: string, cwd?: string | null): string {
  let p = input.trim().replace(/^file:\/\//, "");
  p = decodeURI(p);
  if (p === "~" || p.startsWith("~/")) p = path.join(HOME, p.slice(1));
  else if (!path.isAbsolute(p)) p = path.join(cwd && path.isAbsolute(cwd) ? cwd : HOME, p);
  const abs = path.resolve(p);
  const rel = path.relative(HOME, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Lens only opens files inside your home folder.");
  if (PRIVATE.some((d) => rel === d || rel.startsWith(d + path.sep)) || PRIVATE_FILE.test(path.basename(abs)))
    throw new Error("That file is in a private folder (keys or credentials), so Lens won't open it.");
  return abs;
}

const IMAGE: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

// File extension -> Shiki language. Shiki also knows most extensions by name.
const LANG: Record<string, string> = {
  ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx", ".mjs": "js", ".cjs": "js", ".py": "python", ".go": "go",
  ".rs": "rust", ".java": "java", ".kt": "kotlin", ".swift": "swift", ".rb": "ruby", ".php": "php", ".c": "c",
  ".h": "c", ".cpp": "cpp", ".cs": "csharp", ".sh": "bash", ".zsh": "bash", ".bash": "bash", ".json": "json",
  ".jsonl": "json", ".yml": "yaml", ".yaml": "yaml", ".toml": "toml", ".md": "markdown", ".mdx": "mdx", ".html": "html",
  ".css": "css", ".scss": "scss", ".sql": "sql", ".proto": "proto", ".graphql": "graphql", ".dockerfile": "docker",
  ".xml": "xml", ".vue": "vue", ".svelte": "svelte", ".tf": "hcl", ".ini": "ini", ".env": "dotenv",
};
const NAMED: Record<string, string> = { Dockerfile: "docker", Makefile: "make", "go.mod": "go", ".gitignore": "text" };

let shiki: Promise<typeof import("shiki")> | null = null;

async function highlight(code: string, lang: string): Promise<string> {
  const s = await (shiki ??= import("shiki"));
  const use = lang in s.bundledLanguages ? lang : "text";
  return s.codeToHtml(code, {
    lang: use,
    // Both themes at once; CSS picks one to match Lens's light or dark mode.
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    transformers: [{ line: (node, line) => void (node.properties["data-line"] = line) }],
  });
}

export async function readView(input: string, cwd?: string | null): Promise<FileView> {
  const abs = resolvePath(input, cwd);
  const st = await fs.stat(abs).catch(() => null);
  const base = { path: abs, name: path.basename(abs), home: HOME, mtime: st?.mtime.toISOString() ?? null };
  if (!st) return { ...base, kind: "missing" };

  if (st.isDirectory()) {
    const entries = (await fs.readdir(abs, { withFileTypes: true }))
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({ name: e.name, dir: e.isDirectory() }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
      .slice(0, 500);
    return { ...base, kind: "dir", entries };
  }
  const ext = path.extname(abs).toLowerCase();
  if (IMAGE[ext]) return { ...base, kind: "image", size: st.size };
  if (st.size > MAX_BYTES) return { ...base, kind: "too-big", size: st.size };

  const buf = await fs.readFile(abs);
  if (buf.subarray(0, 8000).includes(0)) return { ...base, kind: "binary", size: st.size };
  const text = buf.toString("utf8");
  const lang = NAMED[path.basename(abs)] ?? LANG[ext] ?? (ext.slice(1) || "text");
  return { ...base, kind: "text", size: st.size, lang, text, lines: text.split("\n").length, html: await highlight(text, lang) };
}

export async function rawImage(input: string, cwd?: string | null) {
  const abs = resolvePath(input, cwd);
  const type = IMAGE[path.extname(abs).toLowerCase()];
  if (!type) throw new Error("Not an image.");
  return { data: await fs.readFile(abs), type };
}

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => execFile(cmd, args, { timeout: 15_000 }, (e) => (e ? reject(e) : resolve())));

// Opens the file in VS Code at a line when its `code` command is around, else the default app.
export async function openExternally(input: string, how: "editor" | "finder", line?: number) {
  const abs = resolvePath(input);
  if (how === "finder") return run("open", ["-R", abs]);
  const code = ["/opt/homebrew/bin/code", "/usr/local/bin/code", "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"];
  for (const c of code)
    if (await fs.access(c).then(() => true, () => false)) return run(c, ["-g", line ? `${abs}:${line}` : abs]);
  return run("open", [abs]);
}
