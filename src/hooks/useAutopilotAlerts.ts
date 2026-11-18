"use client";

import { useEffect, useRef } from "react";
import type { Activity } from "@/lib/autopilotPlan";
import { notify } from "@/lib/notify";
import type { Review } from "./useReview";

// Desktop alerts for autopilot: a PR handed to you, a review ready, a review it posted,
// a review that failed. Read from autopilot's activity log as it changes, each kind
// switched on or off in Autopilot settings. Like Vlens's other alerts, they show only
// while Vlens isn't the window you're looking at, and the Settings switch silences all.
// A click opens the PR (in a browser; macOS's own notifications can't take clicks).

const KIND: Partial<Record<Activity["kind"], "handed" | "ready" | "posted" | "failed">> = { handed: "handed", reviewed: "ready", posted: "posted", error: "failed" };
const TITLE = { handed: "Handed to you", ready: "Review ready", posted: "Autopilot posted a review", failed: "Autopilot review failed" };

export function useAutopilotAlerts(review: Review, openPr: (url: string) => void) {
  const seen = useRef<string | null>(null); // the newest activity already handled
  const { auto } = review;
  useEffect(() => {
    if (!auto) return;
    const newest = auto.activity[0]?.at ?? "";
    // First load: what's already in the log is old news.
    if (seen.current === null) {
      seen.current = newest;
      return;
    }
    const fresh = auto.activity.filter((a) => a.at > seen.current!);
    seen.current = newest > seen.current ? newest : seen.current;
    for (const a of fresh.reverse()) {
      const kind = KIND[a.kind];
      // Only autopilot's own work: not reviews you started or posted yourself.
      if (!kind || !auto.rules.alerts[kind] || (kind !== "handed" && kind !== "failed" && !/^Autopilot/.test(a.detail))) continue;
      notify(`${TITLE[kind]}${a.title ? `: ${a.title}` : ""}`, a.detail, { tag: `ap-${kind}-${a.url ?? ""}-${a.at}`, onClick: a.url ? () => openPr(a.url!) : undefined });
    }
  }, [auto, openPr]);
}
