"use client";

import { useEffect, useRef } from "react";

// The Mac app's menus (desktop/main.cjs) send their actions to the page as a
// "lens:menu" event. Each part of the page handles the ones it knows:
//   page.tsx       new-session, new-worktree, open-folder, archive, go-*, switcher,
//                  next-waiting, settings, toggle-sidebar, toggle-inspector
//   ChatWindow     next-mode, stop, compact, to-terminal, take-over, fork, fork-terminal
//   ChatWithFiles  toggle-terminal
//   PermissionCard allow, always, deny (only the oldest open prompt)
//   page.tsx also: open-session:<id> (from the menu bar)
export function useMenu(on: Record<string, (arg: string) => void>) {
  const ref = useRef(on);
  ref.current = on;
  useEffect(() => {
    const go = (e: Event) => {
      const d = String((e as CustomEvent<string>).detail);
      const i = d.indexOf(":");
      ref.current[i < 0 ? d : d.slice(0, i)]?.(i < 0 ? "" : d.slice(i + 1));
    };
    window.addEventListener("lens:menu", go);
    return () => window.removeEventListener("lens:menu", go);
  }, []);
}
