import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeCmd } from "./cli";
import type { McpServer } from "./types";

// `claude mcp list` prints one line per server, e.g.
//   datadog: https://mcp.example.com/mcp (HTTP) - ! Needs authentication
//   claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected
const LINE = /^(.+?): (.+?) - (.+)$/;

function status(s: string): McpServer["status"] {
  if (/connected/i.test(s)) return "connected";
  if (/needs auth/i.test(s)) return "needs-auth";
  if (/pending/i.test(s)) return "pending";
  return "failed";
}

type Where = { scope: "user" | "local"; project?: string };
type Config = { type?: string; url?: string; command?: string; args?: string[] };

// Which config each of your own servers lives in. ~/.claude.json keeps user-wide
// servers at the top level and per-folder ("local") ones under projects.
async function scopes(): Promise<{ where: Map<string, Where>; local: { name: string; project: string; cfg: Config }[] }> {
  const where = new Map<string, Where>();
  const local: { name: string; project: string; cfg: Config }[] = [];
  try {
    const d = JSON.parse(await fs.readFile(path.join(os.homedir(), ".claude.json"), "utf8"));
    for (const name of Object.keys(d.mcpServers ?? {})) where.set(name, { scope: "user" });
    for (const [project, p] of Object.entries<{ mcpServers?: Record<string, Config> }>(d.projects ?? {}))
      for (const [name, cfg] of Object.entries(p.mcpServers ?? {})) {
        if (!where.has(name)) where.set(name, { scope: "local", project });
        local.push({ name, project, cfg });
      }
  } catch {}
  return { where, local };
}

// Health checks make `mcp list` slow (several seconds), so keep the last answer briefly.
let cache: { at: number; servers: McpServer[] } | null = null;

export async function listMcp(fresh = false): Promise<McpServer[]> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.servers;
  const [{ out }, { where, local }] = await Promise.all([claudeCmd(["mcp", "list"]), scopes()]);
  const servers: McpServer[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(LINE);
    if (!m || line.startsWith("[")) continue;
    const [, name, target, state] = m;
    const connector = name.startsWith("claude.ai ");
    const t = target.match(/^(.*) \((HTTP|SSE|stdio)\)$/i);
    servers.push({
      name,
      target: t ? t[1] : target,
      transport: t ? (t[2].toLowerCase() as McpServer["transport"]) : /^https?:/.test(target) ? "http" : "stdio",
      status: status(state),
      statusText: state.trim(),
      kind: connector ? "connector" : "server",
      ...(connector ? {} : (where.get(name) ?? {})),
    });
  }
  // `mcp list` only health-checks servers for the folder it runs in (home), so
  // add the ones scoped to other project folders straight from the config.
  for (const { name, project, cfg } of local) {
    if (project === os.homedir() && servers.some((x) => x.name === name)) continue;
    const transport: McpServer["transport"] = cfg.type === "http" || cfg.type === "sse" ? cfg.type : "stdio";
    servers.push({
      name,
      target: cfg.url ?? [cfg.command, ...(cfg.args ?? [])].filter(Boolean).join(" "),
      transport,
      status: "pending",
      statusText: "Checked when that project opens",
      kind: "server",
      scope: "local",
      project,
    });
  }
  cache = { at: Date.now(), servers };
  return servers;
}

export interface AddMcp {
  name: string;
  transport: "stdio" | "http" | "sse";
  target: string; // URL, or the command for stdio
  args: string[]; // stdio only
  env: string[]; // KEY=value, stdio only
  headers: string[]; // "Name: value", http/sse only
  scope: "user" | "local";
  project?: string; // folder for local scope
}

export async function addMcp(a: AddMcp, cwd: string) {
  const args = ["mcp", "add", "-s", a.scope];
  if (a.transport !== "stdio") args.push("--transport", a.transport);
  for (const e of a.env) args.push("-e", e);
  for (const h of a.headers) args.push("--header", h);
  args.push(a.name);
  if (a.transport === "stdio") args.push("--", a.target, ...a.args);
  else args.push(a.target);
  cache = null;
  return claudeCmd(args, cwd);
}

export async function removeMcp(name: string, scope: "user" | "local", cwd: string) {
  cache = null;
  return claudeCmd(["mcp", "remove", "-s", scope, name], cwd);
}

export async function logoutMcp(name: string) {
  cache = null;
  return claudeCmd(["mcp", "logout", name]);
}
