"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { imageBlocks } from "@/lib/images";
import type {
  AgentEvent,
  ChatMessage,
  CrashedSession,
  ImageInput,
  Limits,
  SessionDetail,
  SessionSummary,
  Settings,
  SubThread,
} from "@/lib/types";

export interface ToolRun {
  id: string;
  name: string;
  input: unknown;
  result?: { text: string; isError: boolean };
}

export interface LiveRun {
  text: string;
  tools: ToolRun[];
  error?: string;
}

// Where a new sub-thread is spawned from.
export interface SpawnSource {
  parentThreadId: string | null; // null = root session
  anchorMessageId: string;
  selectedText: string;
  parentMessageText: string;
}

// Reads the NDJSON stream from /api/agent or /api/chat and applies it to a LiveRun.
async function readRun(
  res: Response,
  patch: (fn: (r: LiveRun) => LiveRun) => void,
  on: { session?: (id: string) => void; done: (m: ChatMessage) => void },
) {
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as AgentEvent;
      switch (ev.type) {
        case "delta":
          patch((r) => ({ ...r, text: r.text + ev.text }));
          break;
        case "tool":
          // Text before a tool call is a finished paragraph; keep a gap after it.
          patch((r) => ({
            ...r,
            text: r.text && !r.text.endsWith("\n\n") ? r.text + "\n\n" : r.text,
            tools: [...r.tools, { id: ev.id, name: ev.name, input: ev.input }],
          }));
          break;
        case "tool_result":
          patch((r) => ({
            ...r,
            tools: r.tools.map((x) =>
              x.id === ev.toolUseId ? { ...x, result: { text: ev.text, isError: ev.isError } } : x,
            ),
          }));
          break;
        case "session":
          on.session?.(ev.claudeSessionId);
          break;
        case "done":
          on.done(ev.message);
          break;
        case "error":
          patch((r) => ({ ...r, error: ev.error }));
          break;
      }
    }
  }
}

export type RootMode = "plan" | "acceptEdits";

// Key for the main session's run in the `live` map (thread ids are UUIDs, so no clash).
export const ROOT = "root";

function without<T>(rec: Record<string, T>, key: string) {
  const next = { ...rec };
  delete next[key];
  return next;
}

export function useTreeChat() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [threads, setThreads] = useState<Record<string, SubThread>>({});
  const [drafts, setDrafts] = useState<Set<string>>(new Set()); // opened but nothing sent yet
  const [stack, setStack] = useState<string[]>([]); // open panels, root-most first
  const [live, setLive] = useState<Record<string, LiveRun>>({});
  const aborts = useRef<Record<string, AbortController>>({});
  // While the main session is replying: the prompt just sent, and how many
  // messages the session had before it. The CLI writes the session file as it
  // goes, so anything past that count is shown from the live stream instead.
  const [rootPending, setRootPending] = useState<{ message: ChatMessage; base: number } | null>(null);
  // A session that doesn't exist yet: the user picked "New session" and is choosing a folder.
  const [draft, setDraft] = useState<{ cwd: string } | null>(null);
  // Last time this app wrote to a session, so the UI can tell our writes from someone else's.
  const [ownWrite, setOwnWrite] = useState<{ id: string; at: number } | null>(null);

  // Sidebar: poll so new CLI sessions show up on their own.
  const loadSessions = useCallback(
    () =>
      fetch("/api/sessions")
        .then((r) => r.json())
        .then(setSessions)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    loadSessions();
    const t = setInterval(loadSessions, 5000);
    return () => clearInterval(t);
  }, [loadSessions]);

  // Plan usage (5h / weekly). Reading is free; any Lens run updates it on the
  // server. Refreshing sends one tiny request, so do it on load only when stale.
  const [limits, setLimits] = useState<Limits | null>(null);
  const [refreshingLimits, setRefreshingLimits] = useState(false);
  const refreshLimits = useCallback(async () => {
    setRefreshingLimits(true);
    try {
      setLimits(await fetch("/api/limits", { method: "POST" }).then((r) => r.json()));
    } finally {
      setRefreshingLimits(false);
    }
  }, []);
  useEffect(() => {
    const load = () =>
      fetch("/api/limits")
        .then((r) => r.json())
        .then((l: Limits) => {
          setLimits(l);
          return l;
        })
        .catch(() => null);
    void load().then((l) => {
      const age = l?.updatedAt ? Date.now() - new Date(l.updatedAt).getTime() : Infinity;
      if (age > 15 * 60_000) void refreshLimits();
    });
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [refreshLimits]);

  // Lens settings (default model, auto-restore, terminal app).
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);
  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSettings(
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then((r) => r.json()),
    );
  }, []);

  // Sessions that stopped unexpectedly (crash, reboot). With auto-restore on,
  // the server reopens them itself and tells us which ones it reopened.
  const [crashed, setCrashed] = useState<CrashedSession[]>([]);
  const [restoredNote, setRestoredNote] = useState<string[]>([]);
  const checkCrashed = useCallback(
    () =>
      fetch("/api/restore")
        .then((r) => r.json())
        .then((d: { crashed: CrashedSession[]; restored: string[] }) => {
          setCrashed(d.crashed);
          if (d.restored.length) setRestoredNote(d.restored);
        })
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    checkCrashed();
    const t = setInterval(checkCrashed, 15_000);
    return () => clearInterval(t);
  }, [checkCrashed]);
  const handleCrashed = useCallback(
    async (key: string, action: "restore" | "dismiss") => {
      const res = await fetch("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, action }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
      await checkCrashed();
    },
    [checkCrashed],
  );

  // Session actions from the sidebar. Each throws with a readable message on failure.
  const manage = useCallback(
    async (url: string, init: RequestInit) => {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
      await loadSessions(); // the open session's own poll picks up a rename
    },
    [loadSessions],
  );
  const renameSession = (id: string, title: string) =>
    manage(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
  const pinSession = (id: string, pinned: boolean) =>
    manage(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ pinned }) });
  const endSession = (id: string) => manage(`/api/sessions/${id}/end`, { method: "POST" });
  const deleteSession = async (id: string) => {
    await manage(`/api/sessions/${id}`, { method: "DELETE" });
    if (id === activeId) {
      setActiveId(null);
      setSession(null);
      setStack([]);
      setThreads({});
    }
  };

  // Open session: poll too, so a session running in the terminal updates live.
  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    let lastUpdated = "";
    setLoadingSession(true);
    const load = () =>
      fetch(`/api/sessions/${activeId}`)
        .then((r) => r.json())
        .then((d: { session: SessionDetail; threads: SubThread[] }) => {
          if (stop || !d.session) return;
          setLoadingSession(false);
          if (d.session.updatedAt !== lastUpdated) {
            lastUpdated = d.session.updatedAt;
            setSession(d.session);
          }
          setThreads((prev) => {
            const next = { ...prev };
            for (const t of d.threads) if (!aborts.current[t.id]) next[t.id] = t;
            return next;
          });
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [activeId]);

  const selectSession = useCallback((id: string) => {
    setActiveId(id);
    setSession(null);
    setStack([]);
    setThreads({});
    setRootPending(null);
    setDraft(null);
  }, []);

  const newSession = useCallback((cwd = "") => {
    setActiveId(null);
    setSession(null);
    setStack([]);
    setThreads({});
    setRootPending(null);
    setDraft({ cwd });
  }, []);

  const threadsFrom = useCallback(
    (parentThreadId: string | null, anchorMessageId?: string) =>
      Object.values(threads).filter(
        (t) =>
          t.parentThreadId === parentThreadId &&
          (!anchorMessageId || t.anchorMessageId === anchorMessageId) &&
          t.rootSessionId === activeId,
      ),
    [threads, activeId],
  );

  // Opening a thread replaces any panels deeper than its parent.
  const openThread = useCallback(
    (id: string) => {
      const t = threads[id];
      if (!t) return;
      setStack((s) => {
        const parentIdx = t.parentThreadId ? s.indexOf(t.parentThreadId) : -1;
        return [...s.slice(0, parentIdx + 1), id];
      });
    },
    [threads],
  );

  const closeFrom = useCallback((id: string) => {
    setStack((s) => {
      const i = s.indexOf(id);
      return i < 0 ? s : s.slice(0, i);
    });
  }, []);

  const spawnThread = useCallback(
    (src: SpawnSource) => {
      if (!session) return;
      const id = crypto.randomUUID();
      const t: SubThread = {
        id,
        rootSessionId: session.id,
        parentThreadId: src.parentThreadId,
        anchorMessageId: src.anchorMessageId,
        selectedContextText: src.selectedText,
        cwd: session.cwd,
        claudeSessionId: null,
        messages: [],
        createdAt: new Date().toISOString(),
      };
      // Kept on the thread only while it's a draft; the server builds its own first prompt.
      parentTexts.current[id] = src.parentMessageText;
      setThreads((p) => ({ ...p, [id]: t }));
      setDrafts((d) => new Set(d).add(id));
      setStack((s) => {
        const parentIdx = src.parentThreadId ? s.indexOf(src.parentThreadId) : -1;
        return [...s.slice(0, parentIdx + 1), id];
      });
    },
    [session],
  );
  const parentTexts = useRef<Record<string, string>>({});

  const send = useCallback(
    async (threadId: string, prompt: string, images: ImageInput[] = []) => {
      const t = threads[threadId];
      if (!t || aborts.current[threadId]) return;
      const isDraft = drafts.has(threadId);

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        parentId: t.messages.at(-1)?.id ?? t.anchorMessageId,
        role: "user",
        blocks: [...(prompt ? [{ kind: "text" as const, text: prompt }] : []), ...imageBlocks(images)],
        timestamp: new Date().toISOString(),
      };
      setThreads((p) => ({ ...p, [threadId]: { ...p[threadId], messages: [...p[threadId].messages, userMsg] } }));
      setLive((l) => ({ ...l, [threadId]: { text: "", tools: [] } }));

      const ac = new AbortController();
      aborts.current[threadId] = ac;
      const patchLive = (fn: (r: LiveRun) => LiveRun) =>
        setLive((l) => (l[threadId] ? { ...l, [threadId]: fn(l[threadId]) } : l));

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify(
            isDraft
              ? {
                  prompt,
                  images,
                  create: {
                    id: threadId,
                    rootSessionId: t.rootSessionId,
                    parentThreadId: t.parentThreadId,
                    anchorMessageId: t.anchorMessageId,
                    selectedContextText: t.selectedContextText,
                    parentMessageText: parentTexts.current[threadId] ?? "",
                    cwd: t.cwd,
                  },
                }
              : { threadId, prompt, images },
          ),
        });
        if (isDraft)
          setDrafts((d) => {
            const n = new Set(d);
            n.delete(threadId);
            return n;
          });
        await readRun(res, patchLive, {
          session: (sid) => setThreads((p) => ({ ...p, [threadId]: { ...p[threadId], claudeSessionId: sid } })),
          done: (m) => {
            setThreads((p) => ({ ...p, [threadId]: { ...p[threadId], messages: [...p[threadId].messages, m] } }));
            setLive((l) => without(l, threadId));
          },
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") patchLive((r) => ({ ...r, error: String(e) }));
      } finally {
        delete aborts.current[threadId];
      }
    },
    [threads, drafts],
  );

  const sendRoot = useCallback(
    // newIn: start a brand-new session in this folder instead (e.g. from Lens Review).
    async (prompt: string, mode: RootMode, model?: string, images: ImageInput[] = [], newIn?: string) => {
      const cur = newIn ? null : session;
      const cwd = newIn ?? draft?.cwd;
      if ((!cur && !cwd) || aborts.current[ROOT]) return;
      if (newIn) {
        setActiveId(null);
        setSession(null);
        setStack([]);
        setThreads({});
        setDraft({ cwd: newIn });
      }
      // For a new session the id arrives in the stream's "session" event.
      let sessionId = cur?.id ?? null;
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        parentId: cur?.messages.at(-1)?.id ?? null,
        role: "user",
        blocks: [...(prompt ? [{ kind: "text" as const, text: prompt }] : []), ...imageBlocks(images)],
        timestamp: new Date().toISOString(),
      };
      setRootPending({ message, base: cur?.messages.length ?? 0 });
      setLive((l) => ({ ...l, [ROOT]: { text: "", tools: [] } }));
      const ac = new AbortController();
      aborts.current[ROOT] = ac;
      const patch = (fn: (r: LiveRun) => LiveRun) => setLive((l) => (l[ROOT] ? { ...l, [ROOT]: fn(l[ROOT]) } : l));
      // Swap the live view for the saved session only once the new file is loaded, so nothing flickers.
      const finish = async () => {
        if (sessionId) setOwnWrite({ id: sessionId, at: Date.now() });
        const d = sessionId ? await fetch(`/api/sessions/${sessionId}`).then((r) => r.json()) : {};
        if (d.session) {
          setSession(d.session);
          setActiveId(d.session.id);
          setDraft(null);
        }
        setRootPending(null);
        setLive((l) => without(l, ROOT));
      };
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify(
            sessionId
              ? { sessionId, prompt, mode, model, images }
              : { cwd, prompt, mode, model, images },
          ),
        });
        await readRun(res, patch, {
          session: (id) => (sessionId = id),
          done: () => void finish(),
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") void finish();
        else patch((r) => ({ ...r, error: String(e) }));
      } finally {
        delete aborts.current[ROOT];
      }
    },
    [session, draft],
  );

  const stop = useCallback((threadId: string) => {
    aborts.current[threadId]?.abort();
    setLive((l) => without(l, threadId));
  }, []);

  return {
    sessions,
    activeId,
    session,
    loadingSession,
    threads,
    stack,
    live,
    selectSession,
    threadsFrom,
    openThread,
    closeFrom,
    spawnThread,
    send,
    stop,
    rootPending,
    draft,
    setDraft,
    ownWrite,
    newSession,
    sendRoot,
    renameSession,
    limits,
    settings,
    saveSettings,
    crashed,
    handleCrashed,
    restoredNote,
    clearRestoredNote: () => setRestoredNote([]),
    refreshingLimits,
    refreshLimits,
    pinSession,
    endSession,
    deleteSession,
  };
}

export type TreeChat = ReturnType<typeof useTreeChat>;
