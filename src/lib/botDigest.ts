import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { botArgs, commitBot, getBot, updateBot } from "./bots";
import { runClaudeOnce } from "./runClaude";
import { getSession, listSessions } from "./sessions";
import type { Block } from "./types";

// "Digest": the bot learns what's new from its sources and writes it into its
// knowledge (the OKF bundle). Only what changed since the last digest is read
// (each source keeps a cursor), and Claude merges it into the concept files
// that are already there, so the bundle grows by topic, not by day.
//
// Vlens hands Claude a short text of each new session (what you asked, what it
// answered; tool output left out) in inbox/, rather than access to every
// transcript on this Mac. The inbox is deleted afterwards.

const MAX_SESSIONS = 12;
const PER_SESSION = 4000; // characters

const text = (blocks: Block[]) => blocks.map((b) => (b.kind === "text" ? b.text : "")).join("\n").trim();

function shorten(t: string, max: number) {
  return t.length <= max ? t : `${t.slice(0, max * 0.35)}\n[…]\n${t.slice(-max * 0.65)}`;
}

const inFolder = (cwd: string | null, folders: string[]) => !!cwd && folders.some((f) => cwd === f || cwd.startsWith(f + "/"));

export async function digestBot(id: string): Promise<{ ok: boolean; summary: string }> {
  const b = await getBot(id);
  if (!b) throw new Error("Bot not found.");
  const since = b.cursor.sessions ?? "";
  const fresh = (await listSessions())
    .filter((s) => !s.botId && inFolder(s.cwd, b.sources.sessionFolders) && s.updatedAt > since)
    .sort((x, y) => x.updatedAt.localeCompare(y.updatedAt))
    .slice(0, MAX_SESSIONS);
  if (!fresh.length) {
    const summary = b.sources.sessionFolders.length ? "Nothing new since the last digest." : "No sources yet. Pick some under Sources.";
    await updateBot(id, { lastDigest: { at: new Date().toISOString(), ok: true, summary } });
    return { ok: true, summary };
  }

  // The new sessions, as short notes, in the bot's inbox.
  const parts: string[] = [];
  for (const s of fresh) {
    const d = await getSession(s.id);
    if (!d) continue;
    const convo = d.messages
      .map((m) => (m.role === "user" ? `**You:** ${text(m.blocks)}` : `**Claude:** ${text(m.blocks)}`))
      .filter((l) => !/^\*\*\w+:\*\* $/.test(l))
      .join("\n\n");
    parts.push(`## Session ${s.id}\n- title: ${s.title}\n- folder: ${s.cwd}\n- updated: ${s.updatedAt}\n\n${shorten(convo, PER_SESSION)}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const inbox = path.join(b.dir, "inbox", `${stamp}.md`);
  await fs.mkdir(path.dirname(inbox), { recursive: true });
  await fs.writeFile(inbox, parts.join("\n\n---\n\n") || "(no new sessions)");

  const prompt = [
    `Update your knowledge (the OKF bundle in knowledge/) with what's new.`,
    `New Claude sessions are summarized in ${path.relative(b.dir, inbox)}.`,
    ``,
    `Rules:`,
    `- One concept per file, in folders like decisions/, topics/, projects/, people/, playbooks/. Path names are short and lowercase-with-dashes.`,
    `- Every file starts with YAML frontmatter: type, title, sources (session ids, PR urls), updated (today's date).`,
    `- Add to the file that already covers a concept instead of making a new one. Keep files short: facts, decisions and why, open questions.`,
    `- Keep what lasts (decisions, how things work, who owns what). Skip chit-chat and one-off steps.`,
    `- Never copy secrets, tokens, passwords or keys.`,
    `- Only write inside knowledge/. Vlens updates the index in CLAUDE.md for you.`,
    `- End with 2-3 lines saying what you added or changed.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const r = await runClaudeOnce({
    prompt,
    cwd: b.dir,
    timeoutMs: 15 * 60_000,
    args: [
      "--no-session-persistence",
      "--permission-mode", "acceptEdits",
      "--allowedTools", "Read,Write,Edit,Glob,Grep",
      ...(b.model ? ["--model", b.model] : []),
      ...(await botArgs(b)),
    ],
  });
  await fs.rm(inbox, { force: true });

  const at = new Date().toISOString();
  const summary = r.ok ? r.text.trim().slice(0, 600) || "Done." : `Digest failed: ${r.error ?? "unknown error"}`;
  await updateBot(id, {
    lastDigest: { at, ok: r.ok, summary },
    ...(r.ok ? { cursor: { sessions: fresh.at(-1)?.updatedAt ?? b.cursor.sessions } } : {}),
  });
  if (r.ok) await commitBot(id, `Digest ${at.slice(0, 16).replace("T", " ")}`);
  return { ok: r.ok, summary };
}
