import "server-only";
import type { StateLabels } from "./autopilotPlan";
import { gh } from "./github";
import { labelChange } from "./prLabels";
import type { PrSummary } from "./types";

// Puts autopilot's state label on a PR on GitHub, from your account (only when you
// switched state labels on). A label the repo doesn't have yet is created first.
const known = new Set<string>(); // "owner/name#label" that exist
const COLOR = { reviewed: "8b5cf6", handed: "f59e0b" };

async function ensureLabel(repo: string, name: string, state: "reviewed" | "handed") {
  const k = `${repo.toLowerCase()}#${name.toLowerCase()}`;
  if (known.has(k)) return;
  const r = await gh(["label", "create", name, "--repo", repo, "--color", COLOR[state], "--description", state === "reviewed" ? "Reviewed by Vlens autopilot" : "Vlens autopilot handed this to a person"]);
  if (!r.ok && !/already exists/i.test(r.err)) throw new Error(r.err.slice(0, 200) || "Couldn't create the label.");
  known.add(k);
}

// Returns what it did, or null when nothing needed doing. Throws on a GitHub error.
export async function setStateLabel(pr: PrSummary, state: "reviewed" | "handed", l: StateLabels): Promise<string | null> {
  const c = labelChange(pr.labels, state, l);
  if (!c) return null;
  await ensureLabel(pr.repo, c.add, state);
  const args = ["pr", "edit", pr.url, "--add-label", c.add, ...(c.remove ? ["--remove-label", c.remove] : [])];
  const r = await gh(args, 30_000);
  if (!r.ok) throw new Error(r.err.slice(0, 200) || "Couldn't label the PR.");
  return c.remove ? `labelled ${c.add} (was ${c.remove})` : `labelled ${c.add}`;
}
