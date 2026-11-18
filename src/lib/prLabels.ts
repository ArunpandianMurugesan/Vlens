import type { StateLabels } from "./autopilotPlan";

// Which state label autopilot puts on a PR (rules.stateLabels), and which one it takes
// off: a PR wears one state at a time. Pure, so it's easy to test; prLabelsGh.ts does it.
export function labelChange(prLabels: string[], state: "reviewed" | "handed", l: StateLabels): { add: string; remove: string | null } | null {
  if (!l.enabled) return null;
  const add = l[state];
  const other = l[state === "reviewed" ? "handed" : "reviewed"];
  const has = (x: string) => prLabels.some((p) => p.toLowerCase() === x.toLowerCase());
  const remove = other.toLowerCase() !== add.toLowerCase() && has(other) ? other : null;
  if (has(add) && !remove) return null; // already right
  return { add, remove };
}
