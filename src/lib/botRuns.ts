import "server-only";
import { botArgs, botToolAllow, commitBot, getBot, listConcepts } from "./bots";
import { runClaudeOnce } from "./runClaude";

// One-off runs as a bot, outside its chats: a preview question while you edit
// it, and writing its knowledge with AI. Neither is saved as a session.

const run = async (id: string, prompt: string, allowed: string[], mode: string, timeoutMs: number) => {
  const b = await getBot(id);
  if (!b) throw new Error("Bot not found.");
  return {
    b,
    r: await runClaudeOnce({
      prompt,
      cwd: b.dir,
      timeoutMs,
      args: [
        "--no-session-persistence",
        "--permission-mode", mode,
        "--allowedTools", [...allowed, ...botToolAllow(b)].join(","),
        ...(b.model ? ["--model", b.model] : []),
        ...(await botArgs(b)),
      ],
    }),
  };
};

// "Preview": ask it something as it is now (role, style, knowledge, tools), read only.
export async function tryBot(id: string, prompt: string): Promise<{ ok: boolean; text: string }> {
  const { r } = await run(id, prompt, ["Read", "Glob", "Grep"], "default", 3 * 60_000);
  return r.ok ? { ok: true, text: r.text } : { ok: false, text: r.error ?? "It didn't answer." };
}

// "Write notes with AI": Claude turns what you describe or paste into OKF concept
// files, merging with what's there, and can look things up with the bot's tools.
export async function writeKnowledgeWithAi(id: string, brief: string): Promise<{ ok: boolean; summary: string; added: number }> {
  const before = (await listConcepts(id)).length;
  const prompt = [
    `Write or update your knowledge (the OKF bundle in knowledge/) from this:`,
    ``,
    `"""`,
    brief.slice(0, 60_000),
    `"""`,
    ``,
    `If it names things to look up (a Confluence page, a Jira ticket, a repo, a PR) and you have a tool for it, use the tool and write down what you find.`,
    ``,
    `Rules:`,
    `- One concept per file, in folders like decisions/, topics/, projects/, people/, apis/, playbooks/, glossary/. Short lowercase-with-dashes names.`,
    `- Every file starts with YAML frontmatter: type, title, sources (where it came from: "user", a URL, a ticket), updated (today's date).`,
    `- Add to the file that already covers a concept instead of making a new one. Keep files short and factual.`,
    `- Never copy secrets, tokens, passwords or keys.`,
    `- Only write inside knowledge/. Vlens updates the index in CLAUDE.md for you.`,
    `- End with 2-3 lines saying which files you wrote or changed.`,
  ].join("\n");
  const { r } = await run(id, prompt, ["Read", "Write", "Edit", "Glob", "Grep"], "acceptEdits", 15 * 60_000);
  const added = (await listConcepts(id)).length - before;
  if (r.ok) await commitBot(id, `Write knowledge with AI`);
  return { ok: r.ok, summary: r.ok ? r.text.trim().slice(0, 800) || "Done." : `It couldn't write them: ${r.error ?? "unknown error"}`, added };
}

// The bot.yaml format, for Claude writing a bot's automation.
const SPEC_GUIDE = `bot.yaml (YAML):
connectors: [<MCP server names it may use>]
triggers:
  - id: <short-id>
    title: <what it does, for people>
    on: schedule | session.finished | jira.issue | manual
    run: auto | ask | off            # ask: notify and wait for "Run it"
    playbook: playbooks/<name>.md    # a note in knowledge/ with the steps
    output: draft | notes | notify   # draft: a text for the person to read (a summary, brief, reply…); notes: only to save facts into its own knowledge; notify: just tell them (no model)
    every: <minutes between checks>
    # schedule:
    at: "09:00"
    days: [mon, tue, wed, thu, fri]
    # session.finished:
    folders: [/absolute/path]        # sessions in these folders (none: all)
    # jira.issue (read through dev-agent-harness read_jira, read-only):
    jql: "<JQL>"
values.yaml holds the person's own settings; bot.yaml can point at them with "$name" (e.g. jql: $my_jql).`;

// "Write automation with AI": describe what it should watch and do; Claude writes
// bot.yaml, values.yaml and the playbooks. Kept only if Vlens can read it.
export async function writeAutomationWithAi(id: string, brief: string): Promise<{ ok: boolean; summary: string }> {
  const { readSpec, readSpecFiles, writeSpecFiles } = await import("./botSpec");
  const b = await getBot(id);
  if (!b) throw new Error("Bot not found.");
  const before = await readSpecFiles(b.dir);
  const prompt = [
    `Set up (or change) your automation from this:`,
    `"""`,
    brief.slice(0, 20_000),
    `"""`,
    ``,
    SPEC_GUIDE,
    ``,
    `Edit bot.yaml and values.yaml here (keep comments short), and write each playbook it names as a note in knowledge/playbooks/ (YAML frontmatter: type: playbook, title, sources, updated; then the steps). Put personal things (repos, projects, folders) in values.yaml.`,
    `Prefer run: ask unless the request clearly says to act on its own. Only use triggers and actions listed above; if something asked for isn't possible yet, say so.`,
    `End with 2-4 lines: what it will watch, what it does, what it asks you first.`,
  ].join("\n");
  const r = await runClaudeOnce({
    prompt,
    cwd: b.dir,
    timeoutMs: 10 * 60_000,
    args: ["--no-session-persistence", "--permission-mode", "acceptEdits", "--allowedTools", "Read,Write,Edit,Glob,Grep", ...(b.model ? ["--model", b.model] : [])],
  });
  const spec = await readSpec(b.dir);
  if (!r.ok || spec.error) {
    await writeSpecFiles(b.dir, before).catch(() => {}); // put the old files back
    return { ok: false, summary: r.ok ? `What it wrote doesn't work (${spec.error}), so the old files are back.` : `It couldn't write it: ${r.error}` };
  }
  await commitBot(id, "Write automation with AI");
  return { ok: true, summary: r.text.trim().slice(0, 800) || "Done." };
}
