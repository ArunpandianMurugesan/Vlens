// The ready-made triggers a bot can switch on, grouped by what they read. Each
// one is a free check that runs before any AI (like a harness agent's on: and
// trigger.sh): it finds items, and only a new or changed one wakes the bot.
//
//   github   through the gh CLI, as you: free, every minute or more
//   harness  through the dev-agent-harness connector: a small Haiku call per check,
//            since only Claude can reach a connector (none of them push events)
//   gmail    through the claude.ai Gmail connector: the same, a small Haiku call
//   sessions your Claude sessions on this Mac: free
//   time     a time of day: free
//   command  your own check command (prints one JSON item per line)
//
// Pure: used by the file format, the engine and the page.

export type SourceGroup = "github" | "harness" | "gmail" | "sessions" | "time" | "custom";

export interface SourceParam {
  key: string;
  label: string;
  hint: string;
  placeholder?: string;
  required?: boolean;
}

export interface Source {
  id: string;
  group: SourceGroup;
  label: string; // the switch's line
  hint: string;
  connector?: string; // the bot needs this connector for it
  cost: "free" | "small AI call";
  every: number; // default minutes between checks
  params?: SourceParam[];
  brief: string; // what the bot gets for a new item
  updateBrief?: string; // and for one that changed
}

export const GROUP_LABEL: Record<SourceGroup, string> = { github: "GitHub", harness: "Dev agent harness", gmail: "Gmail", sessions: "Claude sessions", time: "Schedule", custom: "Custom checks" };

const REPOS: SourceParam = { key: "repos", label: "Only these repos", hint: "Comma-separated owner/name. Empty: every repo.", placeholder: "vendasta/galaxy, vendasta/conversation" };

export const SOURCES: Source[] = [
  {
    id: "github.review_requested",
    group: "github",
    label: "Review requested from you",
    hint: "Open PRs that ask for your review. Re-wakes on new commits.",
    cost: "free",
    every: 5,
    params: [REPOS],
    brief: "Your review is requested on {key}: {title}\n{url}\nHead commit {version}.",
    updateBrief: "{key} has new commits (head {version}). Look at what changed since last time.",
  },
  {
    id: "github.changes_requested",
    group: "github",
    label: "Changes requested on your PR",
    hint: "Your open PRs where a reviewer asked for changes.",
    cost: "free",
    every: 5,
    params: [REPOS],
    brief: "A reviewer asked for changes on your PR {key}: {title}\n{url}",
    updateBrief: "{key} moved on (head {version}). Check whether the requested changes are addressed.",
  },
  {
    id: "github.ci_failed",
    group: "github",
    label: "CI failed on your PR",
    hint: "Your open PRs whose checks are failing. Re-wakes on each new commit that fails.",
    cost: "free",
    every: 5,
    params: [REPOS],
    brief: "CI is failing on your PR {key}: {title}\n{url}\nHead commit {version}.",
    updateBrief: "CI is still failing on {key} at head {version}.",
  },
  {
    id: "github.pr_updated",
    group: "github",
    label: "New or updated PR in these repos",
    hint: "Any open, non-draft PR in the repos you list. Re-wakes on each push (like a harness agent on pull_request.opened and synchronize).",
    cost: "free",
    every: 5,
    params: [{ ...REPOS, label: "Repos", hint: "Comma-separated owner/name.", required: true }],
    brief: "PR {key}: {title}\n{url}\nHead commit {version}.",
    updateBrief: "{key} has new commits (head {version}). Look at what changed since last time.",
  },
  {
    id: "github.mentioned",
    group: "github",
    label: "You were mentioned",
    hint: "Open PRs and issues that mention you. Re-wakes when they're updated.",
    cost: "free",
    every: 10,
    params: [REPOS],
    brief: "You were mentioned on {key}: {title}\n{url}",
  },
  {
    id: "harness.run_finished",
    group: "harness",
    label: "A harness run I started finished",
    hint: "Your dev-agent-harness runs that succeeded, failed or were cancelled.",
    connector: "dev-agent-harness",
    cost: "small AI call",
    every: 5,
    params: [{ key: "agent", label: "Only this agent", hint: "A harness agent's name, like pr-review. Empty: every run.", placeholder: "pr-review" }],
    brief: "Harness run {key} ({kind}) finished: {title}\nRead it with get_run and run_summary, and tell me what it found.",
  },
  {
    id: "jira.search",
    group: "harness",
    label: "Jira tickets matching a search",
    hint: "Tickets a JQL search finds, read through the harness. Re-wakes when one is updated.",
    connector: "dev-agent-harness",
    cost: "small AI call",
    every: 15,
    params: [{ key: "jql", label: "JQL", hint: "The search. The harness reads Jira as its own account, so name people and projects.", placeholder: "project = XPAN AND status = \"In Review\"", required: true }],
    brief: "Jira {key}: {title}\n{url}\nRead it with read_jira.",
    updateBrief: "Jira {key} was updated ({version}). Read what changed with read_jira.",
  },
  {
    id: "gmail.search",
    group: "gmail",
    label: "Emails matching a search",
    hint: "Gmail threads a search finds. Re-wakes when a thread gets a new message.",
    connector: "claude.ai Gmail",
    cost: "small AI call",
    every: 10,
    params: [{ key: "query", label: "Gmail search", hint: "Gmail's own search words, like from:, label:, is:unread, newer_than:2d.", placeholder: "is:unread label:inbox newer_than:2d", required: true }],
    brief: "An email thread matches your search: {title}\nThread {key}. Read it with the Gmail tools.",
    updateBrief: "The email thread {title} ({key}) has a new message.",
  },
  {
    id: "session.ended",
    group: "sessions",
    label: "A session ends",
    hint: "One of your Claude sessions in these folders finishes.",
    cost: "free",
    every: 1,
    brief: "A Claude session ended: {title}\nSession {session} in {folder}.",
  },
  {
    id: "session.started",
    group: "sessions",
    label: "A session starts",
    hint: "One of your Claude sessions starts in these folders.",
    cost: "free",
    every: 1,
    brief: "A Claude session started: {title}\nSession {session} in {folder}.",
  },
  {
    id: "session.idle",
    group: "sessions",
    label: "A session goes quiet",
    hint: "One of your Claude sessions in these folders stops for a while.",
    cost: "free",
    every: 1,
    brief: "A Claude session went quiet: {title}\nSession {session} in {folder}.",
  },
  {
    id: "time",
    group: "time",
    label: "At a time of day",
    hint: "Once a day at this time, on the days you pick.",
    cost: "free",
    every: 5,
    params: [
      { key: "at", label: "Time", hint: "24-hour, like 09:00.", placeholder: "09:00", required: true },
      { key: "days", label: "Days", hint: "Comma-separated mon…sun. Empty: every day.", placeholder: "mon, tue, wed, thu, fri" },
    ],
    brief: "It's {title}. Do your scheduled job.",
  },
  {
    id: "command",
    group: "custom",
    label: "Your own check command",
    hint: "A shell command that prints one JSON object per line: {key, title, url, version}.",
    cost: "free",
    every: 15,
    brief: "{key}: {title}\n{url}",
  },
];

export const sourceOf = (id: string | undefined) => SOURCES.find((s) => s.id === (id || "command"));
export const isSessionSource = (id: string | undefined) => !!id?.startsWith("session.");
// Built-in sources the engine checks itself (no command): the time, connectors.
export const isNativeSource = (id: string | undefined) => id === "time" || id === "harness.run_finished" || id === "jira.search" || id === "gmail.search";

// The GitHub ones are ready-made check commands, the same kind you could write.
const ghSearch = (q: string, kind: string, issues = false) =>
  `gh api graphql -f query='{ s: search(query:"${q} archived:false", type:ISSUE, first:30){nodes{... on PullRequest{number title url headRefOid updatedAt repository{name}}${issues ? " ... on Issue{number title url updatedAt repository{name}}" : ""}}} }' --jq '.data.s.nodes[] | {key: "\\(.repository.name)#\\(.number)", title, url, version: ((.headRefOid // .updatedAt)[0:20]), kind: "${kind}"}'`;

const repoFilter = (repos: string | undefined) =>
  (repos ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r))
    .map((r) => ` repo:${r}`)
    .join("");

export function commandFor(id: string, params: Record<string, string> = {}): string {
  const r = repoFilter(params.repos);
  switch (id) {
    case "github.review_requested":
      return ghSearch(`is:pr is:open review-requested:@me${r}`, "review");
    case "github.changes_requested":
      return ghSearch(`is:pr is:open author:@me review:changes_requested${r}`, "mine");
    case "github.ci_failed":
      return ghSearch(`is:pr is:open author:@me status:failure${r}`, "mine");
    case "github.pr_updated":
      return r ? ghSearch(`is:pr is:open draft:false${r}`, "pr") : "";
    case "github.mentioned":
      return ghSearch(`is:open mentions:@me${r}`, "mention", true);
    default:
      return "";
  }
}

// What's wrong with a trigger's settings for this source, if anything.
export function paramErrors(id: string, params: Record<string, string>): string[] {
  const s = sourceOf(id);
  if (!s) return [`"${id}" isn't a trigger source Vlens knows: use one of ${SOURCES.map((x) => x.id).join(", ")}.`];
  const out: string[] = [];
  for (const p of s.params ?? []) if (p.required && !params[p.key]?.trim()) out.push(`${s.label} needs "${p.key}" (${p.hint})`);
  if (id === "time" && params.at && !/^([01]\d|2[0-3]):[0-5]\d$/.test(params.at.trim())) out.push(`"at: ${params.at}" isn't a time like 09:00.`);
  if (id === "time" && params.days && params.days.split(",").some((d) => !DAYS.includes(d.trim().toLowerCase().slice(0, 3)))) out.push(`"days: ${params.days}" should be like mon, tue, wed.`);
  if (params.repos && params.repos.split(",").some((x) => x.trim() && !/^[\w.-]+\/[\w.-]+$/.test(x.trim()))) out.push(`"repos" should be owner/name, like vendasta/galaxy.`);
  return out;
}

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Quiet hours and limits: when the bot's triggers stay asleep.
export interface Limits {
  quietHours?: string; // "20:00-08:00" (may wrap past midnight)
  weekdaysOnly?: boolean;
  maxRunsPerDay?: number;
}

export function asleep(l: Limits | undefined, now = new Date()): string | null {
  if (!l) return null;
  if (l.weekdaysOnly && (now.getDay() === 0 || now.getDay() === 6)) return "weekend";
  const m = l.quietHours?.match(/^(\d\d):(\d\d)-(\d\d):(\d\d)$/);
  if (m) {
    const t = now.getHours() * 60 + now.getMinutes();
    const from = +m[1] * 60 + +m[2];
    const to = +m[3] * 60 + +m[4];
    if (from < to ? t >= from && t < to : t >= from || t < to) return "quiet hours";
  }
  return null;
}

export const QUIET_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
