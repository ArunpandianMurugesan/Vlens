import { listSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listSessions());
}
