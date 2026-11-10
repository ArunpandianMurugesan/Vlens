"use client";

import { AlertTriangle, Check, ChevronRight, Loader2, X } from "lucide-react";
import { useState } from "react";
import { BRAIN_LABEL, type BotFile, type BotFiles, type Change, type FileError, type FileTrigger, playbookParts } from "@/lib/botFile";
import { LEVELS } from "@/lib/botAbilities";
import { sourceOf } from "@/lib/botTriggers";
import { Markdown } from "./Markdown";

// A bot's files (agent.yaml + PLAYBOOK.md, lib/botFile.ts) shown as readable
// pages, an editor for both, and the review before applying a change: what
// changes, its check commands tried once, the apps it needs, and anything wrong.
// Used by Configuration and Create.

export type FileCheck = {
  ok: boolean;
  errors: FileError[];
  changes: Change[];
  runs: { trigger: string; ok: boolean; found?: number; sample?: string[]; error?: string }[];
  apps: { name: string; status: string }[];
};

const tone = { on: "bg-green-500/15 text-green-700 dark:text-green-400", ask: "bg-amber-500/15 text-amber-700 dark:text-amber-400", never: "bg-red-500/15 text-red-700 dark:text-red-400" } as const;
const appName = (n: string) => n.replace(/^claude\.ai /, "");

function Part({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 py-3 first:pt-0 md:grid-cols-[6.5rem_1fr]">
      <div className="pt-0.5 text-[0.65rem] font-bold tracking-wide text-accent">{k}</div>
      <div className="min-w-0 text-[0.85rem] leading-relaxed">{children}</div>
    </div>
  );
}

const Bullets = ({ xs, empty }: { xs: string[]; empty: string }) =>
  xs.length ? (
    <ul className="list-disc space-y-0.5 pl-4">
      {xs.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  ) : (
    <span className="text-muted">{empty}</span>
  );

// One trigger in plain words: what wakes it, and its settings.
export function triggerText(t: FileTrigger) {
  const src = sourceOf(t.source);
  const p = t.params;
  if (t.source === "time") return `At ${p.at ?? "09:00"}${p.days ? ` on ${p.days}` : ", every day"}`;
  if (t.kind === "session") return `When a session ${t.event === "idle" ? `goes quiet for ${t.idleMinutes} min` : t.event === "started" ? "starts" : "ends"} in ${t.folders === "all" || !t.folders.length ? "any folder" : t.folders.join(", ")}`;
  if (t.source === "command" || !src) return `Every ${t.everyMinutes} min, its own check`;
  const repos = (p.repos ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const extra = [repos.length && (repos.length > 3 ? `in ${repos.length} repos` : `in ${repos.join(", ")}`), p.agent && `agent ${p.agent}`, p.jql && `“${p.jql}”`, p.query && `“${p.query}”`].filter(Boolean).join(" · ");
  return `${src.label}${extra ? ` (${extra})` : ""}`;
}

function Triggers({ file }: { file: BotFile }) {
  const [cmds, setCmds] = useState(false);
  if (!file.when.length) return <span className="text-muted">Only when you message it.</span>;
  return (
    <ul className="space-y-1.5">
      {file.when.map((t, i) => (
        <li key={i}>
          <span className={t.on ? "" : "text-muted line-through"}>{triggerText(t)}</span>: <b className="font-medium">{t.name}</b>
          {t.playbook && <span className="ml-1.5 rounded-md bg-accent-soft px-1.5 py-0.5 text-[0.65rem] text-accent">follows “{t.playbook}”</span>}
          {!t.on && <span className="ml-1.5 text-xs text-muted">(paused)</span>}
          {cmds && (t.check || t.match) && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-term px-2.5 py-1.5 font-mono text-[0.7rem] text-term-ink scroll-thin">{t.check || `match: ${t.match}`}</pre>}
        </li>
      ))}
      {file.when.some((t) => t.check || t.match) && (
        <button onClick={() => setCmds((v) => !v)} className="text-xs text-muted hover:text-ink">
          {cmds ? "Hide the commands" : "Show the commands"}
        </button>
      )}
    </ul>
  );
}

export function limitsText(l: BotFile["limits"]) {
  const bits = [l.quietHours && `asleep ${l.quietHours.replace("-", "–")}`, l.weekdaysOnly && "weekdays only", l.maxRunsPerDay && `at most ${l.maxRunsPerDay} runs a day`].filter(Boolean);
  return bits.length ? bits.join(" · ") : "";
}

// agent.yaml as a page: connectors, what it may do, what it knows, off limits, limits.
export function AgentView({ file }: { file: BotFile }) {
  const [others, setOthers] = useState(false);
  const raw: ["on" | "ask" | "never", string][] = [...file.raw.allow.map((r) => ["on", r] as ["on", string]), ...file.raw.ask.map((r) => ["ask", r] as ["ask", string]), ...file.raw.never.map((r) => ["never", r] as ["never", string])];
  return (
    <div className="divide-y divide-line">
      <Part k="CONNECTORS">{file.apps.length ? file.apps.map(appName).join(" · ") : <span className="text-muted">None. GitHub works through the gh command.</span>}</Part>
      {(file.model || file.mode || file.effort) && <Part k="MODEL">{[file.model || "default model", file.effort && `${file.effort} effort`, file.mode && `${file.mode} mode`].filter(Boolean).join(" · ")}</Part>}
      <Part k="MAY DO">
        <div className="space-y-1">
          {file.mayDo.map((m) => (
            <div key={m.label} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">{m.label}</span>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${tone[m.level]}`}>{LEVELS.find((l) => l.id === m.level)!.label}</span>
            </div>
          ))}
          {raw.length > 0 && (
            <button onClick={() => setOthers((v) => !v)} className="flex items-center gap-1 text-xs text-muted hover:text-ink">
              <ChevronRight size={12} className={`transition-transform ${others ? "rotate-90" : ""}`} /> {raw.length} more specific rule{raw.length === 1 ? "" : "s"}
            </button>
          )}
          {others &&
            raw.map(([l, r]) => (
              <div key={l + r} className="flex items-center gap-2 pl-4">
                <code className="min-w-0 flex-1 truncate font-mono text-[0.7rem]">{r}</code>
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.65rem] ${tone[l]}`}>{LEVELS.find((x) => x.id === l)!.label}</span>
              </div>
            ))}
        </div>
      </Part>
      <Part k="KNOWS">
        <ul className="space-y-0.5">
          <li>
            Vlens brain: <b className="font-medium">{BRAIN_LABEL[file.brain]}</b>
            {file.brain !== "off" && <span className="text-muted"> · {file.brainFolders === "all" ? "memories from all folders" : `memories from ${file.brainFolders.join(", ")}`}</span>}
          </li>
          {file.brain === "remember" && (
            <li>
              The brain learns from: <b className="font-medium">{file.brainLearn === "off" ? "off" : file.brainLearn === "all" ? "all your sessions" : file.brainLearn.join(", ")}</b>
            </li>
          )}
          <li>Your Claude sessions: {file.sessions === "all" ? "all folders (read only)" : file.sessions?.length ? `${file.sessions.join(", ")} (read only)` : "off"}</li>
          {file.confluence.length > 0 && <li>Confluence: {file.confluence.map((c) => c.title || c.id).join(", ")}</li>}
          <li>Skills: {file.skills === "all" ? "all of yours" : file.skills.join(", ") || "none"}</li>
        </ul>
      </Part>
      {file.offLimits.length > 0 && (
        <Part k="OFF LIMITS">
          <Bullets xs={file.offLimits} empty="" />
        </Part>
      )}
      <Part k="LIMITS">{limitsText(file.limits) || <span className="text-muted">Any time, no daily limit.</span>}</Part>
    </div>
  );
}

// PLAYBOOK.md as a page: what it does when woken, its parts, and its two lists.
export function PlaybookView({ file, clamp = false }: { file: BotFile; clamp?: boolean }) {
  const [all, setAll] = useState(!clamp);
  const parts = playbookParts(file.operations);
  return (
    <div className="divide-y divide-line">
      <Part k="PLAYBOOK">
        {file.operations ? (
          <>
            <div className={all ? "" : "line-clamp-3"}>
              <Markdown text={file.operations} />
            </div>
            {clamp && (
              <button onClick={() => setAll((v) => !v)} className="mt-1 text-xs text-muted hover:text-ink">
                {all ? "Show less" : "Show all"}
              </button>
            )}
          </>
        ) : (
          <span className="text-muted">No playbook yet.</span>
        )}
      </Part>
      {parts.length > 0 && (
        <Part k="PARTS">
          <ul className="space-y-0.5">
            {parts.map((x) => {
              const by = file.when.filter((t) => t.playbook === x);
              return (
                <li key={x}>
                  <b className="font-medium">{x}</b> <span className="text-muted">{by.length ? `· followed by ${by.map((t) => `“${t.name}”`).join(", ")}` : "· no trigger names it"}</span>
                </li>
              );
            })}
          </ul>
        </Part>
      )}
      <Part k="WHERE IT LOOKS">
        <Bullets xs={file.think} empty="What you tell it in chat." />
      </Part>
      <Part k="WHAT IT DOES">
        <Bullets xs={file.act} empty="Nothing written yet." />
      </Part>
    </div>
  );
}

// Both, for a new bot: triggers first.
export function FileView({ file }: { file: BotFile }) {
  return (
    <div className="divide-y divide-line">
      <Part k="WHEN">
        <Triggers file={file} />
        {limitsText(file.limits) && <p className="mt-1 text-xs text-muted">{limitsText(file.limits)}</p>}
      </Part>
      <div className="py-3">
        <PlaybookView file={file} clamp />
      </div>
      <div className="pt-3">
        <AgentView file={file} />
      </div>
    </div>
  );
}

// The two files, edited by hand: one tab each, with what's wrong in each.
export function FilesEditor({ files, onChange, errors }: { files: BotFiles; onChange: (f: BotFiles) => void; errors?: FileError[] }) {
  const [which, setWhich] = useState<"agent" | "playbook">("agent");
  const mine = (errors ?? []).filter((e) => (e.file ?? "agent") === which);
  const count = (w: "agent" | "playbook") => (errors ?? []).filter((e) => (e.file ?? "agent") === w).length;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1 text-xs">
        {(
          [
            ["agent", "agent.yaml"],
            ["playbook", "PLAYBOOK.md"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setWhich(id)} aria-pressed={which === id} className={`rounded-md px-2.5 py-1 font-mono ${which === id ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}>
            {label}
            {count(id) > 0 && <span className="ml-1.5 rounded-full bg-red-500/15 px-1.5 text-[0.65rem] text-red-700 dark:text-red-300">{count(id)}</span>}
          </button>
        ))}
      </div>
      <textarea
        value={files[which]}
        onChange={(e) => onChange({ ...files, [which]: e.target.value })}
        rows={20}
        spellCheck={false}
        aria-label={which === "agent" ? "agent.yaml" : "PLAYBOOK.md"}
        className="w-full resize-y rounded-xl border border-line bg-bg px-3 py-2 font-mono text-[0.75rem] leading-relaxed outline-none focus:border-accent scroll-thin"
      />
      {mine.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-700 dark:text-red-300">
          {mine.map((e, i) => (
            <li key={i}>
              {e.line ? <b>Line {e.line}: </b> : null}
              {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The review before applying: what changes (more access marked), checks tried once, apps, errors.
export function Review({ check, busy, onApply, onEdit, onDiscard, applyLabel = "Apply" }: { check: FileCheck; busy: boolean; onApply: () => void; onEdit?: () => void; onDiscard: () => void; applyLabel?: string }) {
  const more = check.changes.filter((c) => c.widens).length;
  const needsSignIn = check.apps.filter((a) => a.status !== "connected");
  return (
    <div className="space-y-3 rounded-xl border border-accent/40 bg-accent-soft/20 p-4">
      <div className="text-sm font-semibold">Review before it changes</div>
      {check.errors.length > 0 && (
        <div className="space-y-1 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {check.errors.map((e, i) => (
            <div key={i} className="flex gap-1.5">
              <X size={12} className="mt-0.5 shrink-0" />
              <span>
                {e.file || e.line ? <b>{e.file === "playbook" ? "PLAYBOOK.md" : "agent.yaml"}{e.line ? ` line ${e.line}` : ""}: </b> : null}
                {e.message}
              </span>
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="mb-1 text-xs font-semibold text-muted">{check.changes.length ? "What changes" : "Nothing changes"}</div>
        <ul className="space-y-1">
          {check.changes.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-[0.85rem]">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="flex-1">{c.text}</span>
              {c.widens && <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[0.65rem] text-amber-700 dark:text-amber-400">More access</span>}
            </li>
          ))}
        </ul>
      </div>
      {check.runs.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold text-muted">Its checks, tried once</div>
          {check.runs.map((r) => (
            <div key={r.trigger} className="flex items-start gap-2 text-[0.85rem]">
              {r.ok ? <Check size={13} className="mt-0.5 shrink-0 text-green-600" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-600" />}
              <span className="min-w-0 flex-1">
                <b className="font-medium">{r.trigger}</b>: {r.ok ? `found ${r.found}${r.sample?.length ? `, like “${r.sample[0]}”` : ""}` : <span className="text-red-700 dark:text-red-300">{r.error}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {needsSignIn.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Needs sign-in: {needsSignIn.map((a) => appName(a.name)).join(", ")}. It works without them until you sign in.</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button onClick={onApply} disabled={busy || check.errors.length > 0} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {busy && <Loader2 size={12} className="animate-spin" />} {applyLabel}
          {more ? ` (${more} give${more === 1 ? "s" : ""} more access)` : ""}
        </button>
        {onEdit && (
          <button onClick={onEdit} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-accent hover:text-accent">
            Edit by hand
          </button>
        )}
        <button onClick={onDiscard} className="text-xs text-muted hover:text-ink">
          Discard
        </button>
      </div>
    </div>
  );
}
