/* eslint-disable @typescript-eslint/no-explicit-any -- reads the SDK's message stream, same shapes as the CLI's stream-json */
import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSdkMcpServer, query, tool, type CanUseTool, type PermissionResult, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { botArgs, conceptTemplate, deleteConcept, getBot, listConcepts, updateBot, writeConcept } from "./bots";
import { ensureIssue, getIssue, isIssueKey, listIssues, SECTIONS, updateIssue } from "./botIssues";
import { hasSessionAccess, listSessionsText, readMemoryText, readSessionText, searchSessionsText } from "./botSessions";
import { trackRun } from "./lensRuns";
import { recordEvent } from "./limits";
import { noteAsk, settle, waitForDecision } from "./permissions";
import { alwaysLabel } from "./runClaude";
import type { AgentEvent, Block, Bot, RunStatus } from "./types";
import { abilitiesFor, type ChangeInfo, levelLabel, levelOf, widens, withLevel } from "./botAbilities";

const appName = (n: string) => n.replace(/^claude\.ai /, "");

// A chat with a bot, run with the Claude Agent SDK instead of a `claude -p`
// process (your own sessions still use that, see runClaude.ts). Same engine and
// the same session files, but the SDK lets the bot have tools of its own: it
// sets itself up from the chat (its profile, rules, connectors, notes), and
// every change waits for your Allow or Deny right there.
//
// Each message is one run that resumes the session, so a change you approved
// (a new rule, a connector) is in effect from the next message on.

type Listener = (e: AgentEvent) => void;
type Ask = Extract<AgentEvent, { type: "permission" }>;
const RULE_LISTS = { allowed: "Allowed", lookAt: "Look at", dontLookAt: "Don't look at" } as const;
type RuleList = keyof typeof RULE_LISTS;

// The same `claude` your sessions use (so both run one version), found on PATH.
function claudePath(): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const p = path.join(dir, "claude");
    if (dir && fs.existsSync(p)) return p;
  }
}

const SETUP_GUIDE = `
# Setting yourself up
You are a bot in Vlens. You can change your own setup with the mcp__bot__* tools: your profile and instructions, your rules (Allowed, Look at, Don't look at), which connectors you use, your writing style, and your notes (your knowledge, in OKF: one Markdown note per topic with YAML frontmatter).
- Call get_setup first whenever the user talks about your setup, so you build on what is there.
- When you are new (no instructions or rules yet), interview the user briefly: what you are for, what you may do, where to look, what is off limits. Then propose the changes, one tool call each.
- Every change asks the user for Allow or Deny in the chat. If they deny, ask what to change instead; don't retry the same thing.
- Changes take effect from the user's next message.
- You can't change your own permission mode or model; the user does that in your settings.
- Your whole setup is the file bot.md in your folder (When, Think, Act, May do, Knows, Off limits, Operations). To change triggers or several things at once, read it and call update_setup_file with the complete new file.
- When the user wants you to do more or less on your own ("let it comment on my PRs", "never merge"), use set_permission. Each change shows the user a card and waits for their OK; never claim a change happened until it's approved.
- Keep "your job, in your own words" current: after any setup change (or if get_setup shows no job), call set_job with when / think / act in plain first-person words.`;

// When you let it read your Claude sessions (its Settings).
// The shared Vlens brain (lib/brain), when its bot.md switches it on.
const BRAIN_GUIDE = (level: "read" | "remember") => `
# The Vlens brain
You can use the shared Vlens brain: long-term memory of the user's work across their Claude sessions and all bots. Search it by meaning with brain_search before you start on something (past decisions, how-tos, who owns what), read a memory in full with brain_read, and follow how things connect with brain_trail (a ticket, PR, repo, person or memory: its story, oldest first, and what it relates to). Say which memory you used. A memory marked "replaced by" is history; prefer the newer one.${
  level === "remember"
    ? `
You may also change it. brain_remember saves something worth keeping for later work: a decision and why, a fact, a how-to, the state of a ticket or PR. One idea per memory, in plain words, with a short title, plus its why, the things it's about (ticket, PR, repo, person, project, file, team), how they relate ("ticket:XPAN-95" implemented by "pr:galaxy#35799"), and links to other memories (supersedes, caused_by, fixes, part_of, relates_to). If a close memory already exists, update it (update_id) instead of adding a near-copy; if a decision changed, add the new one with a supersedes link. brain_forget removes a memory that is wrong or no longer true. Don't save chit-chat, secrets or passwords.`
    : ""
}`;

const SESSIONS_GUIDE = `
# Your user's Claude sessions
You may read the user's Claude Code sessions (terminal, desktop app, Vlens), running or ended, in the folders they allowed, with list_sessions, search_sessions and read_session, and each project's Claude memory files with read_memory. Use them to find what was decided or done before. Read-only. Say which session you got something from (title and id), and cite it as session:<id> in notes.`;

// The bot's main chat orchestrates: each issue or PR gets its own card and thread.
const MAIN_GUIDE = `
# Issues and PRs
When the user asks about specific Jira issues or PRs, call open_issue once per issue (key, title, and a short brief of what to do). Each one gets its own card and thread where it's worked on, with its own memory and approvals. Don't do an issue's work here, and don't repeat a card's details: keep this chat to short summaries and what needs the user. Use list_issues to see the cards and where they stand.`;

// One issue's thread: work on it alone, and keep its OKF note current.
const issueGuide = (key: string, file: string) => `
# This thread: ${key}
You work only on ${key} here. Its memory is knowledge/${file}: call get_context first, every time, and build on it.
Look things up with the tools you have (Jira, Confluence, GitHub, local files).
When something changed (status, a decision, an open question answered, new evidence), call update_context, once per section, with only what you'd need to pick this up next week. Cite sources (jira:${key}, confluence:<page id>, session:<id>, URLs). Never paste raw logs or whole tickets. Timeline: one line per event.
Keep replies short: this thread shows as a card in your main chat.`;

// One bot chat message, start to finish. Shaped like ClaudeProc (sessionId,
// runTurn) so the chat route streams it the same way.
export class BotRun {
  constructor(
    readonly bot: Bot,
    public sessionId: string | null,
    private readonly onSession?: (id: string) => void,
    // issue: this run is that issue's thread (botThreads.ts); askTimeoutMs: how long a question waits.
    private readonly o: { issue?: string; askTimeoutMs?: number } = {},
  ) {}

  async runTurn(content: unknown[], listen: Listener, signal?: AbortSignal): Promise<{ blocks: Block[]; error?: string }> {
    const blocks: Block[] = [];
    const asks = new Set<string>();
    let stderr = "";
    let error: string | undefined;
    let streamed = false;
    const status = (s: RunStatus) => listen({ type: "status", status: s });

    // Ask in the chat and wait for your answer.
    const ask = async (e: Omit<Ask, "type" | "id">) => {
      const id = randomUUID();
      asks.add(id);
      noteAsk({ id, tool: e.tool, input: e.input, preview: e.preview, always: !!e.always, botId: this.bot.id, key: this.o.issue, sessionId: this.sessionId });
      listen({ type: "permission", id, ...e });
      const got = await waitForDecision(id, this.o.askTimeoutMs);
      asks.delete(id);
      const feedback = typeof got === "object" && "deny" in got ? got.deny : null;
      const decision = typeof got === "string" ? got : feedback !== null ? "deny" : "allow";
      listen({ type: "permission_done", id, decision });
      return { decision, feedback, got };
    };
    const no = (feedback: string | null) =>
      feedback ? `The user said no. They said: ${feedback}` : "The user said no. Don't do this; ask what they'd like instead.";

    const canUseTool: CanUseTool = async (name, input, o): Promise<PermissionResult> => {
      // Claude asking you something: your picks go back as the tool's answers.
      if (name === "AskUserQuestion") {
        const { got } = await ask({ tool: name, input, description: null, reason: null, always: null, questions: (input as any).questions ?? [] });
        return typeof got === "object" && "answers" in got
          ? { behavior: "allow", updatedInput: { ...input, answers: got.answers } }
          : { behavior: "deny", message: "The user skipped the question." };
      }
      const { decision, feedback } = await ask({
        tool: o.displayName ?? name,
        input,
        description: o.description ?? null,
        reason: o.decisionReason ?? null,
        always: o.suppressAlwaysAllowRule ? null : alwaysLabel(o.suggestions),
      });
      if (decision === "deny") return { behavior: "deny", message: no(feedback), ...(feedback ? {} : { interrupt: true }) };
      return { behavior: "allow", updatedInput: input, ...(decision === "always" && o.suggestions ? { updatedPermissions: o.suggestions } : {}) };
    };

    // The bot's own setup tools. Reading is free; each change asks first.
    const id = this.bot.id;
    // card: what the change card in the chat shows (before → after, whether it gives it more access).
    const change = async (label: string, preview: string, apply: () => Promise<void>, card?: ChangeInfo) => {
      const { decision, feedback } = await ask({ tool: label, input: { change: { title: label, ...card } }, preview, description: null, reason: null, always: null });
      if (decision === "deny") return text(no(feedback));
      await apply();
      return text(`Done: ${label.toLowerCase()}. It takes effect from the user's next message.`);
    };
    const current = async () => (await getBot(id)) ?? this.bot;
    const issue = this.o.issue;
    // Main chat: open and list cards. A thread: read and update its own issue only.
    const issueTools = issue
      ? [
          tool("get_context", `The memory of ${issue}: its OKF note (status, summary, decisions, open questions, timeline, sources).`, {}, async () => {
            const i = await getIssue(id, issue);
            return text(i ? `knowledge/${i.file}\nstatus: ${i.status}\nsources: ${i.sources.join(", ") || "none"}\nrelated: ${i.related.join(", ") || "none"}\n${i.body}` : "No note yet.");
          }),
          tool(
            "update_context",
            `Save what you learned about ${issue} into one section of its note: ${SECTIONS.join(", ")}, or one of your own (like "Draft review"). mode append adds one line; replace rewrites the section. status: a short word like in-progress, blocked, draft-ready, done.`,
            { section: z.string().min(1).max(40), text: z.string().min(1).max(4000), mode: z.enum(["append", "replace"]), status: z.string().max(40).optional(), sources: z.array(z.string().max(200)).max(20).optional(), related: z.array(z.string().max(200)).max(20).optional() },
            async (a) => {
              const lines = [`${a.section} (${a.mode}): ${a.text}`, a.status && `Status: ${a.status}`, a.sources?.length && `Sources: ${a.sources.join(", ")}`].filter(Boolean);
              // You can let it save its notes without asking (its Settings); publishing anywhere still asks.
              if (this.bot.autoSaveIssues) {
                await updateIssue(id, issue, a);
                return text(`Saved to ${issue}: ${a.section}.`);
              }
              return change(`Update ${issue}`, lines.join("\n"), () => updateIssue(id, issue, a));
            },
          ),
        ]
      : [
          tool("open_issue", "Open a card for one Jira issue or PR and start working on it in its own thread. brief: what to find out or do.", { key: z.string(), title: z.string().max(200), brief: z.string().min(1).max(4000) }, async (a) => {
            if (!isIssueKey(a.key)) return text(`"${a.key}" isn't a key like XPAN-123 or PR-2068.`);
            await ensureIssue(id, a.key, a.title);
            const { runIssue } = await import("./botThreads");
            const r = runIssue(id, a.key, a.brief);
            return text(r.ok ? `Opened the ${a.key} card; it's working in its own thread. Don't work on ${a.key} here.` : r.error);
          }),
          tool("list_issues", "Your issue cards: key, title, status, whether it's working or waiting for the user.", {}, async () => {
            const { threadState } = await import("./botThreads");
            const all = await listIssues(id);
            if (!all.length) return text("No cards yet.");
            return text(all.map((i) => { const s = threadState(id, i.key); return `${i.key} · ${i.title} · ${i.status}${s.running ? " · working" : ""}${s.asks.length ? ` · ${s.asks.length} waiting for the user` : ""}`; }).join("\n"));
          }),
        ];
    const setup = createSdkMcpServer({
      name: "bot",
      version: "1.0.0",
      tools: [
        tool("get_setup", "Your current setup: profile, instructions, rules, connectors (on and available), style, and notes.", {}, async () => {
          const b = await current();
          const { listMcp } = await import("./mcp");
          const available = [...new Set((await listMcp().catch(() => [])).map((s) => s.name))];
          const notes = (await listConcepts(id)).map((c) => ({ path: c.path, title: c.title, type: c.type }));
          return text(JSON.stringify({ name: b.name, avatar: b.avatar, about: b.about, job: b.job ?? null, abilities: abilitiesFor(b).map((x) => ({ id: x.id, what: x.label, level: levelOf(b, x) })), instructions: b.role, rules: b.rules, connectors: { on: b.mcp, available }, style: b.style, mode: b.mode, notes }, null, 2));
        }),
        tool(
          "update_profile",
          "Change your name, avatar (a letter or emoji), one-line description (about) or instructions. Only pass what changes. instructions replaces the whole text.",
          { name: z.string().max(60).optional(), avatar: z.string().max(2).optional(), about: z.string().max(200).optional(), instructions: z.string().max(20_000).optional() },
          async (a) => {
            const lines = [a.name && `Name: ${a.name}`, a.avatar && `Avatar: ${a.avatar}`, a.about && `About: ${a.about}`, a.instructions && `Instructions:\n${a.instructions}`].filter(Boolean);
            if (!lines.length) return text("Nothing to change.");
            return change("Change profile", lines.join("\n"), async () => {
              await updateBot(id, { ...(a.name ? { name: a.name } : {}), ...(a.avatar ? { avatar: a.avatar } : {}), ...(a.about !== undefined ? { about: a.about } : {}), ...(a.instructions !== undefined ? { role: a.instructions } : {}) });
            });
          },
        ),
        tool(
          "add_rule",
          "Add one rule. list: allowed (what you may do), lookAt (where your knowledge comes from), dontLookAt (off limits; folder and file paths here are also blocked for real).",
          { list: z.enum(["allowed", "lookAt", "dontLookAt"]), text: z.string().min(1).max(300) },
          async (a) => {
            const r = (await current()).rules;
            const t = a.text.replace(/\s+/g, " ").trim();
            if (r[a.list].includes(t)) return text("That rule is already there.");
            return change("Add rule", `${RULE_LISTS[a.list as RuleList]}: ${t}`, async () => {
              const now = (await current()).rules;
              await updateBot(id, { rules: { ...now, [a.list]: [...now[a.list as RuleList], t].slice(0, 50) } });
            });
          },
        ),
        tool("remove_rule", "Remove one rule, by its exact text (see get_setup).", { list: z.enum(["allowed", "lookAt", "dontLookAt"]), text: z.string() }, async (a) => {
          if (!(await current()).rules[a.list as RuleList].includes(a.text)) return text("No rule with that exact text. Call get_setup to see them.");
          return change("Remove rule", `${RULE_LISTS[a.list as RuleList]}: ${a.text}`, async () => {
            const now = (await current()).rules;
            await updateBot(id, { rules: { ...now, [a.list]: now[a.list as RuleList].filter((x) => x !== a.text) } });
          });
        }),
        tool("set_connectors", "Choose which connectors (MCP servers) you may use: the full list to have on. Names from get_setup's connectors.available.", { on: z.array(z.string()).max(100) }, async (a) => {
          const { listMcp } = await import("./mcp");
          const available = new Set((await listMcp().catch(() => [])).map((s) => s.name));
          const unknown = a.on.filter((n) => !available.has(n));
          if (unknown.length) return text(`Not connectors you have: ${unknown.join(", ")}. Call get_setup for the names.`);
          const was = (await current()).mcp;
          const add = a.on.filter((n) => !was.includes(n));
          const drop = was.filter((n) => !a.on.includes(n));
          if (!add.length && !drop.length) return text("Nothing to change.");
          return change("Change connectors", [add.length && `Turn on: ${add.join(", ")}`, drop.length && `Turn off: ${drop.join(", ")}`].filter(Boolean).join("\n"), () => updateBot(id, { mcp: a.on }).then(() => {}), {
            title: "Change the apps it uses",
            before: was.map(appName).join(", ") || "None",
            after: a.on.map(appName).join(", ") || "None",
            widens: add.length > 0,
          });
        }),
        tool(
          "set_permission",
          "Change what you may do, when the user asks in plain words (\"let it comment on my PRs without asking\", \"never merge\"). ability: an id from get_setup's abilities. level: on (do it on your own), ask (ask the user each time), never. why: one short sentence in plain words, including any limit you'll keep (\"I'll still ask before commenting on others' PRs\").",
          { ability: z.string(), level: z.enum(["on", "ask", "never"]), why: z.string().max(300) },
          async (a) => {
            const b = await current();
            const ab = abilitiesFor(b).find((x) => x.id === a.ability);
            if (!ab) return text(`No ability "${a.ability}". Call get_setup for the list.`);
            const from = levelOf(b, ab);
            if (from === a.level) return text(`"${ab.label}" is already ${levelLabel(from)}.`);
            return change(
              "Change what it may do",
              `${ab.label}: ${levelLabel(from)} → ${levelLabel(a.level)}\n${a.why}`,
              async () => {
                const now = await current();
                await updateBot(id, withLevel(now, ab, a.level));
              },
              { title: "Change what it may do", what: ab.label, before: levelLabel(from), after: levelLabel(a.level), widens: widens(from, a.level), why: a.why, rules: ab.rules },
            );
          },
        ),
        tool(
          "update_setup_file",
          "Change your setup by rewriting your whole setup file (bot.md in your folder: When, Think, Act, May do, Knows, Off limits, Operations). Use it for triggers (what wakes you up and the check command) or several changes at once. Read bot.md first, change only what the user asked, and pass the complete new file. Vlens checks it, tries new check commands once, and shows the user each change to approve.",
          { text: z.string().min(20).max(60_000), why: z.string().max(300) },
          async (a) => {
            const { checkBotFile, applyBotFile } = await import("./botFileOps");
            const c = await checkBotFile(a.text, id);
            if (c.errors.length) return text(`The file has problems; fix them and try again:\n${c.errors.map((e) => `${e.line ? `line ${e.line}: ` : ""}${e.message}`).join("\n")}`);
            if (!c.changes.length) return text("Nothing would change.");
            const tried = c.runs.map((r) => (r.ok ? `"${r.trigger}" found ${r.found}` : `"${r.trigger}" failed: ${r.error}`)).join("; ");
            return change(
              "Change its setup file",
              [...c.changes.map((x) => `${x.text}${x.widens ? " (more access)" : ""}`), tried && `Checks tried once: ${tried}`].filter(Boolean).join("\n"),
              async () => void (await applyBotFile(a.text, id)),
              { title: "Change its setup", why: [a.why, tried && `Tried once: ${tried}.`].filter(Boolean).join(" "), items: c.changes, widens: c.changes.some((x) => x.widens) },
            );
          },
        ),
        tool(
          "set_job",
          "Describe your job in your own words, in three short first-person sentences the user sees on your page: when (what wakes you up), think (what you look at), act (what you do, and what you ask first). Plain words; no commands or rule syntax. Call it after any setup change, and when it's missing.",
          { when: z.string().min(1).max(300), think: z.string().min(1).max(300), act: z.string().min(1).max(300) },
          async (a) => {
            // Only a description of itself: it saves without asking.
            await updateBot(id, { job: { ...a, updatedAt: new Date().toISOString() } });
            return text("Saved your job summary.");
          },
        ),
        tool("set_style", "Set how you write (your output style), as plain instructions.", { style: z.string().max(20_000) }, async (a) =>
          change("Change writing style", a.style, () => updateBot(id, { style: a.style }).then(() => {})),
        ),
        tool(
          "write_note",
          "Write a note in your knowledge (OKF): one topic per note. path like processes/release.md (folders by type: decisions, processes, people, projects, topics). Replaces the note if it exists. body is Markdown, without frontmatter.",
          { path: z.string().regex(/^[\w./-]+\.md$/), title: z.string().max(200), type: z.string().max(40), body: z.string().max(50_000), sources: z.array(z.string()).max(20).optional() },
          async (a) => {
            if (a.path.startsWith("rules/")) return text("Rules are changed with add_rule and remove_rule.");
            if (a.path.startsWith("issues/")) return text("Issue notes are changed in the issue's own thread, with update_context.");
            const fm = conceptTemplate(a.title, a.type).replace("sources: []", `sources: ${JSON.stringify(a.sources ?? [])}`);
            const note = `${fm}${a.body.trim()}\n`;
            return change("Write note", `knowledge/${a.path}\n\n${a.body.trim().slice(0, 1500)}`, () => writeConcept(id, a.path, note));
          },
        ),
        tool("delete_note", "Delete a note from your knowledge.", { path: z.string() }, async (a) => {
          if (a.path.startsWith("rules/")) return text("Rules are changed with add_rule and remove_rule.");
          return change("Delete note", `knowledge/${a.path}`, () => deleteConcept(id, a.path));
        }),
        ...issueTools,
        ...(hasSessionAccess(this.bot) ? sessionTools(this.bot) : []),
        ...brainTools(this.bot),
      ],
    });

    // One message in; the input stays open until the reply ends (its tools talk over it).
    let finished!: () => void;
    const over = new Promise<void>((r) => (finished = r));
    async function* input(): AsyncGenerator<SDKUserMessage> {
      yield { type: "user", message: { role: "user", content: content as any }, parent_tool_use_id: null } as SDKUserMessage;
      await over;
    }
    const off = await botArgs(this.bot); // ["--disallowedTools", "a,b"] for the connectors it doesn't use
    const env: Record<string, string | undefined> = { ...process.env, CLAUDE_CODE_ENTRYPOINT: "vlens" }; // keeps it in `claude --resume`
    delete env.CLAUDECODE;
    const q = query({
      prompt: input(),
      options: {
        cwd: this.bot.dir,
        ...(this.sessionId ? { resume: this.sessionId } : {}),
        ...(this.bot.model ? { model: this.bot.model } : {}),
        ...(this.bot.effort ? { effort: this.bot.effort } : {}),
        // Its skills (its Settings, Powers): only those you picked; none picked = all of yours.
        ...(Array.isArray(this.bot.skills) ? { skills: this.bot.skills } : {}),
        ...(this.bot.mode ? { permissionMode: this.bot.mode as any } : {}), // none: your Claude Code's own default mode
        pathToClaudeCodeExecutable: claudePath(),
        settingSources: ["user", "project", "local"], // its CLAUDE.md, rules and output style, like a session in its folder
        systemPrompt: { type: "preset", preset: "claude_code", append: SETUP_GUIDE + (hasSessionAccess(this.bot) ? SESSIONS_GUIDE : "") + (this.bot.brain && this.bot.brain !== "off" ? BRAIN_GUIDE(this.bot.brain) : "") + (issue ? issueGuide(issue, (await getIssue(id, issue))?.file ?? `issues/${issue}.md`) : MAIN_GUIDE) },
        includePartialMessages: true,
        mcpServers: { bot: setup },
        allowedTools: ["mcp__bot__*"], // they ask in the chat themselves
        disallowedTools: off.length ? off[1].split(",") : [],
        canUseTool,
        env,
        // Started by us so Vlens knows the process is its own (not the session open in a terminal).
        spawnClaudeCodeProcess: (o) => {
          const child = spawn(o.command, o.args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, signal: o.signal, stdio: ["pipe", "pipe", "pipe"] });
          trackRun(child);
          child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
          child.on("error", () => {}); // reported through the SDK
          return child;
        },
      },
    });
    const stop = () => {
      for (const a of asks) settle(a, "deny");
      void q.interrupt().catch(() => {});
    };
    signal?.addEventListener("abort", stop);

    try {
      for await (const m of q as AsyncIterable<any>) {
        recordEvent(m);
        if (m.session_id && m.session_id !== this.sessionId) {
          this.sessionId = m.session_id;
          listen({ type: "session", claudeSessionId: m.session_id });
          this.onSession?.(m.session_id);
        }
        if (m.type === "result") {
          if (m.is_error && !blocks.some((b) => b.kind === "text")) error = String(m.result || (m.errors ?? []).join("\n") || "The bot didn't finish.");
          break;
        }
        if (m.type === "system" && m.subtype === "status" && m.status === "requesting") status({ kind: "requesting" });
        if (m.parent_tool_use_id) continue; // a sub-agent's own messages
        if (m.type === "stream_event") {
          const ev = m.event;
          const cb = ev?.content_block;
          if (ev?.type === "content_block_start" && cb) {
            if (cb.type === "thinking" || cb.type === "redacted_thinking") status({ kind: "thinking" });
            else if (cb.type === "text") status({ kind: "writing" });
            else if (cb.type === "tool_use") status({ kind: "tool", tool: cb.name });
          }
          if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            streamed = true;
            listen({ type: "delta", text: ev.delta.text });
          }
          continue;
        }
        const parts = m.message?.content;
        if (!Array.isArray(parts)) continue;
        const wasStreamed = streamed;
        streamed = false;
        for (const c of parts) {
          if (m.type === "assistant" && c.type === "text" && c.text) {
            blocks.push({ kind: "text", text: c.text });
            if (!wasStreamed) listen({ type: "delta", text: c.text });
          } else if (m.type === "assistant" && c.type === "tool_use") {
            blocks.push({ kind: "tool_use", id: c.id, name: c.name, input: c.input });
            listen({ type: "tool", id: c.id, name: c.name, input: c.input });
          } else if (m.type === "user" && c.type === "tool_result") {
            const t = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x: any) => x.text ?? "").join("\n") : "";
            blocks.push({ kind: "tool_result", toolUseId: c.tool_use_id, text: t, isError: !!c.is_error });
            listen({ type: "tool_result", toolUseId: c.tool_use_id, text: t, isError: !!c.is_error });
          }
        }
      }
    } catch (e) {
      if (!signal?.aborted) error = stderr.trim().slice(-400) || (e as Error).message;
    } finally {
      signal?.removeEventListener("abort", stop);
      for (const a of asks) settle(a, "deny");
      finished();
      q.close();
    }
    return { blocks, ...(error && !blocks.some((b) => b.kind === "text") ? { error } : {}) };
  }
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

// Reading your Claude sessions and memory files: read-only, only the folders you allowed.
const sessionTools = (b: Bot) => [
  tool("list_sessions", "The user's Claude sessions you may read, newest first: id, title, folder, running or ended, last active.", { folder: z.string().optional(), query: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }, async (a) =>
    text(await listSessionsText(b, a)),
  ),
  tool("search_sessions", "Find a word or phrase (all words must appear) in what was said in the sessions you may read.", { query: z.string().min(1).max(200), folder: z.string().optional(), limit: z.number().int().min(1).max(50).optional() }, async (a) =>
    text(await searchSessionsText(b, a)),
  ),
  tool("read_session", "Read a session's conversation (what was said, which tools were used). last: how many messages (default 40); before: read the ones before this message number.", { id: z.string(), last: z.number().int().min(1).max(200).optional(), before: z.number().int().min(1).optional() }, async (a) =>
    text(await readSessionText(b, a)),
  ),
  tool("read_memory", "Claude Code's memory files for a project folder you may read. No folder: list which folders have them.", { folder: z.string().optional() }, async (a) => text(await readMemoryText(b, a))),
];

// "ticket:XPAN-95 implemented by pr:galaxy#35799" from a bot.
async function relateAll(rels: { from: string; rel: string; to: string }[] | undefined, memory: string) {
  const { relate } = await import("./brain/store");
  const ref = (x: string) => {
    const i = x.indexOf(":");
    const type = x.slice(0, i);
    return i > 0 && ["ticket", "pr", "repo", "person", "project", "file", "team"].includes(type) ? { type: type as "ticket", key: x.slice(i + 1) } : null;
  };
  for (const r of rels ?? []) {
    const a = ref(r.from);
    const b = ref(r.to);
    if (a && b) await relate(a, r.rel, b, memory);
  }
}

// Its brain tools: search and read with "read only", plus remember and forget with
// "read and remember" (its bot.md). Only bots get these; your sessions never do.
function brainTools(bot: Bot) {
  const level = bot.brain ?? "off";
  if (level === "off") return [];
  const by = `bot:${bot.id}`;
  const kinds = ["decision", "fact", "howto", "work", "person", "project"] as const;
  // Its bot.md can limit it to memories from some folders (general ones always count).
  const folders = bot.brainFolders?.length ? bot.brainFolders : null;
  const read = [
    tool(
      "brain_search",
      "Search the Vlens brain by meaning (not exact words): past decisions, facts, how-tos, work items, people, projects from the user's Claude sessions and other bots. Returns the closest memories with their ids.",
      { query: z.string().min(2).max(500), kind: z.enum(kinds).optional(), limit: z.number().int().min(1).max(15).optional() },
      async (a) => {
        const { searchMemories } = await import("./brain/store");
        const hits = await searchMemories(a.query, { kind: a.kind, limit: a.limit ?? 6, folders });
        const good = hits.filter((h) => h.match > 0.35);
        if (!good.length) return text("Nothing in the brain about that yet.");
        const { describe } = await import("./brain/store");
        const out: string[] = [];
        for (const h of good) {
          const d = await describe(h);
          out.push(
            [
              `[${h.id}] (${h.kind}, match ${h.match.toFixed(2)}) ${h.title}${d.supersededBy ? `  — replaced by [${d.supersededBy.id}] ${d.supersededBy.title}` : ""}`,
              h.text.slice(0, 400) + (h.text.length > 400 ? "…" : ""),
              h.why && `Why: ${h.why.slice(0, 200)}`,
              d.things.length && `About: ${d.things.map((t) => t.id).join(", ")}`,
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }
        return text(out.join("\n\n"));
      },
    ),
    tool("brain_read", "Read one memory from the Vlens brain in full: its text, where it came from, and earlier versions.", { id: z.string() }, async (a) => {
      const { getMemory, inFolders } = await import("./brain/store");
      const peek = await getMemory(a.id);
      if (!peek || !inFolders(peek, folders)) return text("No memory with that id.");
      const m = (await getMemory(a.id, { use: true }))!;
      const { describe } = await import("./brain/store");
      const d = await describe(m);
      const src = m.sources.map((x) => `${x.type}${x.id ? ` ${x.id}` : ""}${x.note ? ` (${x.note})` : ""} on ${x.at.slice(0, 10)}`).join("; ");
      return text(
        [
          `${m.title} (${m.kind}, importance ${m.importance})`,
          m.text,
          m.why && `Why: ${m.why}`,
          `When: ${(m.when ?? m.createdAt).slice(0, 10)}${m.folder ? ` · where: ${m.folder}` : ""}${m.branch ? ` (branch ${m.branch})` : ""}`,
          d.things.length && `About: ${d.things.map((t) => t.id).join(", ")}`,
          d.links.length && `Links: ${d.links.map((l) => `${l.rel} [${l.id}] ${l.title}`).join("; ")}`,
          d.supersededBy && `Replaced by: [${d.supersededBy.id}] ${d.supersededBy.title}`,
          `From: ${src}`,
          m.history.length && `Earlier versions: ${m.history.length}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }),
    tool(
      "brain_trail",
      "Follow the connections in the Vlens brain around a thing or a memory: a ticket (XPAN-95), PR (galaxy#35799), repo, person, project, file, or a memory id. Returns its story (memories, oldest first, with why), how it relates to other things, and what's known about those.",
      { start: z.string().min(2).max(200) },
      async (a) => {
        const { trail } = await import("./brain/store");
        const t = await trail(a.start, { folders });
        if (!t) return text(`Nothing in the brain about "${a.start}".`);
        const line = (m: { id: string; title: string; why?: string; when?: string; createdAt: string; supersededBy?: string | null }) =>
          `- ${(m.when ?? m.createdAt).slice(0, 10)} [${m.id}] ${m.title}${m.supersededBy ? " (replaced later)" : ""}${m.why ? ` — why: ${m.why.slice(0, 160)}` : ""}`;
        return text(
          [
            t.thing ? `${t.thing.type} ${t.thing.key}${t.thing.name !== t.thing.key ? ` (${t.thing.name})` : ""}` : `Memory [${t.memory!.id}] ${t.memory!.title}`,
            t.memories.length ? `Story:\n${t.memories.map(line).join("\n")}` : "No memories about it yet.",
            t.relations.length && `Relations:\n${t.relations.map((r) => `- ${r.from?.id} ${r.rel} ${r.to?.id}`).join("\n")}`,
            t.links.length && `Links:\n${t.links.map((l) => `- ${l.rel} [${l.memory.id}] ${l.memory.title}`).join("\n")}`,
            t.near.filter((n) => n.memories.length).length &&
              `Nearby:\n${t.near
                .filter((n) => n.memories.length)
                .map((n) => `${n.thing?.id}:\n${n.memories.map(line).join("\n")}`)
                .join("\n")}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
      },
    ),
  ];
  if (level !== "remember") return read;
  return [
    ...read,
    tool(
      "brain_remember",
      "Save to the Vlens brain, or update a memory (update_id). One idea per memory: title (short) and text (plain words, with the why). kind: decision, fact, howto, work, person, project. importance 0..1 (0.8+ for decisions that matter later).",
      { title: z.string().min(3).max(200), text: z.string().min(5).max(4000), kind: z.enum(kinds), importance: z.number().min(0).max(1).optional(), tags: z.array(z.string().max(40)).max(8).optional(), update_id: z.string().optional(), note: z.string().max(200).optional(), folder: z.string().optional(),
        why: z.string().max(1000).optional(),
        things: z.array(z.object({ type: z.enum(["ticket", "pr", "repo", "person", "project", "file", "team"]), key: z.string().min(1).max(200), name: z.string().max(200).optional() })).max(12).optional(),
        relations: z.array(z.object({ from: z.string(), rel: z.string().max(40), to: z.string() })).max(8).optional(),
        links: z.array(z.object({ id: z.string(), rel: z.enum(["supersedes", "caused_by", "fixes", "part_of", "relates_to"]) })).max(6).optional() },
      async (a) => {
        const { addMemory, getMemory, inFolders, similarTo, updateMemory } = await import("./brain/store");
        const source = { type: "bot" as const, id: bot.id, note: a.note };
        // A folder it tags must be one it may use (or none: a general memory).
        const folder = a.folder?.replace(/^~/, os.homedir()) ?? null;
        if (folder && !inFolders({ folder }, folders)) return text(`You can only use memories from ${folders!.join(", ")}.`);
        if (a.update_id) {
          const cur = await getMemory(a.update_id);
          if (!cur || !inFolders(cur, folders)) return text("No memory with that id.");
          const m = await updateMemory(a.update_id, { title: a.title, text: a.text, kind: a.kind, importance: a.importance, tags: a.tags, why: a.why, things: a.things, links: a.links?.map((l) => ({ to: l.id, rel: l.rel })), by, source });
          await relateAll(a.relations, m.id);
          return text(`Updated [${m.id}] ${m.title}.`);
        }
        const near = (await similarTo(`${a.title}\n${a.text}`, 1, folders))[0];
        if (near && near.match > 0.9) return text(`A very similar memory exists: [${near.id}] ${near.title}. Update it with update_id instead of adding a copy.`);
        const m = await addMemory({ title: a.title, text: a.text, kind: a.kind, importance: a.importance, tags: a.tags, folder, why: a.why, things: a.things, links: a.links?.map((l) => ({ to: l.id, rel: l.rel })), source });
        await relateAll(a.relations, m.id);
        return text(`Saved [${m.id}] ${m.title}.`);
      },
    ),
    tool("brain_forget", "Remove a memory from the Vlens brain that is wrong or no longer true. The user can bring it back.", { id: z.string(), why: z.string().max(300) }, async (a) => {
      const { forgetMemory, getMemory, inFolders } = await import("./brain/store");
      const cur = await getMemory(a.id);
      if (!cur || !inFolders(cur, folders)) return text("No memory with that id.");
      await forgetMemory(a.id, `${by}: ${a.why}`);
      return text("Forgotten.");
    }),
  ];
}
