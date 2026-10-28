import { checkForUpdate } from "@/lib/updates";

export const dynamic = "force-dynamic";

// ?force=1 skips the 6-hour cache (Settings → Check now).
export async function GET(req: Request) {
  return Response.json(await checkForUpdate(new URL(req.url).searchParams.has("force")));
}
