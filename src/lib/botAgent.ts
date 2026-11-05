/* eslint-disable @typescript-eslint/no-explicit-any -- reads the SDK's message stream, same shapes as the CLI's stream-json */
import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSdkMcpServer, query, tool, type CanUseTool, type PermissionResult, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { botArgs, conceptTemplate, deleteConcept, getBot, listConcepts, updateBot, writeConcept } from "./bots";
import { ensureIssue, getIssue, isIssueKey, listIssues, SECTIONS, updateIssue } from "./botIssues";
import { hasSessionAccess, listSessionsText, readMemoryText, readSessionText, searchSessionsText } from "./botSessions";
import { trackRun } from "./lensRuns";
import { recordEvent } from "./limits";
import { settle, waitForDecision } from "./permissions";
import { alwaysLabel } from "./runClaude";
import type { AgentEvent, Block, Bot, RunStatus } from "./types";

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
- You can't change your own permission mode or model; the user does that in your settings.`;

// When you let it read your Claude sessions (its Settings).
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
    const change = async (label: string, preview: string, apply: () => Promise<void>) => {
      const { decision, feedback } = await ask({ tool: label, input: {}, preview, description: null, reason: null, always: null });
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
          return text(JSON.stringify({ name: b.name, avatar: b.avatar, about: b.about, instructions: b.role, rules: b.rules, connectors: { on: b.mcp, available }, style: b.style, mode: b.mode, notes }, null, 2));
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
          return change("Change connectors", [add.length && `Turn on: ${add.join(", ")}`, drop.length && `Turn off: ${drop.join(", ")}`].filter(Boolean).join("\n"), () => updateBot(id, { mcp: a.on }).then(() => {}));
        }),
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
        systemPrompt: { type: "preset", preset: "claude_code", append: SETUP_GUIDE + (hasSessionAccess(this.bot) ? SESSIONS_GUIDE : "") + (issue ? issueGuide(issue, (await getIssue(id, issue))?.file ?? `issues/${issue}.md`) : MAIN_GUIDE) },
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
