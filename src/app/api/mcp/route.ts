import os from "node:os";
import { resolveDir } from "@/lib/folders";
import { type AddMcp, addMcp, listMcp, logoutMcp, removeMcp } from "@/lib/mcp";
import { getSettings } from "@/lib/settings";
import { openInTerminal } from "@/lib/terminal";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.has("fresh");
  return Response.json(await listMcp(fresh));
}

const NEW_NAME = /^[\w.-]{1,64}$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;
const HEADER = /^[^:\s]+:\s*\S.*$/;

type Body =
  | ({ action: "add" } & AddMcp)
  | { action: "remove" | "login" | "logout"; name: string };

const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const body = (await req.json()) as Body;

  if (body.action === "add") {
    if (!NEW_NAME.test(body.name ?? "")) return fail("Name can use letters, numbers, dot, dash and underscore.");
    if (!["stdio", "http", "sse"].includes(body.transport)) return fail("Pick a transport.");
    const target = (body.target ?? "").trim();
    if (body.transport === "stdio" ? !target : !/^https?:\/\/\S+$/.test(target))
      return fail(body.transport === "stdio" ? "Enter the command to run." : "Enter an http(s) URL.");
    const env = (body.env ?? []).map((e) => e.trim()).filter(Boolean);
    const headers = (body.headers ?? []).map((h) => h.trim()).filter(Boolean);
    if (!env.every((e) => ENV.test(e))) return fail("Env lines look like KEY=value.");
    if (!headers.every((h) => HEADER.test(h))) return fail("Header lines look like Name: value.");
    let cwd = os.homedir();
    if (body.scope === "local") {
      const dir = await resolveDir(body.project ?? "");
      if (!dir) return fail("That project folder doesn't exist.");
      cwd = dir;
    } else if (body.scope !== "user") return fail("Pick a scope.");
    const r = await addMcp({ ...body, target, env, headers, args: (body.args ?? []).filter(Boolean) }, cwd);
    return r.ok ? Response.json({ ok: true }) : fail(r.out, 500);
  }

  // Everything else acts on a server that's already in the list.
  const server = (await listMcp()).find((s) => s.name === body.name);
  if (!server) return fail("No MCP server with that name.", 404);

  switch (body.action) {
    case "remove": {
      if (server.kind === "connector" || !server.scope) return fail("Connectors are managed on claude.ai.");
      const r = await removeMcp(server.name, server.scope, server.project ?? os.homedir());
      return r.ok ? Response.json({ ok: true }) : fail(r.out, 500);
    }
    case "login":
      await openInTerminal(os.homedir(), ["claude", "mcp", "login", server.name], (await getSettings()).terminalApp);
      return Response.json({ ok: true });
    case "logout": {
      const r = await logoutMcp(server.name);
      return r.ok ? Response.json({ ok: true }) : fail(r.out, 500);
    }
  }
  return fail("bad action");
}
