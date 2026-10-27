import { resolveDir } from "@/lib/folders";
import { addMarketplace, catalog, install, removeMarketplace, setEnabled, uninstall, updateMarketplaces, updatePlugin } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

// The catalog of every added marketplace. ?fresh skips the short cache.
export async function GET(req: Request) {
  try {
    const { plugins, marketplaces } = await catalog(new URL(req.url).searchParams.has("fresh"));
    return Response.json({ plugins, marketplaces });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

type Scope = "user" | "project" | "local";
type Body =
  | { action: "addMarketplace"; source: string }
  | { action: "removeMarketplace"; name: string }
  | { action: "refresh" }
  | { action: "install" | "uninstall"; id: string; scope: Scope; project?: string }
  | { action: "enable" | "disable"; id: string; scope: Scope; project?: string }
  | { action: "update"; id: string };

const SCOPES = new Set<Scope>(["user", "project", "local"]);

export async function POST(req: Request) {
  const b = (await req.json()) as Body;
  try {
    const project = "project" in b && b.project ? ((await resolveDir(b.project)) ?? undefined) : undefined;
    if ("scope" in b && !SCOPES.has(b.scope)) throw new Error("Pick a scope.");
    switch (b.action) {
      case "addMarketplace":
        await addMarketplace(b.source ?? "");
        break;
      case "removeMarketplace":
        await removeMarketplace(b.name);
        break;
      case "refresh":
        await updateMarketplaces();
        break;
      case "install":
        await install(b.id, b.scope, project);
        break;
      case "uninstall":
        await uninstall(b.id, b.scope, project);
        break;
      case "enable":
      case "disable":
        await setEnabled(b.id, b.action === "enable", b.scope, project);
        break;
      case "update":
        await updatePlugin(b.id);
        break;
      default:
        throw new Error("bad action");
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
