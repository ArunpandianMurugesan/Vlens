import { autopilotState } from "@/lib/autopilot";
import { ensureRunner } from "@/lib/autopilotRunner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Autopilot's rules, paused PRs, activity log, each PR's past reviews, and what the
// runner is doing. Asking also starts the runner's once-a-minute check.
export async function GET() {
  ensureRunner();
  return Response.json(await autopilotState());
}
