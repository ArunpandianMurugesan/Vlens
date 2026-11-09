import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const git = (cwd: string, args: string[]) =>
  new Promise<string | null>((resolve) => execFile("git", ["-C", cwd, ...args], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (e, out) => resolve(e ? null : String(out))));

// The files this session edited (from its Edit and Write calls), with what git
// says changed in each since the last commit: the inspector's "Files changed".
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await (await getProvider()).findSessionFile(id);
  if (!f) return Response.json({ files: [] });
  const text = await fs.readFile(f.file, "utf8").catch(() => "");
  let cwd: string | null = null;
  const touched = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.includes('"tool_use"') && !(cwd === null && line.includes('"cwd"'))) continue;
    let ev: { cwd?: string; message?: { content?: unknown } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof ev.cwd === "string") cwd = ev.cwd;
    const parts = Array.isArray(ev.message?.content) ? (ev.message!.content as { type?: string; name?: string; input?: { file_path?: string; notebook_path?: string } }[]) : [];
    for (const p of parts) if (p.type === "tool_use" && EDITS.has(String(p.name))) {
      const fp = p.input?.file_path ?? p.input?.notebook_path;
      if (typeof fp === "string") touched.add(fp);
    }
  }
  if (!touched.size || !cwd) return Response.json({ files: [], cwd });
  const top = (await git(cwd, ["rev-parse", "--show-toplevel"]))?.trim() ?? null;
  const stat = new Map<string, { add: number; del: number }>();
  const untracked = new Set<string>();
  if (top) {
    for (const l of ((await git(top, ["diff", "--numstat", "HEAD"])) ?? "").split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l);
      if (m) stat.set(path.join(top, m[3]), { add: Number(m[1]) || 0, del: Number(m[2]) || 0 });
    }
    for (const l of ((await git(top, ["ls-files", "--others", "--exclude-standard"])) ?? "").split("\n")) if (l) untracked.add(path.join(top, l));
  }
  const files = [...touched].slice(-200).map((abs) => {
    const s = stat.get(abs);
    const rel = path.relative(top ?? cwd!, abs);
    return { path: rel.startsWith("..") ? abs : rel, add: s?.add ?? 0, del: s?.del ?? 0, state: s ? "changed" : untracked.has(abs) ? "new" : top ? "committed" : "edited" };
  });
  // Still-uncommitted first, then the rest.
  const rank = { changed: 0, new: 0, edited: 1, committed: 2 } as const;
  files.sort((a, b) => rank[a.state as keyof typeof rank] - rank[b.state as keyof typeof rank] || a.path.localeCompare(b.path));
  return Response.json({ files, cwd, repo: top });
}
