import type { Bot } from "./types";

// "What it may do": plain actions on a bot's page, each On its own / Ask me / Never.
// Underneath, each action is a set of Claude Code permission rules in the bot's
// allowTools / askTools / denyTools (written to its .claude/settings.json). Ask rules
// win over allow rules and deny wins over both, so "Approve a PR" can ask even
// when "Comment or review" runs on its own.

export type Level = "on" | "ask" | "never";

export interface Ability {
  id: string;
  label: string;
  hint: string;
  rules: string[];
  risky?: boolean; // changes something others see (shown first in change cards)
  when?: (b: Bot) => boolean; // only for bots that use this (e.g. a connector)
}

const harness = (b: Bot) => b.mcp.includes("dev-agent-harness");

export const ABILITIES: Ability[] = [
  {
    id: "gh-read",
    label: "Read PRs, diffs and CI results",
    hint: "GitHub, with the gh command",
    rules: ["Bash(gh pr view:*)", "Bash(gh pr diff:*)", "Bash(gh pr checks:*)", "Bash(gh pr list:*)", "Bash(gh search prs:*)", "Bash(gh repo view:*)"],
  },
  { id: "gh-comment", label: "Comment or review on GitHub", hint: "On PRs and issues", rules: ["Bash(gh pr review:*)", "Bash(gh pr comment:*)", "Bash(gh issue comment:*)"], risky: true },
  { id: "gh-approve", label: "Approve a PR", hint: "Marks a PR as approved", rules: ["Bash(gh pr review --approve:*)"], risky: true },
  { id: "gh-merge", label: "Merge or close a PR", hint: "Changes the repo for everyone", rules: ["Bash(gh pr merge:*)", "Bash(gh pr close:*)"], risky: true },
  { id: "git-push", label: "Commit and push code", hint: "Commits and pushes fixes to a branch", rules: ["Bash(git commit:*)", "Bash(git push:*)"], risky: true },
  { id: "edit", label: "Change files on your Mac", hint: "Edits code in your repos", rules: ["Edit", "Write"], risky: true },
  {
    id: "harness-read",
    label: "Read Jira, Confluence and GitHub via the harness",
    hint: "dev-agent-harness connector",
    rules: ["mcp__dev-agent-harness__read_jira", "mcp__dev-agent-harness__read_github", "mcp__dev-agent-harness__read_confluence"],
    when: harness,
  },
  {
    id: "harness-runs",
    label: "Start or change harness runs",
    hint: "Runs in the cloud as vendasta-dev-agent",
    rules: ["mcp__dev-agent-harness__submit_run", "mcp__dev-agent-harness__upsert_agent", "mcp__dev-agent-harness__cancel_run", "mcp__dev-agent-harness__archive_agent"],
    risky: true,
    when: harness,
  },
];

export const LEVELS: { id: Level; label: string }[] = [
  { id: "on", label: "On its own" },
  { id: "ask", label: "Ask me" },
  { id: "never", label: "Never" },
];
const rank: Record<Level, number> = { never: 0, ask: 1, on: 2 };
// Moving up (never → ask → on) gives it more access: that always needs your OK.
export const widens = (from: Level, to: Level) => rank[to] > rank[from];

export const abilitiesFor = (b: Bot) => ABILITIES.filter((a) => !a.when || a.when(b));

export function levelOf(b: Bot, a: Ability): Level {
  const has = (list: string[] | undefined) => a.rules.every((r) => list?.includes(r));
  if (has(b.denyTools)) return "never";
  if (has(b.allowTools) && !a.rules.some((r) => b.askTools?.includes(r))) return "on";
  return "ask";
}

// The bot's three rule lists with this action set to `level`.
export function withLevel(b: Bot, a: Ability, level: Level): Pick<Bot, "allowTools" | "askTools" | "denyTools"> {
  const without = (list: string[] | undefined) => (list ?? []).filter((r) => !a.rules.includes(r));
  const add = (list: string[]) => [...list, ...a.rules];
  return {
    allowTools: level === "on" ? add(without(b.allowTools)) : without(b.allowTools),
    askTools: level === "ask" ? add(without(b.askTools)) : without(b.askTools),
    denyTools: level === "never" ? add(without(b.denyTools)) : without(b.denyTools),
  };
}

export const levelLabel = (l: Level) => LEVELS.find((x) => x.id === l)!.label;

// What a bot's setup change shows in its chat (a "change card"), sent with its
// permission prompt as input.change (lib/botAgent.ts → PermissionCard).
export interface ChangeInfo {
  title?: string; // "Change what it may do"
  what?: string; // the thing that changes, e.g. "Comment or review on GitHub"
  before?: string;
  after?: string;
  widens?: boolean; // gives it more access
  why?: string; // the bot's own words
  rules?: string[]; // the permission rules underneath ("Show the rule")
  items?: { text: string; widens?: boolean }[]; // a whole-file change: each thing that changes
}
