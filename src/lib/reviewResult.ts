// The result a review session hands back: the last ```json block in Claude's reply
// (its shape is set by reviewPrompt in ReviewView.tsx). Pure, so both the results
// panel and the server (a PR's "Claude's take") read it the same way.

export type Finding = { id?: string; file: string; line: number; body: string; severity?: string };
// An earlier inline comment, checked against the code now (see reviewPrompt).
export type PriorCheck = { commentId?: number; file?: string; line?: number; author?: string; status: "fixed" | "unfixed" | "unverified"; evidence?: string };
// Claude's move of Vlens's risk score (risk.ts), -20 to +20, with its reason.
export type RiskAdjust = { adjust: number; why: string };
export type ReviewResult = { kind: "review"; verdict: string; summary: string; findings: Finding[]; priorChecks: PriorCheck[]; risk: RiskAdjust | null; handoff: string | null; ready: boolean | null };
// ready: a follow-up review's call that every earlier ask is fixed and nothing blocks the
// merge (see FOLLOW_UP in reviewPrompt.ts). null on a first review.
export type Shot = { label: string; before?: string; after?: string };
export type ShotsResult = { kind: "shots"; verdict: string; summary: string; shots: Shot[] };

// Every ```json block's JSON, last first. A finding's body often holds its own fenced
// code (a ```suggestion), so the block doesn't end at the first ``` after it: it ends
// at the first ``` that leaves valid JSON before it.
function jsonBlocks(text: string): string[] {
  const out: string[] = [];
  const starts = [...text.matchAll(/```json[^\S\n]*\n?/g)];
  for (const m of starts) {
    const from = m.index! + m[0].length;
    for (let end = text.indexOf("```", from); end >= 0; end = text.indexOf("```", end + 3)) {
      const raw = text.slice(from, end);
      try {
        JSON.parse(raw);
        out.push(raw);
        break;
      } catch {}
    }
  }
  return out.reverse();
}

// The text without its result blocks (the ```json a review or before/after hands back):
// Vlens shows those as drafts and panels, so the chat keeps only Claude's words.
export function withoutResultJson(text: string): string {
  if (!text.includes("```json")) return text;
  let out = text;
  for (const m of [...text.matchAll(/```json[^\S\n]*\n?/g)].reverse()) {
    const from = m.index! + m[0].length;
    for (let end = text.indexOf("```", from); end >= 0; end = text.indexOf("```", end + 3)) {
      try {
        const j = JSON.parse(text.slice(from, end));
        if (j && (Array.isArray(j.findings) || Array.isArray(j.shots))) out = out.slice(0, m.index!) + out.slice(end + 3);
        break;
      } catch {}
    }
  }
  // Still streaming in: a result block that hasn't closed yet.
  const open = out.lastIndexOf("```json");
  if (open >= 0 && out.indexOf("```", open + 7) < 0 && /"(findings|shots|verdict)"\s*:/.test(out.slice(open))) out = out.slice(0, open);
  return out.trimEnd();
}

// The last ```json block in this text that holds findings or shots.
export function parseResult(text: string): ReviewResult | ShotsResult | null {
  for (const raw of jsonBlocks(text)) {
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j.findings))
        return {
          kind: "review",
          verdict: String(j.verdict ?? "COMMENT").toUpperCase(),
          summary: String(j.summary ?? ""),
          findings: j.findings.filter((f: Finding) => f && f.file && f.body).map((f: Finding) => ({ ...f, line: Number(f.line) || 0 })),
          priorChecks: (Array.isArray(j.priorChecks) ? j.priorChecks : [])
            .filter((c: PriorCheck) => c && ["fixed", "unfixed", "unverified"].includes(c.status))
            .map((c: PriorCheck) => ({ ...c, commentId: Number(c.commentId) || undefined, line: Number(c.line) || undefined })),
          risk:
            j.risk && typeof j.risk === "object" && Number.isFinite(Number(j.risk.adjust))
              ? { adjust: Math.max(-20, Math.min(20, Math.round(Number(j.risk.adjust)))), why: String(j.risk.why ?? "").slice(0, 300) }
              : null,
          handoff: typeof j.handoff === "string" && j.handoff.trim() ? j.handoff.trim().slice(0, 300) : null,
          ready: typeof j.ready === "boolean" ? j.ready : null,
        };
      if (Array.isArray(j.shots)) return { kind: "shots", verdict: String(j.verdict ?? ""), summary: String(j.summary ?? ""), shots: j.shots };
    } catch {}
  }
  return null;
}
