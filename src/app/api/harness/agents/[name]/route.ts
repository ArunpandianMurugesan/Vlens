import { getHarnessAgent } from "@/lib/harnessBridge";
import { fromHarness } from "@/lib/harnessMap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One harness agent as Vlens bot files, to review before creating (read only).
//   GET -> { agent, playbook, notes }
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { files, notes } = fromHarness(await getHarnessAgent((await params).name));
    return Response.json({ ...files, notes });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
