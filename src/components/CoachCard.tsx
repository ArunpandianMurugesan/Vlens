"use client";

import { AlertTriangle, BookOpen, Check, ChevronRight, FileText, GraduationCap, Loader2, MessageSquareWarning, Plus, ScrollText, Timer, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { TreeChat } from "@/hooks/useTreeChat";
import type { CoachData, CoachSignal, Lesson, Settings } from "@/lib/types";

// Other parts of Home (a Retro button on a session row) ask the card to refresh.
export const COACH_RELOAD = "lens:coach-reload";

export async function runRetro(sessionId: string) {
  const res = await fetch("/api/coach/retro", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error ?? res.statusText);
  window.dispatchEvent(new Event(COACH_RELOAD));
}

const ICON: Record<CoachSignal["kind"], typeof Timer> = {
  errors: AlertTriangle,
  corrections: MessageSquareWarning,
  longlived: Timer,
  rereads: FileText,
  pastes: ScrollText,
};

const projectOf = (cwd: string | null) => (cwd ? cwd.split("/").filter(Boolean).pop() ?? cwd : "No project");
const btn = "inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";

async function patchLesson(body: Record<string, unknown>) {
  const res = await fetch("/api/coach/lessons", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
}

function LessonRow({ l, settings, onChanged, onError }: { l: Lesson; settings: Settings; onChanged: () => void; onError: (e: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      await patchLesson({ id: l.id, ...body });
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
    setBusy(null);
  };
  const apply = async (target: "project" | "user") => {
    if (target === "project" && l.cwd) {
      // A committed CLAUDE.md is your team's too: say so first.
      const r = await fetch("/api/coach/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkTracked: l.cwd }) });
      const { tracked } = await r.json().catch(() => ({ tracked: false }));
      if (tracked && !window.confirm(`${projectOf(l.cwd)}/CLAUDE.md is committed to git, so your team will see this lesson once you commit it. Add it there anyway?`)) return;
    }
    void act(target, { apply: target });
  };
  const spin = (k: string) => busy === k && <Loader2 size={11} className="animate-spin" />;

  return (
    <li className="flex flex-wrap items-center gap-1.5 border-t border-line py-2 first:border-t-0">
      <span className="mb-0.5 w-full text-sm">{l.text}</span>
      {l.applied ? (
        <>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.68rem] text-emerald-600">
            <Check size={10} /> in {l.applied === "user" ? "~/.claude/CLAUDE.md" : `${projectOf(l.cwd)}/CLAUDE.md`}
          </span>
          <button className={btn} disabled={!!busy} onClick={() => act("undo", { apply: null })} title="Take it out of CLAUDE.md (keep it here)">
            {spin("undo") || <Undo2 size={11} />} Take out
          </button>
        </>
      ) : settings.lessonsToClaudeMd ? (
        <>
          {l.cwd && (
            <button className={`${btn} ${settings.lessonsTarget === "project" ? "border-accent/50 text-accent" : ""}`} disabled={!!busy} onClick={() => apply("project")} title={`Add to ${l.cwd}/CLAUDE.md`}>
              {spin("project") || <Plus size={11} />} This project
            </button>
          )}
          <button className={`${btn} ${settings.lessonsTarget === "user" || !l.cwd ? "border-accent/50 text-accent" : ""}`} disabled={!!busy} onClick={() => apply("user")} title="Add to ~/.claude/CLAUDE.md (only you, every project)">
            {spin("user") || <Plus size={11} />} All projects
          </button>
        </>
      ) : (
        <span className="text-[0.68rem] text-muted">kept in Lens</span>
      )}
      <button className="ml-auto rounded p-1 text-muted hover:text-red-600" disabled={!!busy} onClick={() => act("remove", { remove: true })} aria-label="Delete lesson" title="Delete (also removes it from CLAUDE.md)">
        {spin("remove") || <Trash2 size={12} />}
      </button>
    </li>
  );
}

function SignalRow({ s, chat, settings, onChanged, onError }: { s: CoachSignal; chat: TreeChat; settings: Settings; onChanged: () => void; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const Icon = ICON[s.kind];
  const retro = async () => {
    setBusy(true);
    try {
      await runRetro(s.sessionId!);
    } catch (e) {
      onError((e as Error).message);
    }
    setBusy(false);
  };
  const save = async () => {
    if (!draft?.trim()) return;
    const res = await fetch("/api/coach/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: draft, cwd: s.cwd ?? null }) });
    if (!res.ok) return onError("Couldn't save the lesson.");
    setDraft(null);
    onChanged();
  };
  return (
    <li className="flex gap-3 border-t border-line py-2.5 first:border-t-0">
      <Icon size={15} className="mt-0.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{s.title}</div>
        <div className="text-xs text-muted">{s.detail}</div>
        {draft !== null && (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs outline-none focus:border-accent" />
            <button className={btn}>Save lesson</button>
          </form>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {s.sessionId && (
            <button className={btn} onClick={() => chat.selectSession(s.sessionId!)}>
              <ChevronRight size={11} /> Open session
            </button>
          )}
          {s.sessionId && settings.retro && (
            <button className={btn} disabled={busy} onClick={retro}>
              {busy ? <Loader2 size={11} className="animate-spin" /> : <GraduationCap size={11} />} {busy ? "Reviewing…" : "Retro"}
            </button>
          )}
          {s.lesson && draft === null && (
            <button className={btn} onClick={() => setDraft(s.lesson!)}>
              <Plus size={11} /> Add as lesson
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// The coach on Home: habits worth fixing from your week, retros, and the lessons
// they produced (which can go into CLAUDE.md, inside a block Lens owns).
export function CoachCard({ chat }: { chat: TreeChat }) {
  const settings = chat.settings;
  const [data, setData] = useState<CoachData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openRetro, setOpenRetro] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/coach").catch(() => null);
    if (res?.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener(COACH_RELOAD, reload);
    return () => window.removeEventListener(COACH_RELOAD, reload);
  }, [load]);

  if (!settings?.coach) return null;
  const byProject = new Map<string, Lesson[]>();
  for (const l of data?.lessons ?? []) byProject.set(projectOf(l.cwd), [...(byProject.get(projectOf(l.cwd)) ?? []), l]);

  return (
    <section className="rounded-2xl border border-line bg-panel p-4 lg:col-span-3">
      <div className="mb-3 flex items-center gap-2">
        <GraduationCap size={15} className="text-accent" />
        <h2 className="text-sm font-medium">Coach</h2>
        <span className="text-xs text-muted">from your sessions this week</span>
      </div>
      {err && <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-600">{err}</p>}
      {!data ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Reading this week’s sessions…
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Fix this now</h3>
            {data.signals.length ? (
              <ul>
                {data.signals.map((s) => (
                  <SignalRow key={s.id} s={s} chat={chat} settings={settings} onChanged={load} onError={setErr} />
                ))}
              </ul>
            ) : (
              <p className="py-2 text-sm text-muted">Nothing stands out this week. Nice.</p>
            )}
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                <BookOpen size={12} /> Lessons
              </h3>
              {byProject.size ? (
                [...byProject.entries()].map(([project, list]) => (
                  <div key={project} className="mb-2">
                    <div className="text-xs font-medium">{project}</div>
                    <ul>
                      {list.map((l) => (
                        <LessonRow key={l.id} l={l} settings={settings} onChanged={load} onError={setErr} />
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="py-1 text-sm text-muted">
                  {settings.retro ? "Run a Retro on a session to get lessons for next time." : "Retros are off in Settings → Coach."}
                </p>
              )}
            </div>
            {data.retros.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Recent retros</h3>
                <ul>
                  {data.retros.slice(0, 4).map((r) => (
                    <li key={r.sessionId} className="border-t border-line py-1.5 first:border-t-0">
                      <button onClick={() => setOpenRetro((o) => (o === r.sessionId ? null : r.sessionId))} className="flex w-full items-center gap-1.5 text-left text-sm hover:text-accent">
                        <ChevronRight size={12} className={`shrink-0 transition-transform ${openRetro === r.sessionId ? "rotate-90" : ""}`} />
                        <span className="truncate">{r.title}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted">{projectOf(r.cwd)}</span>
                      </button>
                      {openRetro === r.sessionId && (
                        <div className="mt-1.5 space-y-1.5 pl-5 text-xs">
                          {r.wentWell.map((w, i) => (
                            <p key={`w${i}`} className="text-emerald-700 dark:text-emerald-400">✓ {w}</p>
                          ))}
                          {r.mistakes.map((m, i) => (
                            <p key={`m${i}`} className="text-amber-700 dark:text-amber-400">! {m}</p>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
