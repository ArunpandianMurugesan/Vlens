import { autopilotState } from "@/lib/autopilot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Autopilot's rules, paused PRs, activity log, and each PR's past reviews.
export async function GET() {
  return Response.json(await autopilotState());
}
