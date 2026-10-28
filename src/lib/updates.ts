import "server-only";
import type { UpdateInfo } from "./types";

// Where Vlens releases are published (see scripts/release.mjs).
const REPO = process.env.VLENS_UPDATE_REPO || "ArunpandianMurugesan/Vlens";
const EVERY = 6 * 60 * 60 * 1000; // GitHub allows 60 unauthenticated requests an hour; this needs 4 a day

const current = process.env.VLENS_VERSION || "0.0.0";

// "1.10.0" > "1.9.2"; anything that isn't x.y.z counts as 0.
const parts = (v: string) => (/^v?(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1) ?? ["0", "0", "0"]).map(Number);
function newer(a: string, b: string) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const g = globalThis as { vlensUpdate?: UpdateInfo };

export async function checkForUpdate(force = false): Promise<UpdateInfo> {
  const last = g.vlensUpdate;
  if (!force && last?.checkedAt && Date.now() - Date.parse(last.checkedAt) < EVERY) return last;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `Vlens/${current}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.status === 404 ? "No release published yet." : `GitHub answered ${res.status}.`);
    const r = (await res.json()) as { tag_name: string; html_url: string; assets?: { name: string; browser_download_url: string }[] };
    const latest = r.tag_name.replace(/^v/, "");
    g.vlensUpdate = {
      current,
      latest,
      available: newer(latest, current),
      page: r.html_url,
      dmg: r.assets?.find((a) => a.name.endsWith(".dmg"))?.browser_download_url ?? null,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch (e) {
    // Offline or rate-limited: keep what we knew, and try again on the next check.
    const msg = (e as Error).name === "TimeoutError" ? "GitHub didn't answer in time." : (e as Error).message;
    g.vlensUpdate = { ...(last ?? { current, latest: null, available: false, page: null, dmg: null }), checkedAt: last?.checkedAt ?? null, error: msg };
  }
  return g.vlensUpdate;
}
