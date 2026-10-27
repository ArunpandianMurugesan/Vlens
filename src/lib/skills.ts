import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Skill } from "./types";

// Where skills live:
//   ~/.claude/skills/<name>/SKILL.md            your skills (editable)
//   <project>/.claude/skills/<name>/SKILL.md    one project's skills (editable)
//   ~/.claude/skills/synced/<id>/<name>/         synced from claude.ai (read-only)
//   plugin folders with skills/<name>/           come with a plugin (read-only)
// Turning a skill off moves it into a ".disabled" folder next to it, which the
// CLI doesn't load. Deleting moves it into ".trash", the same place the app uses.
const USER_ROOT = path.join(os.homedir(), ".claude", "skills");
const PLUGINS_FILE = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
const DISABLED = ".disabled";
const TRASH = ".trash";
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Reads `name` and `description` from SKILL.md frontmatter. Handles plain,
// quoted and folded (>- / |) values, which is all skills use in practice.
export function frontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(name|description):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[>|][-+]?$/.test(v)) {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      v = parts.join(v.startsWith(">") ? " " : "\n");
    } else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
    else if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
    out[kv[1]] = v;
  }
  return out;
}

async function readSkill(dir: string): Promise<{ name?: string; description?: string } | null> {
  try {
    return frontmatter(await fs.readFile(path.join(dir, "SKILL.md"), "utf8"));
  } catch {
    return null;
  }
}

async function subdirs(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  // isSymbolicLink: skills can be links to a folder elsewhere (e.g. a plugin repo).
  return entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name);
}

// Skills in one editable root, on and off.
async function editable(root: string, source: "user" | "project", project?: string): Promise<Skill[]> {
  const out: Skill[] = [];
  for (const [base, enabled] of [
    [root, true],
    [path.join(root, DISABLED), false],
  ] as const) {
    for (const name of await subdirs(base)) {
      if (name.startsWith(".") || (source === "user" && enabled && name === "synced")) continue;
      const dir = path.join(base, name);
      const fm = await readSkill(dir);
      if (fm) out.push({ name: fm.name ?? name, description: fm.description ?? "", source, enabled, editable: true, path: dir, project });
    }
  }
  return out;
}

// A folder with skills/<name>/SKILL.md inside: a plugin's skills, named "plugin:skill".
async function pluginSkills(pluginDir: string, plugin: string): Promise<Skill[]> {
  const out: Skill[] = [];
  for (const name of await subdirs(path.join(pluginDir, "skills"))) {
    const dir = path.join(pluginDir, "skills", name);
    const fm = await readSkill(dir);
    if (fm) out.push({ name: `${plugin}:${fm.name ?? name}`, description: fm.description ?? "", source: "plugin", enabled: true, editable: false, path: dir, plugin });
  }
  return out;
}

export async function listSkills(project?: string): Promise<Skill[]> {
  const skills: Skill[] = [...(await editable(USER_ROOT, "user"))];
  if (project) skills.push(...(await editable(path.join(project, ".claude", "skills"), "project", project)));

  // Synced from claude.ai: one folder per sync source; the same skill can appear in several.
  const seen = new Set<string>();
  for (const src of await subdirs(path.join(USER_ROOT, "synced")))
    for (const name of await subdirs(path.join(USER_ROOT, "synced", src))) {
      const dir = path.join(USER_ROOT, "synced", src, name);
      const fm = await readSkill(dir);
      const n = fm?.name ?? name;
      if (!fm || seen.has(n)) continue;
      seen.add(n);
      skills.push({ name: n, description: fm.description ?? "", source: "synced", enabled: true, editable: false, path: dir });
    }

  // Plugin folders linked into ~/.claude/skills (no SKILL.md of their own, but a skills/ folder).
  for (const name of await subdirs(USER_ROOT)) {
    const dir = path.join(USER_ROOT, name);
    if (!name.startsWith(".") && !(await readSkill(dir))) skills.push(...(await pluginSkills(dir, name)));
  }
  // Installed plugins.
  try {
    const d = JSON.parse(await fs.readFile(PLUGINS_FILE, "utf8"));
    for (const [id, installs] of Object.entries<{ installPath: string }[]>(d.plugins ?? {}))
      for (const i of installs) skills.push(...(await pluginSkills(i.installPath, id.split("@")[0])));
  } catch {}

  return skills;
}

// Only skill folders directly inside a known editable root (on or off) may be changed.
async function checkEditable(dir: string, project?: string) {
  const roots = [USER_ROOT];
  if (project) roots.push(path.join(project, ".claude", "skills"));
  const abs = path.resolve(dir);
  const parent = path.dirname(abs);
  const root = roots.find((r) => parent === r || parent === path.join(r, DISABLED));
  const name = path.basename(abs);
  if (!root || name.startsWith(".") || name === "synced" || !(await readSkill(abs))) throw new Error("That skill can't be changed here.");
  return { abs, root, name, enabled: parent === root };
}

export async function readSkillFile(dir: string, project?: string, allowReadOnly = true) {
  // Read-only skills can be viewed too, as long as the path is one we listed.
  const listed = (await listSkills(project)).find((s) => s.path === path.resolve(dir));
  if (!listed || (!allowReadOnly && !listed.editable)) throw new Error("Skill not found.");
  return fs.readFile(path.join(listed.path, "SKILL.md"), "utf8");
}

export async function saveSkill(dir: string, content: string, project?: string) {
  const { abs } = await checkEditable(dir, project);
  if (!frontmatter(content).name) throw new Error("SKILL.md needs frontmatter with a name, like:\n---\nname: my-skill\ndescription: …\n---");
  await fs.writeFile(path.join(abs, "SKILL.md"), content);
}

export async function createSkill(o: { scope: "user" | "project"; project?: string; name: string; description: string; body: string }) {
  if (!SKILL_NAME.test(o.name)) throw new Error("Use lowercase letters, numbers and dashes for the name.");
  if (!o.description.trim()) throw new Error("Add a description: it's how Claude decides when to use the skill.");
  const root = o.scope === "project" && o.project ? path.join(o.project, ".claude", "skills") : USER_ROOT;
  const dir = path.join(root, o.name);
  for (const d of [dir, path.join(root, DISABLED, o.name)])
    if (await fs.stat(d).then(() => true, () => false)) throw new Error("A skill with that name already exists.");
  const desc = o.description.replace(/\s+/g, " ").trim().replace(/'/g, "''");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${o.name}\ndescription: '${desc}'\n---\n\n${o.body.trim() || `# ${o.name}\n`}\n`);
  return dir;
}

export async function setSkillEnabled(dir: string, on: boolean, project?: string) {
  const { abs, root, name, enabled } = await checkEditable(dir, project);
  if (enabled === on) return abs;
  const dest = on ? path.join(root, name) : path.join(root, DISABLED, name);
  if (await fs.stat(dest).then(() => true, () => false)) throw new Error("A skill with that name is already there.");
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(abs, dest);
  return dest;
}

export async function deleteSkill(dir: string, project?: string) {
  const { abs, root, name } = await checkEditable(dir, project);
  const bin = path.join(root, TRASH, `${Date.now()}-lens-${randomBytes(3).toString("hex")}`);
  await fs.mkdir(bin, { recursive: true });
  await fs.rename(abs, path.join(bin, name));
}
