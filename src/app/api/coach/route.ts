import { getCoach } from "@/lib/coach";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getCoach());
}
