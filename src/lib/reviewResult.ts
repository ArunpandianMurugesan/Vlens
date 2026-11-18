// The result a review session hands back: the last ```json block in Claude's reply
// (its shape is set by reviewPrompt in ReviewView.tsx). Pure, so both the results
// panel and the server (a PR's "Claude's take") read it the same way.

export type Finding = { id?: string; file: string; line: number; body: string; severity?: string };
// An earlier inline comment, checked against the code now (see reviewPrompt).
export type PriorCheck = { commentId?: number; file?: string; line?: number; author?: string; status: "fixed" | "unfixed" | "unverified"; evidence?: string };
// Claude's move of Vlens's risk score (risk.ts), -20 to +20, with its reason.
export type RiskAdjust = { adjust: number; why: string };
export type ReviewResult = { kind: "review"; verdict: string; summary: string; findings: Finding[]; priorChecks: PriorCheck[]; risk: RiskAdjust | null };
export type Shot = { label: string; before?: string; after?: string };
export type ShotsResult = { kind: "shots"; verdict: string; summary: string; shots: Shot[] };

// The last ```json block in this text that holds findings or shots.
export function parseResult(text: string): ReviewResult | ShotsResult | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((x) => x[1]).reverse();
  for (const raw of blocks) {
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
        };
      if (Array.isArray(j.shots)) return { kind: "shots", verdict: String(j.verdict ?? ""), summary: String(j.summary ?? ""), shots: j.shots };
    } catch {}
  }
  return null;
}
