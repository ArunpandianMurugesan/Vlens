"use client";

import { ArrowUp, Clock, Folder, FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Listing {
  path: string;
  parent: string | null;
  home: string;
  dirs: string[];
}

interface Props {
  value: string; // the chosen folder ("" = none yet)
  onChange: (path: string) => void;
  recent: string[]; // folders of existing sessions, most recent first
}

// The folder you're "in" is the chosen one: pick a recent folder, browse into one, or type a path.
export function FolderPicker({ value, onChange, recent }: Props) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [typed, setTyped] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  const go = async (p: string) => {
    const req = ++latest.current;
    setLoading(true);
    const res = await fetch(`/api/folders?path=${encodeURIComponent(p)}`);
    const d = await res.json();
    if (req !== latest.current) return; // a newer pick won; ignore this slow answer
    setLoading(false);
    if (!res.ok) return setError(d.error ?? "Not a folder");
    setError(null);
    setListing(d);
    setTyped(d.path);
    onChange(d.path);
  };

  // Start from the chosen folder, or home.
  useEffect(() => {
    void go(value || "~");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const short = (p: string) => (listing && p.startsWith(listing.home) ? "~" + p.slice(listing.home.length) : p);

  return (
    <div className="space-y-5">
      {recent.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Clock size={12} /> Recent folders
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {recent.slice(0, 10).map((p) => (
              <button
                key={p}
                onClick={() => go(p)}
                title={p}
                className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  p === value ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-accent hover:text-accent"
                }`}
              >
                <Folder size={12} className="shrink-0" />
                <span className="truncate">{p.split("/").filter(Boolean).pop() ?? p}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
          <FolderOpen size={12} /> Or browse
        </h3>
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void go(typed);
            }}
            className="flex items-center gap-2 border-b border-line px-3 py-2"
          >
            <button
              type="button"
              onClick={() => listing?.parent && go(listing.parent)}
              disabled={!listing?.parent}
              className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30"
              aria-label="Up one folder"
            >
              <ArrowUp size={14} />
            </button>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="~/path/to/folder"
              spellCheck={false}
              className="flex-1 bg-transparent font-mono text-xs outline-none"
            />
            {loading && <Loader2 size={14} className="animate-spin text-muted" />}
          </form>
          {error && <p className="px-3 py-2 text-xs text-red-500">{error}</p>}
          <div className="max-h-64 overflow-y-auto py-1 scroll-thin">
            {listing?.dirs.map((d) => (
              <button
                key={d}
                onClick={() => go(`${listing.path}/${d}`)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-sunken"
              >
                <Folder size={14} className="shrink-0 text-muted" />
                <span className="truncate">{d}</span>
              </button>
            ))}
            {listing && listing.dirs.length === 0 && <p className="px-3 py-2 text-xs text-muted">No sub-folders</p>}
          </div>
        </div>
      </section>

      {value && (
        <p className="text-sm">
          Claude will start in <span className="font-mono text-accent">{short(value)}</span>
        </p>
      )}
    </div>
  );
}
