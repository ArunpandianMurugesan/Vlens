"use client";

import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import type { FileView } from "@/lib/types";

// The file panel beside the chat: which files are open, and a way for any
// message (tool chips, links, `code` paths) to open one. Also whether the
// terminal panel is showing, since it shares that side of the window.

export interface OpenOpts {
  cwd?: string | null; // relative paths resolve against the session's folder
  find?: string; // text to highlight and scroll to (e.g. what an edit inserted)
  line?: number; // or a line to jump to
}

export interface FileTab {
  key: string; // the path as asked for; becomes the absolute path once loaded
  view?: FileView;
  error?: string;
  loading: boolean;
  find?: string;
  line?: number;
  cwd?: string | null;
}

interface Files {
  tabs: FileTab[];
  active: string | null;
  maximized: boolean;
  open: (path: string, opts?: OpenOpts) => void;
  close: (key: string) => void;
  closeAll: () => void;
  activate: (key: string) => void;
  reload: (key: string) => void;
  setMaximized: (v: boolean) => void;
  terminal: boolean; // the terminal panel is showing
  setTerminal: (v: boolean | ((v: boolean) => boolean)) => void;
}

const FilesContext = createContext<Files | null>(null);
// The folder of the session a message belongs to, for relative paths.
export const CwdContext = createContext<string | null>(null);

export const useFiles = () => useContext(FilesContext);
export const useCwd = () => useContext(CwdContext);

async function fetchView(path: string, cwd?: string | null): Promise<FileView> {
  const q = new URLSearchParams({ path, ...(cwd ? { cwd } : {}) });
  const d = await fetch(`/api/file?${q}`).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  return d;
}

export function FilesProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [terminal, setTerminal] = useState(false);

  const load = useCallback(async (key: string, path: string, cwd?: string | null) => {
    try {
      const view = await fetchView(path, cwd);
      setTabs((ts) => {
        // Same file opened twice (e.g. once relative, once absolute): keep one tab.
        const dupe = ts.find((t) => t.key === view.path && t.key !== key);
        const mine = ts.find((t) => t.key === key);
        const rest = ts.filter((t) => t.key !== key && t !== dupe);
        const merged = { ...(dupe ?? {}), ...(mine ?? {}), key: view.path, view, loading: false, error: undefined } as FileTab;
        const at = ts.findIndex((t) => t.key === key);
        rest.splice(at < 0 ? rest.length : Math.min(at, rest.length), 0, merged);
        return rest;
      });
      setActive((a) => (a === key ? view.path : a));
    } catch (e) {
      setTabs((ts) => ts.map((t) => (t.key === key ? { ...t, loading: false, error: (e as Error).message } : t)));
    }
  }, []);

  const open = useCallback(
    (path: string, opts: OpenOpts = {}) => {
      // "src/app.ts:42" jumps to line 42.
      const m = path.match(/^(.*?):(\d+)(?:-\d+)?$/);
      const file = m ? m[1] : path;
      const line = opts.line ?? (m ? Number(m[2]) : undefined);
      setTabs((ts) => {
        const existing = ts.find((t) => t.key === file || t.view?.path === file);
        if (existing) return ts.map((t) => (t === existing ? { ...t, find: opts.find, line, loading: true } : t));
        return [...ts, { key: file, loading: true, find: opts.find, line, cwd: opts.cwd }];
      });
      setActive(file);
      // Always re-read: Claude may have just changed it.
      void load(file, file, opts.cwd);
    },
    [load],
  );

  const close = useCallback((key: string) => {
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.key === key);
      const next = ts.filter((t) => t.key !== key);
      setActive((a) => (a === key ? (next[Math.max(0, i - 1)]?.key ?? null) : a));
      if (!next.length) setMaximized(false);
      return next;
    });
  }, []);

  const closeAll = useCallback(() => {
    setTabs([]);
    setActive(null);
    setMaximized(false);
  }, []);

  const reload = useCallback(
    (key: string) => {
      const t = tabs.find((x) => x.key === key);
      if (!t) return;
      setTabs((ts) => ts.map((x) => (x.key === key ? { ...x, loading: true } : x)));
      void load(key, t.view?.path ?? key, t.cwd);
    },
    [tabs, load],
  );

  return (
    <FilesContext.Provider value={{ tabs, active, maximized, open, close, closeAll, activate: setActive, reload, setMaximized, terminal, setTerminal }}>
      {children}
    </FilesContext.Provider>
  );
}
