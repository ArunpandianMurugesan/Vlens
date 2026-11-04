"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { imageBlocks } from "@/lib/images";
import type { PermissionMode } from "@/lib/modes";
import { notify, setNotifications } from "@/lib/notify";
import type {
  AgentEvent,
  ChatMessage,
  CrashedSession,
  ImageInput,
  Question,
  Limits,
  LiveState,
  RunStatus,
  SessionDetail,
  SessionSummary,
  Settings,
  SubThread,
  TaskInfo,
} from "@/lib/types";

export interface ToolRun {
  id: string;
  name: string;
  input: unknown;
  result?: { text: string; isError: boolean };
}

// Claude asking before it runs something that needs approval.
export interface PermissionAsk {
  id: string;
  tool: string;
  input: unknown;
  description: string | null;
  reason: string | null;
  always: string | null;
  questions?: Question[];
  plan?: string;
}

export interface LiveRun {
  text: string;
  tools: ToolRun[];
  asks?: PermissionAsk[];
  error?: string;
  status?: RunStatus; // what Claude is doing right now
  tasks?: Record<string, TaskInfo>; // sub-agents and background commands, by task id
  startedAt?: number;
}

// Your answer to a permission question; the run continues once it lands.
export async function answerPermission(id: string, decision: "allow" | "always" | "deny", message?: string) {
  const res = await fetch("/api/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, decision, message }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
}

// Approve Claude's plan and carry on in `mode`.
export async function approvePlan(id: string, mode: PermissionMode) {
  const res = await fetch("/api/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, approve: mode }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
}

// Your picks for Claude's questions (question text → label, or labels joined by ", ").
export async function answerQuestions(id: string, answers: Record<string, string>) {
  const res = await fetch("/api/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, answers }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
}

// Where a new sub-thread is spawned from.
export interface SpawnSource {
  parentThreadId: string | null; // null = root session
  anchorMessageId: string;
  selectedText: string;
  parentMessageText: string;
  prompt?: string; // typed at the selection: sent as the thread's first message
}

// fetch says only "network error" when the stream breaks, e.g. when the dev
// server restarts. Say what that means instead.
function runError(e: unknown) {
  return e instanceof TypeError
    ? "Lost the connection to Vlens mid-reply. Claude may still finish: the session updates here when it does."
    : String(e);
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
        case "status":
          patch((r) => ({ ...r, status: ev.status }));
          break;
        case "task":
          patch((r) => ({ ...r, tasks: { ...r.tasks, [ev.task.id]: ev.task } }));
          break;
        case "done": {
          on.done(ev.message);
          const said = ev.message.blocks.map((b) => (b.kind === "text" ? b.text : "")).join(" ").trim();
          notify("Claude finished", said || "The reply is ready.", { tag: "lens-done" });
          break;
        }
        case "permission": {
          const ask: PermissionAsk = { id: ev.id, tool: ev.tool, input: ev.input, description: ev.description, reason: ev.reason, always: ev.always, questions: ev.questions, plan: ev.plan };
          // Claude is waiting on you: say so if you're looking at another window.
          if (ev.plan !== undefined) notify("Claude's plan is ready", "Open Vlens to approve it or keep planning.", { tag: `ask-${ev.id}` });
          else if (ev.questions) notify("Claude has a question", ev.questions[0]?.question ?? "Open Vlens to answer.", { tag: `ask-${ev.id}` });
          else notify(`Claude wants to use ${ev.tool}`, ev.description ?? "Open Vlens to allow or deny it.", { tag: `ask-${ev.id}` });
          patch((r) => ({ ...r, asks: [...(r.asks ?? []), ask] }));
          break;
        }
        case "permission_done":
          patch((r) => ({ ...r, asks: (r.asks ?? []).filter((a) => a.id !== ev.id) }));
          break;
        case "error":
          patch((r) => ({ ...r, error: ev.error }));
          break;
      }
    }
  }
}

export type RootMode = PermissionMode;

// A reply in progress in a main session: the prompt just sent, how many
// messages the session had before it (the CLI writes the session file as it
// goes, so anything past that count is shown from the live stream instead),
// and the key of its stream in the `live` map.
export interface RootRun {
  message: ChatMessage;
  base: number;
  runId: string;
}

function without<T>(rec: Record<string, T>, key: string) {
  const next = { ...rec };
  delete next[key];
  return next;
}

export function useTreeChat() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [threads, setThreads] = useState<Record<string, SubThread>>({});
  const [drafts, setDrafts] = useState<Set<string>>(new Set()); // opened but nothing sent yet
  const [stack, setStack] = useState<string[]>([]); // open panels, root-most first
  const [live, setLive] = useState<Record<string, LiveRun>>({});
  // The open session's Claude between replies (background work), if Vlens has one open.
  const [liveState, setLiveState] = useState<LiveState | null>(null);
  const aborts = useRef<Record<string, AbortController>>({});
  // Replies in progress, by session id (or a new session's draft key until its
  // id arrives). Each belongs to its own session: switching to another one
  // neither shows it there nor stops it, and several sessions can reply at once.
  const [rootRuns, setRootRuns] = useState<Record<string, RootRun>>({});
  // A session that doesn't exist yet: the user picked "New session" and is choosing a folder.
  const [draft, setDraft] = useState<{ cwd: string } | null>(null);
  // Names that draft in rootRuns; a new one for every "New session".
  const [draftKey, setDraftKey] = useState(() => `new:${crypto.randomUUID()}`);
  const viewRef = useRef<string | null>(null);
  const viewKey = activeId ?? (draft ? draftKey : null);
  viewRef.current = viewKey;
  const rootPending = (viewKey && rootRuns[viewKey]) || null;
  // Last time this app wrote to a session, so the UI can tell our writes from someone else's.
  const [ownWrite, setOwnWrite] = useState<{ id: string; at: number } | null>(null);

  // Sidebar: poll so new CLI sessions show up on their own.
  // A terminal or desktop-app session that stops to ask you something (a
  // permission prompt, a question) or finishes gets a notification, like the
  // terminal's bell. (Vlens's own runs notify from their stream.)
  const lastStatus = useRef<Map<string, string> | null>(null);
  const openRef = useRef<(id: string) => void>(() => {});
  const loadSessions = useCallback(
    () =>
      fetch("/api/sessions")
        .then((r) => r.json())
        .then((list: SessionSummary[]) => {
          const before = lastStatus.current;
          const state = (s: SessionSummary) => (!s.active || s.active.byLens ? "off" : s.active.waitingFor ? "waiting" : s.active.status);
          if (before)
            for (const s of list) {
              const was = before.get(s.id);
              const open = () => openRef.current(s.id);
              if (state(s) === "waiting" && was !== "waiting")
                notify(`Claude needs you: ${s.title}`, `${s.projectName}: ${s.active!.waitingFor}.`, { tag: `s-${s.id}`, onClick: open });
              else if (was === "busy" && state(s) === "idle")
                notify(s.title, `Claude finished in ${s.projectName} and is waiting for you.`, { tag: `s-${s.id}`, onClick: open });
            }
          lastStatus.current = new Map(list.map((s) => [s.id, state(s)]));
          setSessions(list);
        })
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    loadSessions();
    const t = setInterval(loadSessions, 5000);
    return () => clearInterval(t);
  }, [loadSessions]);

  // Plan usage (5h / weekly). Reading is free; any Vlens run updates it on the
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

  // Vlens settings (default model, auto-restore, terminal app).
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});
  }, []);
  useEffect(() => setNotifications(settings?.notifications !== false), [settings?.notifications]);
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
  const forgetRecent = (id: string) =>
    manage(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ recent: false }) });
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

  // Claude working on its own (a background task reported back) is news too:
  // a question it asks you then, and when it's done.
  const lastLive = useRef<LiveState | null>(null);
  const noteLive = useCallback((l: LiveState | null, title?: string) => {
    const prev = lastLive.current;
    lastLive.current = l;
    const name = title ?? "Your session";
    for (const a of l?.asks ?? [])
      if (!prev?.asks.some((p) => p.id === a.id))
        notify(a.plan !== undefined ? "Claude's plan is ready" : a.questions ? "Claude has a question" : `Claude wants to use ${a.tool}`, `${name}: ${a.questions?.[0]?.question ?? a.description ?? "Open Vlens to answer."}`, { tag: `ask-${a.id}` });
    if (prev?.busy && l && !l.busy) notify(name, "Claude finished an update from its background work.", { tag: `bg-${activeIdRef.current}` });
  }, []);

  // Open session: poll too, so a session running in the terminal updates live,
  // and so does Vlens's own Claude when background work reports back. Faster
  // while something is going on.
  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    let lastUpdated = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let title: string | undefined;
    setLoadingSession(true);
    setLiveState(null);
    lastLive.current = null;
    const load = () =>
      fetch(`/api/sessions/${activeId}${lastUpdated ? `?since=${encodeURIComponent(lastUpdated)}` : ""}`)
        .then((r) => r.json())
        .then((d: { session?: SessionDetail; unchanged?: true; threads: SubThread[]; live?: LiveState | null }) => {
          if (stop || (!d.session && !d.unchanged)) return;
          setLoadingSession(false);
          if (d.session && d.session.updatedAt !== lastUpdated) {
            lastUpdated = d.session.updatedAt;
            setSession(d.session);
          }
          setThreads((prev) => {
            const next = { ...prev };
            for (const t of d.threads) if (!aborts.current[t.id]) next[t.id] = t;
            return next;
          });
          title = d.session?.title ?? title;
          noteLive(d.live ?? null, title);
          setLiveState(d.live ?? null);
          return d.live;
        })
        .catch(() => null)
        .then((live) => {
          if (stop) return;
          const going = !!live && (live.busy || live.asks.length > 0 || live.tasks.some((t) => t.status === "running"));
          timer = setTimeout(load, going ? 1000 : 3000);
        });
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [activeId, noteLive]);

  // Stop what Claude is doing on its own (a background task reported back).
  const stopLive = useCallback(async () => {
    if (activeIdRef.current) await fetch(`/api/sessions/${activeIdRef.current}/live`, { method: "DELETE" }).catch(() => {});
  }, []);

  // A reply that ended in an error stays on screen until you leave its session.
  const dropFinished = useCallback(() => {
    setRootRuns((all) => {
      const left = Object.fromEntries(Object.entries(all).filter(([, r]) => aborts.current[r.runId]));
      for (const [, r] of Object.entries(all)) if (!aborts.current[r.runId]) setLive((l) => without(l, r.runId));
      return Object.keys(left).length === Object.keys(all).length ? all : left;
    });
  }, []);

  const selectSession = useCallback((id: string) => {
    // Clicking the session that's already open: keep it (clearing it here would
    // leave the chat blank, since the loader only runs when the id changes).
    if (id === activeIdRef.current) return;
    setActiveId(id);
    setSession(null);
    setStack([]);
    setThreads({});
    dropFinished();
    setDraft(null);
  }, [dropFinished]);
  openRef.current = selectSession; // a notification click opens its session

  // Back to the home dashboard: nothing open.
  const goHome = useCallback(() => {
    setActiveId(null);
    setSession(null);
    setStack([]);
    setThreads({});
    dropFinished();
    setDraft(null);
  }, [dropFinished]);

  const newSession = useCallback((cwd = "") => {
    setActiveId(null);
    setSession(null);
    setStack([]);
    setThreads({});
    dropFinished();
    setDraft({ cwd });
    setDraftKey(`new:${crypto.randomUUID()}`);
  }, [dropFinished]);

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
      if (src.prompt) firstPrompts.current[id] = src.prompt;
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
  const firstPrompts = useRef<Record<string, string>>({});

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
      setLive((l) => ({ ...l, [threadId]: { text: "", tools: [], startedAt: Date.now() } }));

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
        if ((e as Error).name !== "AbortError") patchLive((r) => ({ ...r, error: runError(e) }));
      } finally {
        delete aborts.current[threadId];
      }
    },
    [threads, drafts],
  );

  // A question typed at the selection goes out once its new thread is in state
  // (send reads the thread, so it can't run in the same tick as spawnThread).
  useEffect(() => {
    for (const [id, prompt] of Object.entries(firstPrompts.current))
      if (threads[id]) {
        delete firstPrompts.current[id];
        void send(id, prompt);
      }
  }, [threads, send]);

  const sendRoot = useCallback(
    // newIn: start a brand-new session in this folder instead (e.g. from Vlens Review).
    // onId: told the new session's id as soon as Claude reports it.
    async (prompt: string, mode: RootMode, model?: string, images: ImageInput[] = [], newIn?: string, onId?: (id: string) => void) => {
      const cur = newIn ? null : session;
      const cwd = newIn ?? draft?.cwd;
      let key = newIn ? `new:${crypto.randomUUID()}` : (cur?.id ?? draftKey);
      if ((!cur && !cwd) || (rootRuns[key] && aborts.current[rootRuns[key].runId])) return;
      if (newIn) {
        setActiveId(null);
        setSession(null);
        setStack([]);
        setThreads({});
        setDraft({ cwd: newIn });
        setDraftKey(key);
      }
      // For a new session the id arrives in the stream's "session" event.
      let sessionId = cur?.id ?? null;
      const runId = `root:${crypto.randomUUID()}`;
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        parentId: cur?.messages.at(-1)?.id ?? null,
        role: "user",
        blocks: [...(prompt ? [{ kind: "text" as const, text: prompt }] : []), ...imageBlocks(images)],
        timestamp: new Date().toISOString(),
      };
      const old = rootRuns[key]?.runId;
      if (old) setLive((l) => without(l, old));
      setRootRuns((all) => ({ ...all, [key]: { message, base: cur?.messages.length ?? 0, runId } }));
      setLive((l) => ({ ...l, [runId]: { text: "", tools: [], startedAt: Date.now() } }));
      const ac = new AbortController();
      aborts.current[runId] = ac;
      const patch = (fn: (r: LiveRun) => LiveRun) => setLive((l) => (l[runId] ? { ...l, [runId]: fn(l[runId]) } : l));
      // Swap the live view for the saved session only once the new file is loaded, so nothing flickers.
      // Only if you're still looking at it: never pull you back from another session.
      const finish = async () => {
        if (sessionId) setOwnWrite({ id: sessionId, at: Date.now() });
        const watching = viewRef.current === key;
        const d = sessionId && watching ? await fetch(`/api/sessions/${sessionId}`).then((r) => r.json()) : {};
        if (d.session && viewRef.current === key) {
          setSession(d.session);
          setActiveId(d.session.id);
          setDraft(null);
          setLiveState(d.live ?? null); // background work carries on from the reply's
        }
        setRootRuns((all) => without(all, key));
        setLive((l) => without(l, runId));
        void loadSessions();
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
          session: (id) => {
            sessionId = id;
            // From now on the run belongs to the session's real id, so opening
            // it from the sidebar (even after looking elsewhere) shows it live.
            if (key !== id) {
              const from = key;
              key = id;
              setRootRuns((all) => (all[from] ? { ...without(all, from), [id]: all[from] } : all));
              // Still looking at it as the new-session draft: keep looking (its file
              // may not be written yet, so it only becomes the open session at the end).
              if (viewRef.current === from) {
                viewRef.current = id;
                setDraftKey(id);
              }
            }
            onId?.(id);
          },
          done: () => void finish(),
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") void finish();
        else patch((r) => ({ ...r, error: runError(e) }));
      } finally {
        delete aborts.current[runId];
      }
    },
    [session, draft, draftKey, rootRuns, loadSessions],
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
    liveState,
    stopLive,
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
    goHome,
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
    forgetRecent,
    endSession,
    deleteSession,
  };
}

export type TreeChat = ReturnType<typeof useTreeChat>;
