"use client";

import { ArrowLeft, Bot as BotIcon, Loader2, MessageSquare, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ABILITIES } from "@/lib/botAbilities";
import { type BotFiles, readBotFiles, writeBotFiles } from "@/lib/botFile";
import { commandFor } from "@/lib/botTriggers";
import type { Bot, BotTrigger } from "@/lib/types";
import { type FileCheck, FilesEditor, FileView, Review } from "./BotFileView";
import { FolderChip } from "./FolderChip";

// Create a bot (design: "Bots, from scratch" → BotCreate). A bot is one file
// (bot.md, lib/botFile.ts): pick a recipe ("WHEN … / DO …") and it's filled in, or
// describe it in your own words and Claude drafts it. The preview shows the file as a
// page, the apps it needs, and its checks tried once; Create builds the bot from it.
// It starts careful: it drafts and asks before it posts, sends or changes anything.

type App = "github" | "jira" | "slack" | "gmail" | "sessions";
interface Recipe {
  id: string;
  name: string;
  avatar: string;
  when: string; // the card
  then: string;
  job: { when: string; think: string; act: string }; // the preview, and its starting job
  apps: App[];
  role: string; // its playbook
  trigger?: Partial<BotTrigger>; // ready-made when Vlens can check it with a command
  needsFolder?: boolean; // a session trigger: you pick the folder
  brain?: "read" | "remember"; // the Vlens brain: most read it; ones that learn also remember
}

// Reading is on by default; anything that posts, merges, pushes or edits asks.
const careful = {
  allowTools: ABILITIES.find((a) => a.id === "gh-read")!.rules,
  askTools: ABILITIES.filter((a) => a.risky && a.id !== "harness-runs").flatMap((a) => a.rules),
};

const RECIPES: Recipe[] = [
  {
    id: "ticket",
    name: "Ticket planner",
    avatar: "T",
    when: "A Jira ticket is assigned to me",
    then: "Read it and draft a plan",
    apps: ["jira"],
    job: { when: "When you hand me a ticket, I start on it. Ask me to check your Jira queue regularly.", think: "I read the ticket, its linked pages and the code it touches.", act: "I write a plan in the ticket's card. I ask before commenting on Jira." },
    role: "You plan Jira tickets for the user. For each ticket: read it, its linked Confluence pages and the code it touches, then write a short plan (approach, files, risks, open questions) in the ticket's card. Never comment on Jira or change a ticket without the user's OK.",
  },
  {
    id: "ci",
    name: "CI fixer",
    avatar: "C",
    when: "CI fails on my PR",
    then: "Find the cause and suggest a fix",
    apps: ["github"],
    job: { when: "Every 10 minutes I check CI on your open PRs.", think: "I read the failing logs and the diff to find the cause.", act: "I suggest a fix in the PR's card. I ask before pushing anything." },
    role: "You watch CI on the user's open PRs. When checks fail: read the failing job's logs (gh run view --log-failed) and the diff, find the cause, and write it up with a suggested fix in the PR's card. Never push, comment or re-run anything without the user's OK.",
    trigger: { name: "failing CI", kind: "schedule", source: "github.ci_failed", everyMinutes: 10, list: commandFor("github.ci_failed"), brief: "CI failed on {key}: {title}\n{url}\nFind the cause and suggest a fix." },
  },
  {
    id: "standup",
    name: "Standup writer",
    avatar: "S",
    when: "End of my work day",
    then: "Write a standup note for Slack",
    apps: ["sessions", "slack"],
    job: { when: "When you ask me, at the end of your day.", think: "I read today's Claude sessions and your PRs.", act: "I draft a short standup. I ask before posting to Slack." },
    role: "You write the user's daily standup. Read today's Claude sessions (in the folders you may read) and their open PRs, then draft a short note: done, doing, blocked. Keep it under 8 lines. Never post to Slack without the user's OK.",
  },
  {
    id: "pr",
    name: "PR reviewer",
    avatar: "P",
    when: "A PR asks for my review",
    then: "Review it and draft comments",
    apps: ["github", "jira"],
    job: { when: "Every 15 minutes I look for PRs waiting on your review.", think: "I check the change against its Jira ticket.", act: "I draft review comments. I ask before posting." },
    role: "You review PRs that ask for the user's review. For each: read the description, diff and checks, and the linked Jira ticket's acceptance criteria. Draft review comments in the PR's card. Never post, approve or merge without the user's OK.",
    trigger: { name: "review requests", kind: "schedule", source: "github.review_requested", everyMinutes: 5, list: commandFor("github.review_requested"), brief: "New review request {key}: {title}\n{url}\nReview it and draft comments." },
  },
  {
    id: "coach",
    name: "Session coach",
    avatar: "★",
    when: "One of my Claude sessions ends",
    then: "Save lessons to its notes",
    apps: ["sessions"],
    job: { when: "When a session in the folder you pick ends.", think: "I look for decisions and things that went wrong.", act: "I update my notes. Nothing leaves your Mac." },
    role: "When one of the user's Claude sessions ends, read it and save what's worth remembering to your notes: decisions, gotchas, and things that went wrong and how they were fixed. One note per topic. Nothing leaves this Mac.",
    trigger: { name: "session ended", kind: "session", source: "session.ended", event: "ended", match: "", brief: "A session ended: {title}\nRead it and save what's worth remembering to your notes." },
    needsFolder: true,
    brain: "remember",
  },
  {
    id: "inbox",
    name: "Inbox helper",
    avatar: "I",
    when: "An important email arrives",
    then: "Summarise it and draft a reply",
    apps: ["gmail"],
    job: { when: "When you ask me to go through your mail.", think: "I read the thread and related tickets.", act: "I draft a reply. I never send on my own." },
    role: "You help with the user's email. Summarise threads they point you at (or new mail from people they pick), find related tickets, and draft replies. Never send an email; drafts only.",
  },
];

const APP_LABEL: Record<App, string> = { github: "GitHub", jira: "Jira", slack: "Slack", gmail: "Gmail", sessions: "Your Claude sessions" };
type Conn = { name: string; status: string };

const btn = "inline-flex items-center gap-1 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";

export function BotCreate({ onBack, onCreated, recentFolders }: { onBack: () => void; onCreated: (bot: Bot, kickoff: string) => void; recentFolders: string[] }) {
  const [pick, setPick] = useState<number | null>(null);
  const [desc, setDesc] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [imported, setImported] = useState<{ name: string; notes: string[] } | null>(null); // from a harness agent
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [gh, setGh] = useState<boolean | null>(null);
  const [drafted, setDrafted] = useState<BotFiles | null>(null); // from your own words
  const [hand, setHand] = useState<BotFiles | null>(null); // edited by hand
  const [check, setCheck] = useState<FileCheck | null>(null);
  useEffect(() => {
    fetch("/api/mcp")
      .then((r) => r.json())
      .then((d) => setConns(Array.isArray(d) ? d : []))
      .catch(() => setConns([]));
    fetch("/api/setup")
      .then((r) => r.json())
      .then((d) => setGh(!!d.gh?.user))
      .catch(() => setGh(false));
  }, []);
  const r = pick === null ? null : RECIPES[pick];

  // Which of your connectors each app uses: a connected one first.
  const connectorFor = useMemo(() => {
    const find = (re: RegExp) => {
      const all = (conns ?? []).filter((c) => re.test(c.name));
      return all.find((c) => c.status === "connected") ?? all[0] ?? null;
    };
    return (a: App): Conn | null => (a === "jira" ? find(/atlassian|jira|dev-agent-harness/i) : a === "slack" ? find(/slack/i) : a === "gmail" ? find(/gmail/i) : null);
  }, [conns]);
  const appState = (a: App): { ok: boolean; label: string; signIn?: () => void } => {
    if (a === "sessions") return { ok: true, label: "On this Mac" };
    if (a === "github") return gh === null ? { ok: false, label: "Checking…" } : gh ? { ok: true, label: "Connected (gh)" } : { ok: false, label: "Run gh auth login" };
    const c = connectorFor(a);
    if (!conns) return { ok: false, label: "Checking…" };
    if (!c) return { ok: false, label: "No connector yet", signIn: () => window.open("https://claude.ai/settings/connectors", "_blank") };
    if (c.status === "connected") return { ok: true, label: `Connected · ${c.name.replace(/^claude\.ai /, "")}` };
    return { ok: false, label: "Needs sign-in", signIn: () => (c.name.startsWith("claude.ai ") ? window.open("https://claude.ai/settings/connectors", "_blank") : void fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", name: c.name }) })) };
  };

  // A recipe, as its file.
  const recipeFile = useMemo(() => {
    // Only a recipe that uses a connector waits for the list of them (it takes a few seconds).
    if (!r || (!conns && r.apps.some((a) => a === "jira" || a === "slack" || a === "gmail"))) return null;
    const trigger: BotTrigger[] = r.trigger
      ? [{ id: "t1", on: !r.needsFolder || !!folder, gate: "", updateBrief: "", maxNew: 3, everyMinutes: 15, list: "", event: "ended", idleMinutes: 30, folders: r.needsFolder && folder ? [folder] : [], match: "", brief: "", name: r.name, kind: "schedule", ...r.trigger }]
      : [];
    const bot = {
      id: "",
      dir: "",
      createdAt: "",
      name: r.name,
      avatar: r.avatar,
      about: `${r.when} → ${r.then.toLowerCase()}`,
      role: r.role,
      mode: "",
      model: "",
      style: "",
      mcp: r.apps.map((a) => connectorFor(a)).filter((c): c is Conn => !!c).map((c) => c.name),
      triggers: trigger,
      rules: { allowed: [r.job.act], lookAt: [r.job.think], dontLookAt: [] },
      sources: { sessionFolders: [] },
      sessionAccess: r.apps.includes("sessions") && folder ? { all: false, folders: [folder] } : { all: false, folders: [] },
      notify: { digestDone: true, digestFailed: true },
      cursor: {},
      brain: r.brain ?? "read",
      ...(r.brain === "remember" && r.needsFolder && folder ? { brainLearn: { all: false, folders: [folder] } } : {}),
      ...careful,
    } as Bot;
    return writeBotFiles(bot, "");
  }, [r, conns, folder, connectorFor]);
  const text = hand ?? (r ? recipeFile : drafted);
  const parsed = text ? readBotFiles(text).file : null;

  // Check it whenever it changes: what it sets up, its checks tried once.
  useEffect(() => {
    setCheck(null);
    if (!text) return;
    let stop = false;
    const t = setTimeout(() => {
      fetch("/api/bots/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", ...text }) })
        .then((x) => x.json())
        .then((d) => !stop && setCheck(d))
        .catch(() => {});
    }, 400);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [text]);

  const post = async <T,>(body: object): Promise<T> => {
    const res = await fetch("/api/bots/file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? res.statusText);
    return d as T;
  };
  const draft = async () => {
    setBusy("draft");
    setErr(null);
    setPick(null);
    setHand(null);
    setImported(null);
    try {
      setDrafted(await post<BotFiles>({ action: "draft", instruction: desc }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  };
  const create = async () => {
    if (!text) return;
    if (r?.needsFolder && !folder) return setErr("Pick which sessions it watches first.");
    setBusy("create");
    setErr(null);
    try {
      const { bot } = await post<{ bot: Bot }>({ action: "apply", ...text });
      onCreated(
        bot,
        imported && !r
          ? `You were just imported from the dev-agent-harness agent "${imported.name}". You now run on this Mac as me, and every trigger starts paused. Call get_setup, read your PLAYBOOK.md, and tell me in a few lines what you'll do differently here than in the harness (you act as me, ask before posting). Keep your job up to date with set_job.`
          : r
          ? `You were just created from the "${r.name}" recipe: ${r.when.toLowerCase()} → ${r.then.toLowerCase()}. Your setup is in agent.yaml and PLAYBOOK.md. Call get_setup, ask me what you still need to know (repos, people, folders), and keep your job up to date with set_job.`
          : `You were just created from this description: ${desc.trim()}\n\nYour setup is in agent.yaml and PLAYBOOK.md. Call get_setup, ask me anything you still need to know, and keep your job up to date with set_job.`,
      );
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  const step = !text ? 1 : (r?.apps.some((a) => !appState(a).ok) ?? check?.apps.some((a) => a.status !== "connected")) || (r?.needsFolder && !folder) ? 2 : 3;
  const canCreate = !busy && !!text && !!parsed && !(r?.needsFolder && !folder) && !(check && check.errors.length);
  return (
    <div className="flex min-h-0 flex-1">
      <main className="min-w-0 flex-1 space-y-4 overflow-y-auto px-8 py-6 scroll-thin">
        <button onClick={onBack} className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2.5 py-1 text-xs hover:text-accent">
          <ArrowLeft size={13} /> All bots
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-2xl font-semibold">What should your new bot do?</h1>
          <ol aria-label="Steps" className="flex gap-1.5 text-xs">
            {["Pick a job", "Connect apps", "Check its rules"].map((t, i) => (
              <li key={t} aria-current={step === i + 1 ? "step" : undefined} className={`rounded-full px-2.5 py-1 ${step === i + 1 ? "bg-accent font-medium text-white" : step > i + 1 ? "bg-accent-soft text-accent" : "bg-sunken text-muted"}`}>
                {i + 1} {t}
              </li>
            ))}
          </ol>
        </div>
        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-3 focus-within:border-accent">
          <MessageSquare size={16} className="mt-1 shrink-0 text-accent" />
          <label className="sr-only" htmlFor="bot-desc">
            Describe it in your own words
          </label>
          <textarea
            id="bot-desc"
            value={desc}
            rows={2}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && desc.trim().length > 10 && !busy) {
                e.preventDefault();
                void draft();
              }
            }}
            placeholder='Describe it in your own words, e.g. "when a ticket is assigned to me, read it and draft a plan"'
            className="min-w-0 flex-1 resize-none bg-transparent text-sm outline-none"
          />
          <button onClick={() => void draft()} disabled={desc.trim().length <= 10 || !!busy} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
            {busy === "draft" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {busy === "draft" ? "Writing its file…" : "Draft with AI"}
          </button>
        </div>
        <div className="text-xs font-semibold text-muted">Or start from a recipe</div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {RECIPES.map((x, i) => (
            <button
              key={x.id}
              onClick={() => {
                setPick(i);
                setHand(null);
                setImported(null);
              }}
              aria-pressed={pick === i}
              className={`flex flex-col gap-2 rounded-xl p-3.5 text-left ${pick === i ? "border-2 border-accent bg-accent-soft/40" : "border border-line bg-panel hover:border-accent/50"}`}
            >
              <span className="flex gap-2">
                <span className="w-9 shrink-0 pt-px text-[0.6rem] font-bold tracking-wide text-accent">WHEN</span>
                <span className="text-sm leading-snug">{x.when}</span>
              </span>
              <span className="flex gap-2">
                <span className="w-9 shrink-0 pt-px text-[0.6rem] font-bold tracking-wide text-accent">DO</span>
                <span className="text-sm font-semibold leading-snug">{x.then}</span>
              </span>
              <span className="text-[0.7rem] text-muted">{x.apps.map((a) => APP_LABEL[a]).join(" · ")}</span>
            </button>
          ))}
        </div>
        <FromHarness
          busy={busy === "import"}
          onPick={async (name) => {
            setBusy("import");
            setErr(null);
            setPick(null);
            setHand(null);
            try {
              const d = await fetch(`/api/harness/agents/${name}`).then((r) => r.json());
              if (d.error) throw new Error(d.error);
              setDrafted({ agent: d.agent, playbook: d.playbook });
              setImported({ name, notes: d.notes ?? [] });
            } catch (e) {
              setErr((e as Error).message);
            }
            setBusy(null);
          }}
        />
      </main>

      <aside aria-label="Preview" className="flex w-[26rem] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-sunken/40 p-5 scroll-thin">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
            <BotIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[0.7rem] text-muted">Here&apos;s what I&apos;ll set up</div>
            <div className="truncate text-base font-semibold">{parsed?.name || "Pick a recipe, or describe it"}</div>
          </div>
          {text && (
            <button onClick={() => setHand(hand === null ? text : null)} className={btn}>
              {hand === null ? "Edit files" : "Done editing"}
            </button>
          )}
        </div>
        {r && (
          <div className="space-y-2">
            <div className="text-xs font-semibold">Apps it needs</div>
            {r.apps.map((a) => {
              const s = appState(a);
              return (
                <div key={a} className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm">
                    <b className="font-medium">{APP_LABEL[a]}</b> <span className={`text-xs ${s.ok ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}>{s.label}</span>
                  </span>
                  {s.signIn && (
                    <button onClick={s.signIn} className={btn}>
                      Sign in
                    </button>
                  )}
                </div>
              );
            })}
            {r.needsFolder && (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
                <span className="flex-1">Which sessions?</span>
                <FolderChip value={folder} onChange={setFolder} recent={recentFolders} />
              </div>
            )}
          </div>
        )}
        {hand !== null ? (
          <FilesEditor files={hand} onChange={setHand} errors={check?.errors} />
        ) : parsed ? (
          <div className="rounded-xl border border-line bg-panel p-3.5">
            <FileView file={parsed} />
          </div>
        ) : (
          <p className="text-[0.8rem] leading-relaxed text-muted">A bot is two files, like a harness agent: agent.yaml (when it works and what it may do) and PLAYBOOK.md (what it does). Pick a recipe and it&apos;s filled in, or describe it and Claude drafts it. You can read and change it before anything is created.</p>
        )}
        <div className="space-y-1">
          <div className="text-xs font-semibold">It starts careful</div>
          <p className="text-[0.8rem] leading-relaxed text-muted">Drafts only. It asks you before it posts, sends or changes anything. You can give it more later by telling it in chat.</p>
        </div>
        {imported && !r && drafted && (
          <div className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[0.75rem]">
            <div className="font-semibold">From the harness agent {imported.name}: what changes here</div>
            <ul className="list-disc space-y-0.5 pl-4 text-muted">
              {imported.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {err && <p className="text-xs text-red-600">{err}</p>}
        {text && check ? (
          <Review check={check} busy={busy === "create"} onApply={() => void create()} onDiscard={() => (setPick(null), setDrafted(null), setHand(null))} applyLabel={`Create ${parsed?.name || "bot"}`} />
        ) : (
          <button onClick={() => void create()} disabled={!canCreate} className="flex h-9 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {text ? <Loader2 size={14} className="animate-spin" /> : null}
            {text ? "Checking it…" : "Create bot"}
          </button>
        )}
        <p className="text-[0.7rem] text-muted">Runs while Vlens is open and your Mac is awake.</p>
      </aside>
    </div>
  );
}

// Start from a dev-agent-harness agent (read only): its definition and playbook
// become this bot's files, to review before anything is created.
function FromHarness({ busy, onPick }: { busy: boolean; onPick: (name: string) => void }) {
  const [list, setList] = useState<{ name: string; description: string; shared: boolean }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await fetch("/api/harness/agents").then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setList(d.agents);
    } catch (e) {
      setErr((e as Error).message);
    }
    setLoading(false);
  };
  const shown = (list ?? []).filter((a) => !q.trim() || `${a.name} ${a.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold text-muted">Or start from a harness agent</div>
        {list === null ? (
          <button onClick={() => void load()} disabled={loading} className={btn}>
            {loading && <Loader2 size={12} className="animate-spin" />} {loading ? "Reading the harness…" : "Show harness agents"}
          </button>
        ) : (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter agents" className="ml-auto w-44 rounded-full border border-line bg-bg px-3 py-1 text-xs outline-none focus:border-accent" />
        )}
      </div>
      <p className="text-[0.7rem] text-muted">Its triggers and playbook are copied, and it starts careful: it runs here as you, and every trigger starts paused. Nothing changes in the harness.</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {list && (
        <div className="grid max-h-72 gap-2 overflow-y-auto scroll-thin [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {shown.map((a) => (
            <button key={a.name} onClick={() => onPick(a.name)} disabled={busy} className="flex flex-col gap-1 rounded-xl border border-line bg-panel p-3 text-left hover:border-accent/50 disabled:opacity-50">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-mono text-xs font-semibold">{a.name}</span>
                <span className="ml-auto shrink-0 rounded bg-sunken px-1.5 text-[0.6rem] text-muted">{a.shared ? "shared" : "stored"}</span>
              </span>
              <span className="line-clamp-2 text-[0.75rem] text-muted">{a.description}</span>
            </button>
          ))}
          {!shown.length && <p className="text-xs text-muted">No agents match.</p>}
        </div>
      )}
      {busy && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> Reading the agent and its playbook…
        </p>
      )}
    </section>
  );
}
