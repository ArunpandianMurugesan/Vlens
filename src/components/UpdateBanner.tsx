"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Shows "Lens was updated" when the server restarted with newer code than this
// tab loaded (a tab left open doesn't always pick it up by itself).
export function UpdateBanner() {
  const first = useRef<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const check = () =>
      fetch("/api/version", { cache: "no-store" })
        .then((r) => r.json())
        .then(({ boot }: { boot: string }) => {
          if (first.current === null) first.current = boot;
          else if (boot !== first.current) setStale(true);
        })
        .catch(() => {}); // server restarting; try again next time
    void check();
    const t = setInterval(check, 20_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!stale) return null;
  return (
    <div className="fixed left-1/2 top-3 z-[150] flex -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-panel px-4 py-2 text-sm shadow-xl">
      Lens was updated.
      <button
        onClick={() => location.reload()}
        className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-white"
      >
        <RefreshCw size={12} /> Reload
      </button>
    </div>
  );
}
