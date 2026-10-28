/* eslint-disable @typescript-eslint/no-explicit-any -- CLI JSON output is untyped */
import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeCmd } from "./cli";
import { frontmatter } from "./skills";
import type { Marketplace, MarketplacePlugin, PluginDetail } from "./types";

// Everything here goes through the CLI's own `claude plugin` commands, so Vlens
// and the terminal always agree on what's installed.

const json = async <T>(args: string[], cwd?: string): Promise<T> => {
  const r = await claudeCmd(args, cwd);
  const out = r.out.slice(r.out.search(/[[{]/));
  try {
    return JSON.parse(out.slice(0, Math.max(out.lastIndexOf("]"), out.lastIndexOf("}")) + 1));
  } catch {
    throw new Error(r.out.slice(0, 300) || "The CLI didn't return a list.");
  }
};

export async function listMarketplaces(): Promise<Marketplace[]> {
  const list = await json<any[]>(["plugin", "marketplace", "list", "--json"]);
  return list.map((m) => ({
    name: m.name,
    source: m.repo ?? m.url ?? m.path ?? m.source ?? "",
    location: m.installLocation ?? null,
  }));
}

// The full catalog (installed + available) takes a few seconds; keep it briefly.
let cache: { at: number; plugins: MarketplacePlugin[]; marketplaces: Marketplace[] } | null = null;

export async function catalog(fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < 2 * 60_000) return cache;
  const [{ installed = [], available = [] }, marketplaces] = await Promise.all([
    json<{ installed: any[]; available: any[] }>(["plugin", "list", "--json", "--available"]),
    listMarketplaces(),
  ]);
  const byId = new Map<string, MarketplacePlugin>();
  for (const a of available)
    byId.set(a.pluginId, {
      id: a.pluginId,
      name: a.name,
      marketplace: a.marketplaceName,
      description: a.description ?? "",
      version: a.version ?? null,
      installCount: typeof a.installCount === "number" ? a.installCount : null,
      installs: [],
    });
  // A plugin can be installed in more than one scope (e.g. for you and for one project).
  for (const i of installed) {
    const [name, marketplace = ""] = String(i.id).split("@");
    const p =
      byId.get(i.id) ??
      ({ id: i.id, name, marketplace, description: "", version: i.version ?? null, installCount: null, installs: [] } as MarketplacePlugin);
    p.installs.push({ scope: i.scope, enabled: !!i.enabled, version: i.version ?? null, project: i.projectPath ?? null });
    byId.set(i.id, p);
  }
  cache = { at: Date.now(), plugins: [...byId.values()], marketplaces };
  return cache;
}

const drop = () => (cache = null);

// owner/repo on GitHub, a git or https URL, or a local folder.
const SOURCE = /^([\w.-]+\/[\w.-]+|https:\/\/\S+|git@\S+|~?\/\S+)$/;
const PLUGIN_ID = /^[\w.-]+@[\w.-]+$/;
const MARKET = /^[\w.-]+$/;

async function run(args: string[], cwd?: string) {
  const r = await claudeCmd(args, cwd);
  drop();
  if (!r.ok) throw new Error(r.out.slice(0, 400) || "The CLI reported an error.");
  return r.out;
}

export async function addMarketplace(source: string) {
  const s = source.trim().replace(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(\.git)?\/?$/, "$1");
  if (!SOURCE.test(s)) throw new Error("Use a GitHub repo like owner/repo, a URL, or a folder path.");
  await run(["plugin", "marketplace", "add", s.startsWith("~") ? path.join(os.homedir(), s.slice(1)) : s]);
}

export async function removeMarketplace(name: string) {
  if (!MARKET.test(name)) throw new Error("Bad marketplace name.");
  await run(["plugin", "marketplace", "remove", name]);
}

export async function updateMarketplaces() {
  await run(["plugin", "marketplace", "update"]);
}

type Scope = "user" | "project" | "local";

function checkId(id: string) {
  if (!PLUGIN_ID.test(id)) throw new Error("Bad plugin id.");
}

export async function install(id: string, scope: Scope, project?: string) {
  checkId(id);
  if ((scope === "project" || scope === "local") && !project) throw new Error("Pick a project folder.");
  const cwd = scope === "user" ? undefined : project;
  const out = await run(["plugin", "install", id, "--scope", scope], cwd);
  // Some plugins install switched off ("disabled by default"). Installing from
  // Vlens means you want to use it, so turn it on.
  if (/disabled by default/i.test(out)) await run(["plugin", "enable", id, "--scope", scope], cwd);
}

export async function uninstall(id: string, scope: Scope, project?: string) {
  checkId(id);
  await run(["plugin", "uninstall", id, "--scope", scope], scope === "user" ? undefined : (project ?? undefined));
}

export async function setEnabled(id: string, on: boolean, scope: Scope, project?: string) {
  checkId(id);
  await run(["plugin", on ? "enable" : "disable", id, "--scope", scope], scope === "user" ? undefined : (project ?? undefined));
}

export async function updatePlugin(id: string) {
  checkId(id);
  await run(["plugin", "update", id]);
}

// What's inside a plugin: the CLI's inventory and token cost, plus the skills
// read straight from the marketplace's copy of the plugin.
export async function details(id: string): Promise<PluginDetail> {
  checkId(id);
  const [name, market] = id.split("@");
  const { marketplaces, plugins } = await catalog();

  // Find the plugin's folder inside the marketplace's local copy (when it lives there).
  let dir: string | null = null;
  const loc = marketplaces.find((m) => m.name === market)?.location;
  if (loc) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(loc, ".claude-plugin", "marketplace.json"), "utf8"));
      const src = (manifest.plugins ?? []).find((p: any) => p.name === name)?.source;
      if (typeof src === "string" && !src.includes("..")) dir = path.join(loc, src);
    } catch {}
  }

  // Installed plugins the CLI knows by id; others it can inspect from their folder.
  const installed = plugins.find((p) => p.id === id)?.installs.length;
  const info = installed || !dir ? await claudeCmd(["plugin", "details", id]) : await claudeCmd(["--plugin-dir", dir, "plugin", "details", name]);
  const alwaysOn = info.out.match(/Always-on:\s*~?([\d,.]+)\s*([kKmM]?)\s*tok/);
  const tokens = alwaysOn ? Number(alwaysOn[1].replace(/,/g, "")) * (/k/i.test(alwaysOn[2]) ? 1000 : /m/i.test(alwaysOn[2]) ? 1e6 : 1) : null;

  const skills: { name: string; description: string }[] = [];
  let readme: string | null = null;
  if (dir) {
    for (const e of await fs.readdir(path.join(dir, "skills"), { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue;
      const md = await fs.readFile(path.join(dir, "skills", e.name, "SKILL.md"), "utf8").catch(() => null);
      if (!md) continue;
      const fm = frontmatter(md);
      skills.push({ name: fm.name ?? e.name, description: fm.description ?? "" });
    }
    readme = await fs.readFile(path.join(dir, "README.md"), "utf8").catch(() => null);
  }
  return {
    id,
    inventory: info.ok && !/not found/i.test(info.out) ? info.out.trim() : null,
    alwaysOnTokens: tokens,
    skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    readme: readme && readme.length > 20_000 ? readme.slice(0, 20_000) + "\n\n…" : readme,
  };
}
