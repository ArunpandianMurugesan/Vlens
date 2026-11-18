import type { PrSummary } from "./types";

// How risky a PR is, 0 to 100, from what it touches: fixed points, each with a reason
// you can read. No AI here, so it's free, instant and the same every time. Claude can
// move it by up to 20 when it reviews (the review's "risk" field), and says why.
//
// Autopilot uses it to decide what it must not handle alone (rules.riskHandoff).

export interface RiskFactor {
  points: number;
  why: string;
}
export type RiskLevel = "low" | "medium" | "high";
export interface Risk {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[]; // biggest first
  sensitive: string[]; // files matching your "hand it to me" paths
  partial: boolean; // the file list wasn't loaded, so only size counted
}

export const levelOf = (score: number): RiskLevel => (score >= 60 ? "high" : score >= 30 ? "medium" : "low");

const TEST = /(^|\/)(tests?|__tests__|spec|e2e|testdata)\/|[._-](test|spec)\.[a-z]+$|_test\.go$/i;
const DOC = /\.(md|mdx|txt|rst|adoc)$|(^|\/)docs?\//i;
const CODE = /\.(go|ts|tsx|js|jsx|mjs|cjs|py|rb|java|kt|scala|cs|php|rs|swift|c|cc|cpp|h|sql|proto)$/i;
const MIGRATION = /(^|\/)(migrations?|schema|db\/migrate)\/|\.sql$|\.proto$/i;
const SECRET = /(^|\/)\.env(\.|$)|secret|credential|\.pem$|\.key$|(^|\/)id_rsa/i;
const INFRA = /(^|\/)(\.github\/workflows|terraform|helm|k8s|kubernetes|deploy(ment)?s?)\/|(^|\/)Dockerfile|\.tf$|cloudbuild\.ya?ml$|(^|\/)Makefile$/i;
const DEPS = /(^|\/)(go\.(mod|sum)|package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|Pipfile(\.lock)?|poetry\.lock|Gemfile(\.lock)?|Cargo\.(toml|lock)|pom\.xml|build\.gradle(\.kts)?)$/;
const AUTH = /(^|\/)(auth|oauth|login|session|permissions?|iam|acl|billing|payments?|crypto)(\/|[._-])/i;

function safeRegexes(list: string[]) {
  return list.flatMap((s) => {
    try {
      return [new RegExp(s)];
    } catch {
      return [];
    }
  });
}

export function riskOf(pr: PrSummary, sensitivePaths: string[] = []): Risk {
  const f: RiskFactor[] = [];
  const add = (points: number, why: string) => points && f.push({ points, why });
  const lines = pr.additions + pr.deletions;
  add(lines > 1000 ? 25 : lines > 400 ? 15 : lines > 150 ? 8 : 0, `${lines} changed lines`);
  add(pr.changedFiles > 30 ? 10 : pr.changedFiles > 15 ? 5 : 0, `${pr.changedFiles} files`);

  const files = pr.files ?? [];
  const paths = files.map((x) => x.path);
  const hits = (re: RegExp) => paths.filter((p) => re.test(p));
  const short = (list: string[]) => list.slice(0, 2).map((p) => p.split("/").slice(-2).join("/")).join(", ") + (list.length > 2 ? ` +${list.length - 2}` : "");

  const sensRe = safeRegexes(sensitivePaths);
  const sensitive = paths.filter((p) => sensRe.some((re) => re.test(p)));
  if (sensitive.length) add(25, `touches your sensitive paths: ${short(sensitive)}`);
  const secret = hits(SECRET);
  if (secret.length) add(20, `secrets or credentials: ${short(secret)}`);
  const migration = hits(MIGRATION).filter((p) => !sensitive.includes(p));
  if (migration.length) add(15, `schema or migration: ${short(migration)}`);
  const auth = hits(AUTH).filter((p) => CODE.test(p) && !TEST.test(p) && !sensitive.includes(p));
  if (auth.length) add(12, `auth, billing or permissions code: ${short(auth)}`);
  const infra = hits(INFRA).filter((p) => !sensitive.includes(p));
  if (infra.length) add(10, `CI or deploy config: ${short(infra)}`);
  const deps = hits(DEPS);
  if (deps.length) add(8, `dependencies change: ${short(deps)}`);

  const code = paths.filter((p) => CODE.test(p) && !TEST.test(p));
  const tests = hits(TEST);
  const codeLines = files.filter((x) => code.includes(x.path)).reduce((n, x) => n + x.additions + x.deletions, 0);
  if (code.length && !tests.length && codeLines > 30) add(12, "code changes without test changes");
  if (pr.deletions > 200 && pr.deletions > pr.additions * 2) add(5, `mostly deletions (${pr.deletions} lines)`);
  if (files.length && paths.every((p) => TEST.test(p) || DOC.test(p))) add(-15, "only tests or docs");

  const score = Math.max(0, Math.min(100, f.reduce((n, x) => n + x.points, 0)));
  return { score, level: levelOf(score), factors: f.sort((a, b) => b.points - a.points), sensitive, partial: !pr.files };
}
