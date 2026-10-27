import "server-only";
import os from "node:os";
import { getLimits, probe } from "./limits";
import { listSkills } from "./skills";
import type { SlashCommand } from "./types";

// Short descriptions for the CLI's own commands (skills bring their own).
const BUILT_IN: Record<string, string> = {
  clear: "Start the conversation fresh",
  compact: "Summarize the conversation to free up context",
  context: "Show what's using the context window",
  usage: "Show plan usage and limits",
  model: "Show or switch the model",
  effort: "Set how hard the model thinks",
  fast: "Toggle fast mode",
  init: "Create a CLAUDE.md for this project",
  "security-review": "Review pending changes for security issues",
  "code-review": "Review the current changes for bugs",
  simplify: "Clean up the changed code",
  rename: "Rename this session",
  recap: "Summarize the session so far",
  mcp: "Show MCP server status",
  agents: "Manage sub-agents",
  config: "Show settings",
  "output-style": "Change the output style",
  insights: "Insights about your sessions",
  goal: "Set a goal for the session",
  loop: "Run a prompt on a repeating interval",
  schedule: "Schedule a recurring cloud agent",
  "reload-skills": "Reload skills from disk",
};

const probing = new Map<string, number>(); // folder -> when we last fetched its list

export async function slashCommands(cwd?: string): Promise<SlashCommand[]> {
  const folder = cwd ?? os.homedir();
  const { commands = {} } = await getLimits();
  let names = commands[folder];
  if (!names) {
    // Not seen this folder yet: show the last list we have now, and fetch this
    // folder's own (it can add project commands) in the background.
    if (Date.now() - (probing.get(folder) ?? 0) > 10 * 60_000) {
      probing.set(folder, Date.now());
      void probe(undefined, folder);
    }
    names = Object.values(commands).at(-1) ?? [];
  }

  const skills = await listSkills(cwd).catch(() => []);
  const desc = new Map<string, string>();
  for (const s of skills) {
    desc.set(s.name, s.description);
    desc.set(s.name.split(":").pop()!, s.description); // synced skills show up as "plugin:name"
  }
  return names.map((name) => {
    const d = desc.get(name) ?? desc.get(name.split(":").pop()!);
    return { name, description: d ?? BUILT_IN[name] ?? "", kind: d ? "skill" : "command" };
  });
}
