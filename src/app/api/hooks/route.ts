import { resolveDir } from "@/lib/folders";
import { addHook, listHooks, removeHook, setDisableAll, setHookEnabled, updateHook } from "@/lib/hooks";
import type { HookScope } from "@/lib/types";

export const dynamic = "force-dynamic";

async function projectParam(p: string | null | undefined) {
  return p ? ((await resolveDir(p)) ?? undefined) : undefined;
}

export async function GET(req: Request) {
  const project = await projectParam(new URL(req.url).searchParams.get("project"));
  try {
    return Response.json(await listHooks(project));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

type Body =
  | { action: "add"; scope: HookScope; project?: string; event: string; matcher?: string; hook: unknown }
  | { action: "update"; id: string; project?: string; matcher?: string; hook: unknown }
  | { action: "remove"; id: string; project?: string }
  | { action: "toggle"; id: string; project?: string; enabled: boolean }
  | { action: "disableAll"; on: boolean };

export async function POST(req: Request) {
  const b = (await req.json()) as Body;
  try {
    const project = "project" in b ? await projectParam(b.project) : undefined;
    switch (b.action) {
      case "add":
        if (!["user", "project", "local"].includes(b.scope)) throw new Error("Pick where to save it.");
        await addHook({ ...b, project });
        break;
      case "update":
        await updateHook(b.id, { matcher: b.matcher, hook: b.hook, project });
        break;
      case "remove":
        await removeHook(b.id, project);
        break;
      case "toggle":
        await setHookEnabled(b.id, !!b.enabled, project);
        break;
      case "disableAll":
        await setDisableAll(!!b.on);
        break;
      default:
        throw new Error("bad action");
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
