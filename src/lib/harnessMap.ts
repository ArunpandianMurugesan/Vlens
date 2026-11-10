import yaml from "js-yaml";
import { ABILITIES } from "./botAbilities";
import type { BotFile, BotFiles } from "./botFile";

// Moving a bot between Vlens and the dev-agent-harness. Both are an agent
// definition plus a playbook, but they run in different places: a Vlens bot on
// this Mac as you, a harness agent in the cloud as vendasta-dev-agent[bot]. So
// what maps is copied, and what doesn't is listed in plain words. Pure.

export interface HarnessAgent {
  name: string;
  description?: string;
  card?: { summary?: string; job?: string; leaves?: string };
  model?: string;
  effort?: string;
  playbook?: string;
  repos?: string[];
  allowedTools?: string[];
  tools?: unknown[];
  schedule?: { type: "daily"; hour: number; minute: number; days?: string[] } | { type: "interval"; seconds: number } | null;
  on?: Record<string, unknown>[];
}

const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const pad = (n: number) => String(n).padStart(2, "0");
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// A UTC time of day (and its days) as local, and back: harness schedules are UTC.
function shift(hour: number, minute: number, days: string[] | undefined, toLocal: boolean, now = new Date()) {
  const off = -now.getTimezoneOffset(); // minutes local is ahead of UTC
  let t = hour * 60 + minute + (toLocal ? off : -off);
  let dayShift = 0;
  while (t < 0) {
    t += 1440;
    dayShift--;
  }
  while (t >= 1440) {
    t -= 1440;
    dayShift++;
  }
  const d = days?.map((x) => DAYS[(DAYS.indexOf(x) + dayShift + 7) % 7]);
  return { hour: Math.floor(t / 60), minute: t % 60, days: d };
}

const modelAlias = (m: string | undefined) => (!m ? "" : /opus/.test(m) ? "opus" : /sonnet/.test(m) ? "sonnet" : /haiku/.test(m) ? "haiku" : /fable/.test(m) ? "fable" : "");

// ── Harness → Vlens ──────────────────────────────────────────────────────────

export function fromHarness(a: HarnessAgent): { files: BotFiles; notes: string[] } {
  const notes: string[] = [];
  const on: Record<string, unknown>[] = [];
  for (const sel of a.on ?? []) {
    const src = String(sel.source);
    const events = strs(sel.events);
    const repos = strs(sel.repos);
    const exact = repos.filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r) && !r.endsWith("/*"));
    if (repos.some((r) => r.endsWith("/*"))) notes.push(`A GitHub trigger watched a whole org (${repos.filter((r) => r.endsWith("/*")).join(", ")}). Vlens watches named repos, so add the ones you care about.`);
    if (src === "github") {
      if (events.some((e) => /^pull_request\.(opened|synchronize|ready_for_review|reopened)$/.test(e)) && exact.length) on.push({ name: `PRs in ${exact.length === 1 ? exact[0].split("/")[1] : `${exact.length} repos`}`, source: "github.pr_updated", paused: true, repos: exact.join(", ") });
      else if (events.includes("pull_request.review_requested")) on.push({ name: "review requests", source: "github.review_requested", paused: true, ...(exact.length ? { repos: exact.join(", ") } : {}) });
      else if (events.some((e) => e.startsWith("check_suite") || e.startsWith("check_run"))) on.push({ name: "failing CI", source: "github.ci_failed", paused: true, ...(exact.length ? { repos: exact.join(", ") } : {}) });
      else if (events.some((e) => e.startsWith("pull_request_review")) && strs(sel.reviewStates).includes("changes_requested")) on.push({ name: "changes requested", source: "github.changes_requested", paused: true, ...(exact.length ? { repos: exact.join(", ") } : {}) });
      else notes.push(`GitHub events ${events.join(", ")} have no Vlens trigger yet: it can't wake on those.`);
      if (strs(sel.excludeAuthors).length || sel.excludeTitle || strs(sel.excludeLabels).length) notes.push("Its GitHub filters (authors, labels, titles to skip) don't carry over. Add a gate command or say so in the playbook.");
    } else if (src === "jira") {
      const projects = strs(sel.projects);
      const parts = [`project in (${projects.join(", ")})`];
      if (strs(sel.statuses).length) parts.push(`status in (${strs(sel.statuses).map((s) => `"${s}"`).join(", ")})`);
      if (strs(sel.labels).length) parts.push(`labels in (${strs(sel.labels).map((s) => `"${s}"`).join(", ")})`);
      if (strs(sel.issueTypes).length) parts.push(`issuetype in (${strs(sel.issueTypes).map((s) => `"${s}"`).join(", ")})`);
      on.push({ name: `Jira ${projects.join(", ")}`, source: "jira.search", paused: true, jql: `${parts.join(" AND ")} ORDER BY updated DESC` });
      notes.push("Its Jira trigger became a search checked every 15 minutes, not an event: it wakes on updated tickets, not on each comment.");
    } else if (src === "run") {
      const agents = strs(sel.agents);
      on.push({ name: agents.length ? `${agents[0]} runs` : "harness runs", source: "harness.run_finished", paused: true, ...(agents.length === 1 ? { agent: agents[0] } : {}) });
      notes.push("It woke when other harness runs finished. In Vlens that only sees runs you started.");
    } else notes.push(`Its ${src} trigger has no Vlens trigger: it can't wake on that.`);
  }
  if (a.schedule?.type === "daily") {
    const l = shift(a.schedule.hour, a.schedule.minute, a.schedule.days, true);
    on.push({ name: "daily", source: "time", paused: true, at: `${pad(l.hour)}:${pad(l.minute)}`, ...(l.days?.length ? { days: l.days.join(", ") } : {}) });
  } else if (a.schedule?.type === "interval") notes.push(`It ran every ${Math.round(a.schedule.seconds / 60)} minutes. Vlens runs on a time of day or when something changes, so pick a trigger.`);

  // Harness selectors are often one per team (each with its own runAs); here one trigger per kind is enough.
  const merged: Record<string, unknown>[] = [];
  for (const t of on) {
    const same = t.source !== "jira.search" && t.source !== "time" && merged.find((m) => m.source === t.source && (m.agent ?? "") === (t.agent ?? ""));
    if (!same) merged.push({ ...t });
    else if (t.repos) same.repos = [...new Set([...String(same.repos ?? "").split(", "), ...String(t.repos).split(", ")].filter(Boolean))].join(", ");
  }
  for (const m of merged)
    if (m.source === "github.pr_updated") {
      const n = String(m.repos).split(", ").length;
      m.name = n === 1 ? `PRs in ${String(m.repos).split("/")[1]}` : `PRs in ${n} repos`;
    }
  on.splice(0, on.length, ...merged);
  const needsHarness = on.some((t) => t.source === "jira.search" || t.source === "harness.run_finished");
  const doc: Record<string, unknown> = {
    name: a.name,
    avatar: a.name.slice(0, 1).toUpperCase(),
    about: (a.card?.summary || a.description || `Imported from the harness agent ${a.name}`).slice(0, 200),
    ...(modelAlias(a.model) ? { model: modelAlias(a.model) } : {}),
    ...(a.effort && ["low", "medium", "high", "xhigh", "max"].includes(a.effort) ? { effort: a.effort } : {}),
    connectors: needsHarness ? ["dev-agent-harness"] : [],
    // It starts careful here: it acts as you, so anything that posts or changes asks first.
    may: Object.fromEntries(ABILITIES.filter((x) => !x.when || (needsHarness && x.id.startsWith("harness"))).map((x) => [x.label, x.risky ? "ask me" : "on its own"])),
    knows: { brain: "off", sessions: "off", skills: "all" },
    on,
  };
  if (a.allowedTools?.length) notes.push(`Its tools (${a.allowedTools.join(", ")}) aren't copied: here it starts careful and asks before posting, pushing or changing files.`);
  if (a.repos?.length) notes.push(`It cloned ${a.repos.join(", ")} for each run. Here it works in your local clones, so say where they are in its playbook.`);
  notes.push("It runs on this Mac as you (your gh and connectors), not as vendasta-dev-agent[bot], and only while Vlens is open. Every trigger starts paused: switch on the ones you want.");

  const agent = `# ${a.name}: imported from the dev-agent-harness. What it does is in PLAYBOOK.md.\n\n` + yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"' }).replace(/^"on":/m, "on:").replace(/: "(off|on)"$/gm, ": $1");
  // Its playbook's own top heading goes: Vlens adds the name.
  const body = (a.playbook ?? "").replace(/^#\s+.*\n+/, "").trim();
  const playbook = `# ${a.name}\n\n> Imported from the harness agent \`${a.name}\`. It now runs on this Mac as you.\n\n${body || "Describe how it does its job."}\n\n## Where it looks\n- ${a.repos?.length ? `The repos ${a.repos.join(", ")}` : "What its trigger hands it"}\n\n## What it does\n- ${a.card?.summary || a.description?.slice(0, 160) || "Its job, as the playbook says"}\n`;
  return { files: { agent, playbook }, notes: [...new Set(notes)] };
}

// ── Vlens → harness ──────────────────────────────────────────────────────────

// The harness takes full model ids.
const FULL_MODEL: Record<string, string> = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5", fable: "claude-fable-5-1" };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "my-agent";

export function toHarness(f: BotFile, o: { login?: string | null } = {}): { agent: string; playbook: string; notes: string[] } {
  const notes: string[] = [];
  const on: Record<string, unknown>[] = [];
  let schedule: Record<string, unknown> | undefined;
  const reposOf = (t: BotFile["when"][number]) => (t.params.repos ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  for (const t of f.when) {
    const repos = reposOf(t);
    const needRepos = (what: string) => {
      if (repos.length) return true;
      notes.push(`"${t.name}" (${what}) needs repos: a harness GitHub trigger must name them. Add repos to it first.`);
      return false;
    };
    switch (t.source) {
      case "github.pr_updated":
        if (needRepos("PRs in repos")) on.push({ source: "github", events: ["pull_request.opened", "pull_request.ready_for_review", "pull_request.synchronize"], repos, drafts: false });
        break;
      case "github.review_requested":
        if (needRepos("review requests")) on.push({ source: "github", events: ["pull_request.review_requested"], repos, ...(o.login ? { reviewers: [o.login] } : {}) });
        break;
      case "github.ci_failed":
        if (needRepos("failing CI")) on.push({ source: "github", events: ["check_suite.completed"], repos, conclusions: ["failure", "timed_out"], ...(o.login ? { authors: [o.login] } : {}) });
        break;
      case "github.changes_requested":
        if (needRepos("changes requested")) on.push({ source: "github", events: ["pull_request_review.submitted"], repos, reviewStates: ["changes_requested"], ...(o.login ? { authors: [o.login] } : {}) });
        break;
      case "github.mentioned":
        if (needRepos("mentions")) on.push({ source: "github", events: ["issue_comment.created", "pull_request_review_comment.created"], repos, ...(o.login ? { bodyMatch: `@${o.login}\\b` } : {}) });
        break;
      case "harness.run_finished":
        on.push({ source: "run", statuses: ["succeeded", "failed", "cancelled"], ...(t.params.agent ? { agents: [t.params.agent] } : {}) });
        break;
      case "time": {
        const [h, m] = (t.params.at ?? "09:00").split(":").map(Number);
        const days = (t.params.days ?? "").split(",").map((d) => d.trim().toLowerCase().slice(0, 3)).filter(Boolean);
        const u = shift(h, m, days.length ? days : undefined, false);
        if (schedule) notes.push(`"${t.name}": a harness agent has one schedule, so only the first time trigger carried over.`);
        else schedule = { type: "daily", hour: u.hour, minute: u.minute, ...(u.days ? { days: u.days } : {}) };
        break;
      }
      case "jira.search":
        notes.push(`"${t.name}" is a Jira search. A harness Jira trigger is an event on projects: pick the projects and events (e.g. jira:issue_updated) yourself.`);
        break;
      default:
        notes.push(`"${t.name}" (${t.source}) watches something only this Mac has (your sessions, your Gmail, or a local command), so it doesn't carry over.`);
    }
    if (t.gate.trim()) notes.push(`"${t.name}" has a gate command: in the harness that's a trigger.sh next to agent.yaml.`);
  }
  if (f.brain !== "off") notes.push("It uses the Vlens brain. Harness runs have no memory between runs: what the next run needs must live in the PR, ticket or playbook.");
  if (f.sessions) notes.push("It reads your Claude sessions. Harness runs can't see them.");
  if (f.limits.quietHours || f.limits.weekdaysOnly || f.limits.maxRunsPerDay) notes.push("Quiet hours and run limits don't carry over: harness runs wake on every matching event (it dedupes per PR head).");
  notes.push("A harness agent posts as vendasta-dev-agent[bot] and bills your Claude seat. Its playbook goes in a Confluence page (playbookPageUrl) when you store it with upsert_agent, or in PLAYBOOK.md for a toolkit PR.");

  const doc: Record<string, unknown> = {
    name: slug(f.name),
    description: f.about || f.name,
    card: { summary: (f.about || f.name).slice(0, 80), job: "review", leaves: "comment" },
    ...(f.model ? { model: FULL_MODEL[f.model] ?? f.model } : {}),
    ...(f.effort && f.effort !== "max" ? { effort: f.effort } : {}),
    ...(schedule ? { schedule } : {}),
    ...(on.length ? { on } : {}),
  };
  if (!on.length && !schedule) notes.push("Nothing wakes it on its own there: it only runs when you submit_run it.");
  notes.push('Check card.job and card.leaves: they were guessed as "review" and "comment".');
  const agent = `# ${slug(f.name)}: exported from Vlens. Review before storing it.\n` + yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"' }).replace(/^"on":/m, "on:");
  const lists = [f.think.length && `## Where to look\n${f.think.map((x) => `- ${x}`).join("\n")}`, f.act.length && `## What to do\n${f.act.map((x) => `- ${x}`).join("\n")}`].filter(Boolean).join("\n\n");
  const playbook = `# ${slug(f.name)}\n\n${f.operations.trim()}\n\n${lists}\n`.replace(/\n{3,}/g, "\n\n");
  return { agent, playbook, notes: [...new Set(notes)] };
}
