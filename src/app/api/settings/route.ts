import { getSettings, updateSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getSettings());
}

export async function PATCH(req: Request) {
  return Response.json(await updateSettings(await req.json()));
}
