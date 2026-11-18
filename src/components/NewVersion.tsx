"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { UpdateInfo } from "@/lib/types";

const SKIP_KEY = "vlens.skipVersion"; // "Skip this version": never show this version again
const LATER_KEY = "vlens.updateLater"; // "Later": hide until this time (ms)
const LATER_MS = 24 * 60 * 60 * 1000;

// "Vlens 1.2.0 is out" when GitHub has a newer release than this app. The server
// checks at most every 6 hours. Later hides it for a day; Skip hides this version.
export function NewVersion() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [skipped, setSkipped] = useState<string | null>(null);
  const [laterUntil, setLaterUntil] = useState(0);
  const [steps, setSteps] = useState(false);

  useEffect(() => {
    try {
      setSkipped(localStorage.getItem(SKIP_KEY));
      setLaterUntil(Number(localStorage.getItem(LATER_KEY)) || 0);
    } catch {}
    const check = () =>
      fetch("/api/update")
        .then((r) => r.json())
        .then(setInfo)
        .catch(() => {});
    void check();
    const t = setInterval(check, 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // The hourly re-check also brings the card back once "Later" has run out.
  if (!info?.available || !info.latest || skipped === info.latest || Date.now() < laterUntil) return null;
  const later = () => {
    const until = Date.now() + LATER_MS;
    try {
      localStorage.setItem(LATER_KEY, String(until));
    } catch {}
    setLaterUntil(until);
  };
  const skip = () => {
    try {
      localStorage.setItem(SKIP_KEY, info.latest!);
    } catch {}
    setSkipped(info.latest);
  };
  return (
    <div className="no-drag-overlay fixed right-4 top-16 z-[140] w-80 max-w-[calc(100vw-32px)] rounded-2xl border border-line bg-panel px-4 py-3 text-sm shadow-xl">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Vlens {info.latest} is out</div>
          <div className="text-xs text-muted">
            You have {info.current}.{" "}
            {info.page && (
              <a href={info.page} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                What&apos;s new
              </a>
            )}
          </div>
        </div>
        <button onClick={later} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Remind me later" title="Remind me tomorrow">
          <X size={14} />
        </button>
      </div>
      {steps && (
        <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-xs text-muted">
          <li>Quit Vlens (⌘Q).</li>
          <li>Open the download and drag Vlens to Applications, replacing the old one.</li>
          <li>If macOS blocks it: System Settings → Privacy &amp; Security → Open Anyway.</li>
        </ol>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <a
          href={info.dmg ?? info.page ?? "#"}
          target="_blank"
          rel="noreferrer"
          onClick={() => setSteps(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-on-accent"
        >
          <Download size={12} /> Download
        </a>
        <button onClick={() => setSteps((s) => !s)} className="text-xs text-muted hover:text-ink">
          {steps ? "Hide steps" : "How to install"}
        </button>
        <span className="flex-1" />
        <button onClick={later} className="text-xs text-muted hover:text-ink">
          Later
        </button>
        <button onClick={skip} className="text-xs text-muted hover:text-ink">
          Skip this version
        </button>
      </div>
    </div>
  );
}
