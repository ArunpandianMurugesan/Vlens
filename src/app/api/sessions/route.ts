import { startBots } from "@/lib/botEngine";
import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  startBots(); // the app polls this, so bots run even before the startup hook does
  return Response.json(await (await getProvider()).listSessions());
}
