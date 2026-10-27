import { slashCommands } from "@/lib/commands";
import { resolveDir } from "@/lib/folders";

export const dynamic = "force-dynamic";

// Slash commands and skills you can type with "/" in a session's folder.
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  return Response.json(await slashCommands(cwd ? ((await resolveDir(cwd)) ?? undefined) : undefined));
}
