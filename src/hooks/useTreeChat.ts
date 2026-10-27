"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, ChatMessage, SessionDetail, SessionSummary, SubThread } from "@/lib/types";

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

  // Sidebar: poll so new CLI sessions show up on their own.
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/sessions")
        .then((r) => r.json())
        .then((s) => !stop && setSessions(s))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

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
    async (threadId: string, prompt: string) => {
      const t = threads[threadId];
      if (!t || aborts.current[threadId]) return;
      const isDraft = drafts.has(threadId);

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        parentId: t.messages.at(-1)?.id ?? t.anchorMessageId,
        role: "user",
        blocks: [{ kind: "text", text: prompt }],
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
              : { threadId, prompt },
          ),
        });
        if (isDraft)
          setDrafts((d) => {
            const n = new Set(d);
            n.delete(threadId);
            return n;
          });
        if (!res.body) throw new Error(await res.text());

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
                patchLive((r) => ({ ...r, text: r.text + ev.text }));
                break;
              case "tool":
                // Text before a tool call is a finished paragraph; keep a gap after it.
                patchLive((r) => ({
                  ...r,
                  text: r.text && !r.text.endsWith("\n\n") ? r.text + "\n\n" : r.text,
                  tools: [...r.tools, { id: ev.id, name: ev.name, input: ev.input }],
                }));
                break;
              case "tool_result":
                patchLive((r) => ({
                  ...r,
                  tools: r.tools.map((x) =>
                    x.id === ev.toolUseId ? { ...x, result: { text: ev.text, isError: ev.isError } } : x,
                  ),
                }));
                break;
              case "session":
                setThreads((p) => ({ ...p, [threadId]: { ...p[threadId], claudeSessionId: ev.claudeSessionId } }));
                break;
              case "done":
                setThreads((p) => ({
                  ...p,
                  [threadId]: { ...p[threadId], messages: [...p[threadId].messages, ev.message] },
                }));
                setLive((l) => without(l, threadId));
                break;
              case "error":
                patchLive((r) => ({ ...r, error: ev.error }));
                break;
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") patchLive((r) => ({ ...r, error: String(e) }));
      } finally {
        delete aborts.current[threadId];
      }
    },
    [threads, drafts],
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
  };
}

export type TreeChat = ReturnType<typeof useTreeChat>;
