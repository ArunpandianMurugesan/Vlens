export const dynamic = "force-dynamic";

// Changes every time the Lens server starts. An open tab compares it with the
// value it saw when it loaded, to notice it's running older code.
const g = globalThis as { lensBootId?: string };
g.lensBootId ??= String(Date.now());

export function GET() {
  return Response.json({ boot: g.lensBootId });
}
