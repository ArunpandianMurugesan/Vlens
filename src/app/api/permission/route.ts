import { isPermissionMode } from "@/lib/modes";
import { type Answers, type Decision, settle } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const DECISIONS = new Set<Decision>(["allow", "always", "deny"]);

// Your answer to a permission question from a running Claude, or your picks for one of its questions.
export async function POST(req: Request) {
  const { id, decision, answers, message, approve } = (await req.json()) as { id?: string; decision?: Decision; answers?: Answers; message?: string; approve?: string };
  const valid = answers && typeof answers === "object" && Object.values(answers).every((v) => typeof v === "string");
  if (!id || !(valid || isPermissionMode(approve) || (decision && DECISIONS.has(decision)))) return Response.json({ error: "bad request" }, { status: 400 });
  const reply = isPermissionMode(approve) ? { approve } : valid ? { answers: answers! } : decision === "deny" && message?.trim() ? { deny: message.trim() } : decision!;
  if (!settle(id, reply)) return Response.json({ error: "That question is no longer waiting (it timed out or the run ended)." }, { status: 410 });
  return Response.json({ ok: true });
}
