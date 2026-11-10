import "server-only";
import os from "node:os";
import { runClaudeOnce } from "./runClaude";
import type { HarnessAgent } from "./harnessMap";

// Reading the dev-agent-harness from Vlens itself (no bot), for importing an
// agent. Only Claude can reach a connector, so a small Haiku run calls one
// read-only tool and hands back its JSON. Nothing here writes to the harness.

async function call(tool: string, args: object, shape: string, timeoutMs = 120_000): Promise<unknown> {
  const r = await runClaudeOnce({
    prompt: `Call the MCP tool ${tool} with ${JSON.stringify(args)}. ${shape} Reply with ONLY that JSON, no prose, no fences.`,
    cwd: os.tmpdir(),
    timeoutMs,
    args: ["--no-session-persistence", "--model", "haiku", "--permission-mode", "default", "--allowedTools", tool, "--disallowedTools", "Bash,Write,Edit,Read"],
  });
  if (!r.ok) throw new Error(`The harness didn't answer: ${r.error}`);
  const t = r.text.trim();
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new Error("The harness answer wasn't readable. Try again.");
  }
}

export interface HarnessAgentRow {
  name: string;
  description: string;
  shared: boolean;
}

const g = globalThis as { lensHarnessAgents?: { at: number; rows: HarnessAgentRow[] } };

export async function listHarnessAgents(force = false): Promise<HarnessAgentRow[]> {
  if (!force && g.lensHarnessAgents && Date.now() - g.lensHarnessAgents.at < 10 * 60_000) return g.lensHarnessAgents.rows;
  const out = await call("mcp__dev-agent-harness__list_agents", {}, 'Give a JSON array with one {"name","description","shared"} per agent: description is its description cut to 140 characters, shared is true for agents that ship in the harness repo and false for stored ones.', 180_000);
  const rows = (Array.isArray(out) ? out : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => /^[a-z0-9-]+$/.test(String(x.name)))
    .map((x) => ({ name: String(x.name), description: String(x.description ?? "").slice(0, 200), shared: x.shared !== false }));
  g.lensHarnessAgents = { at: Date.now(), rows };
  return rows;
}

export async function getHarnessAgent(name: string): Promise<HarnessAgent> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Not a harness agent name.");
  const out = (await call(
    "mcp__dev-agent-harness__get_agent",
    { name },
    'Give a JSON object with exactly these fields from the result, copied verbatim (the playbook text exactly as returned, every character): {"name","description","card","model","effort","playbook","repos","allowedTools","schedule","on"}.',
    240_000,
  )) as HarnessAgent;
  if (!out || out.name !== name) throw new Error(`The harness didn't return the agent "${name}".`);
  return out;
}
