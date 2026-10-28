"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { UpdateInfo } from "@/lib/types";

const SKIP_KEY = "vlens.skipVersion";

// "Vlens 1.2.0 is out" when GitHub has a newer release than this app. The server
// checks at most every 6 hours; Later hides it until the next version.
export function NewVersion() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [skipped, setSkipped] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSkipped(localStorage.getItem(SKIP_KEY));
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

  if (!info?.available || !info.latest || skipped === info.latest) return null;
  const later = () => {
    try {
      localStorage.setItem(SKIP_KEY, info.latest!);
    } catch {}
    setSkipped(info.latest);
  };
  return (
    <div className="fixed bottom-4 right-4 z-[140] flex max-w-sm items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-sm shadow-xl">
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
      <a
        href={info.dmg ?? info.page ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white"
      >
        <Download size={12} /> Download
      </a>
      <button onClick={later} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Later" title="Later">
        <X size={14} />
      </button>
    </div>
  );
}
