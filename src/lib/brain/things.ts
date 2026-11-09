// The things memories are about (tickets, PRs, repos, people, projects, files,
// teams), and finding the obvious ones in text without AI: ticket keys, PR refs
// and links, file paths. People, projects and teams come from the curator or bots.
// Pure: used by the store, the curator and the page.

export type ThingType = "ticket" | "pr" | "repo" | "person" | "project" | "file" | "team";
export const THING_TYPES: ThingType[] = ["ticket", "pr", "repo", "person", "project", "file", "team"];
export interface ThingRef {
  type: ThingType;
  key: string;
  name?: string;
}

// How memories connect to each other.
export type LinkRel = "supersedes" | "caused_by" | "fixes" | "part_of" | "relates_to";
export const LINK_RELS: LinkRel[] = ["supersedes", "caused_by", "fixes", "part_of", "relates_to"];
export const LINK_LABEL: Record<LinkRel, string> = { supersedes: "replaces", caused_by: "caused by", fixes: "fixes", part_of: "part of", relates_to: "relates to" };

// One spelling per thing, so "XPAN-95" and "xpan-95" are the same ticket.
export function normalize(t: ThingRef): ThingRef {
  const key = t.key.trim();
  switch (t.type) {
    case "ticket":
      return { ...t, key: key.toUpperCase() };
    case "pr": {
      const m = key.match(/^(?:[\w.-]+\/)?([\w.-]+)#(\d+)$/);
      return { ...t, key: m ? `${m[1].toLowerCase()}#${m[2]}` : key.toLowerCase() };
    }
    case "repo":
      return { ...t, key: key.toLowerCase().replace(/^.*\//, "").replace(/\.git$/, "") };
    case "file":
      return { ...t, key: key.replace(/^\.\//, ""), name: t.name ?? key.split("/").pop() };
    default:
      return { ...t, key: key.toLowerCase().replace(/\s+/g, " "), name: t.name ?? key };
  }
}
export const thingId = (t: ThingRef) => {
  const n = normalize(t);
  return `${n.type}:${n.key}`;
};

// Look-alikes of ticket keys that aren't tickets.
const NOT_TICKETS = new Set(["UTF", "SHA", "ISO", "RFC", "TLS", "SSL", "AES", "GPT", "ES", "MD", "HTTP", "HTTPS", "NODE", "ARM", "X", "V", "PEP", "CVE", "E", "COVID", "ECMA"]);
const FILE_EXT = "tsx?|jsx?|mjs|cjs|go|py|rb|java|kt|swift|md|json|ya?ml|toml|sql|proto|css|scss|html|sh|txt";

export function detectThings(text: string): ThingRef[] {
  const out = new Map<string, ThingRef>();
  const add = (t: ThingRef) => {
    const n = normalize(t);
    out.set(`${n.type}:${n.key}`, n);
  };
  for (const m of text.matchAll(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/gi)) {
    add({ type: "pr", key: `${m[1]}#${m[2]}` });
    add({ type: "repo", key: m[1] });
  }
  for (const m of text.matchAll(/(?<![\w/#])([a-z][\w.-]{1,40})#(\d{1,6})\b/gi)) {
    add({ type: "pr", key: `${m[1]}#${m[2]}` });
    add({ type: "repo", key: m[1] });
  }
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g)) if (!NOT_TICKETS.has(m[1])) add({ type: "ticket", key: `${m[1]}-${m[2]}` });
  const files = new RegExp(`(?:^|[\\s\`'"(])((?:[\\w.-]+\\/)*[\\w.-]+\\.(?:${FILE_EXT}))(?=[\\s\`'"),.:;]|$)`, "g");
  for (const m of text.matchAll(files)) if (!/:\/\//.test(m[1]) && m[1].length < 160) add({ type: "file", key: m[1] });
  return [...out.values()];
}

export const THING_LABEL: Record<ThingType, string> = { ticket: "Ticket", pr: "PR", repo: "Repo", person: "Person", project: "Project", file: "File", team: "Team" };
