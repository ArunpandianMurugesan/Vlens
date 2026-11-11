import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await (await getProvider()).listSessions());
}
