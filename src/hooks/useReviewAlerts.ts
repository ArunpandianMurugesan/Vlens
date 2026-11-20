"use client";

import { useEffect, useRef } from "react";
import { notify } from "@/lib/notify";
import type { Review } from "./useReview";

// Desktop alerts for auto re-reviews: the drafts are ready, or the review failed.
// Like Vlens's other alerts they show only while Vlens isn't the window you're
// looking at, and the Settings switch silences them all. A click opens the PR.

export function useReviewAlerts(review: Review, openPr: (url: string) => void) {
  const seen = useRef<Map<string, string> | null>(null); // PR url -> what was last alerted (run at / failure at)
  const { life, lifeLoaded, prs } = review;
  useEffect(() => {
    if (!lifeLoaded) return;
    const now = new Map<string, string>();
    for (const [url, t] of Object.entries(life.tracks)) if (t.lastRun?.by === "auto" && !t.lastRun.carried) now.set(url, `run:${t.lastRun.at}`); // a rebase carried over isn't news
    for (const [url, f] of Object.entries(life.failed)) if (life.watch[url] && f.error !== "Stopped.") now.set(`${url}#failed`, `failed:${f.at}`);
    // First load: what's already there is old news.
    if (seen.current === null) {
      seen.current = now;
      return;
    }
    const title = (url: string) => prs.find((p) => p.url === url)?.title ?? url.replace("https://github.com/", "");
    for (const [key, v] of now) {
      if (seen.current.get(key) === v) continue;
      const url = key.replace(/#failed$/, "");
      if (key.endsWith("#failed")) notify(`Auto review failed: ${title(url)}`, life.failed[url]?.error ?? "", { tag: `auto-failed-${url}`, onClick: () => openPr(url) });
      else notify(`Auto review ready: ${title(url)}`, "Claude's drafts are in the PR's Discussion tab. Nothing is posted.", { tag: `auto-ready-${url}`, onClick: () => openPr(url) });
    }
    seen.current = now;
  }, [life, lifeLoaded, prs, openPr]);
}
