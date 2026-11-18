import { hasReviewSkill } from "@/lib/lensPlugin";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Is the dev-agent toolkit's review skill on this Mac? (Settings shows the
// "PR review skill" switch only when it is.) useSkill: installed and switched on,
// so "Review with Claude" asks for it only then.
export async function GET() {
  const [reviewSkill, settings] = await Promise.all([hasReviewSkill(), getSettings()]);
  return Response.json({ reviewSkill, useSkill: reviewSkill && settings.reviewSkill !== false });
}
