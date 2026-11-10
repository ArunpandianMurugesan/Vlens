"use client";

import { Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type BotFile, type BotFiles, editAgent, type FileTrigger, playbookParts } from "@/lib/botFile";
import { GROUP_LABEL, type Source, type SourceGroup, SOURCES, sourceOf } from "@/lib/botTriggers";
import type { Bot } from "@/lib/types";
import { limitsText, triggerText } from "./BotFileView";

// The Triggers tab: what wakes the bot, one card per thing it can watch, like a
// harness agent's on: list. Every switch, add, edit or remove becomes a change
// to agent.yaml that goes through the same Review as any other edit.

type Watch = Record<string, { lastRun: string | null; lastResult: string | null; lastError: string | null }>;
type Doc = Parameters<Parameters<typeof editAgent>[1]>[0];

const GROUPS: SourceGroup[] = ["github", "harness", "gmail", "sessions", "time", "custom"];
const btn = "inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[0.7rem] hover:border-accent hover:text-accent disabled:opacity-50";
const input = "w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-xs outline-none focus:border-accent";

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={`relative h-4 w-7 shrink-0 rounded-full transition ${on ? "bg-green-600" : "bg-line"}`}>
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} />
    </button>
  );
}

// A trigger as agent.yaml writes it (only what's set).
function toYaml(f: Form, src: Source): Record<string, unknown> {
  const o: Record<string, unknown> = { name: f.name.trim(), source: src.id };
  if (!f.on) o.paused = true;
  if (src.group === "github" || src.group === "harness" || src.group === "gmail" || src.id === "command") if (Number(f.every) !== src.every) o.every = Math.max(5, Number(f.every) || src.every);
  for (const p of src.params ?? []) if (f.params[p.key]?.trim()) o[p.key] = f.params[p.key].trim();
  if (src.id === "command") o.check = f.check;
  if (src.group === "sessions") {
    const fs = f.folders.split(",").map((x) => x.trim()).filter(Boolean);
    o.folders = fs.length ? fs : "all";
    if (src.id === "session.idle") o.idleMinutes = Math.max(5, Number(f.idle) || 30);
  }
  if (f.playbook) o.playbook = f.playbook;
  if (f.brief.trim()) o.brief = f.brief.trim();
  return o;
}

type Form = { name: string; on: boolean; every: string; params: Record<string, string>; check: string; folders: string; idle: string; playbook: string; brief: string };
const formOf = (t: FileTrigger | null, src: Source): Form => ({
  name: t?.name ?? src.label.toLowerCase(),
  on: t?.on ?? true,
  every: String(t && t.kind === "schedule" ? t.everyMinutes : src.every),
  params: { ...(t?.params ?? {}) },
  check: t?.check ?? "",
  folders: t && t.folders !== "all" ? t.folders.join(", ") : "",
  idle: String(t?.idleMinutes ?? 30),
  playbook: t?.playbook ?? "",
  brief: t && t.brief.trim() !== src.brief ? t.brief : "",
});

function TriggerForm({ src, start, parts, onSave, onCancel }: { src: Source; start: FileTrigger | null; parts: string[]; onSave: (f: Form) => void; onCancel: () => void }) {
  const [f, setF] = useState<Form>(() => formOf(start, src));
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));
  const missing = (src.params ?? []).filter((p) => p.required && !f.params[p.key]?.trim()).map((p) => p.label);
  if (src.id === "command" && !f.check.trim()) missing.push("check command");
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-accent/40 bg-bg p-2.5">
      <label className="block text-[0.7rem] text-muted">
        Name
        <input value={f.name} onChange={(e) => set("name", e.target.value)} className={input} />
      </label>
      {(src.params ?? []).map((p) => (
        <label key={p.key} className="block text-[0.7rem] text-muted">
          {p.label}
          {p.required ? "" : " (optional)"}
          <input value={f.params[p.key] ?? ""} placeholder={p.placeholder} onChange={(e) => setF((x) => ({ ...x, params: { ...x.params, [p.key]: e.target.value } }))} className={input} />
          <span className="text-[0.65rem]">{p.hint}</span>
        </label>
      ))}
      {src.id === "command" && (
        <label className="block text-[0.7rem] text-muted">
          Check command
          <textarea value={f.check} onChange={(e) => set("check", e.target.value)} rows={3} spellCheck={false} placeholder={'gh search prs … --jq \'.[] | {key, title, url, version}\''} className={`${input} font-mono`} />
        </label>
      )}
      {src.group === "sessions" && (
        <label className="block text-[0.7rem] text-muted">
          Folders
          <input value={f.folders} placeholder="~/Desktop/org_repos (empty: any folder)" onChange={(e) => set("folders", e.target.value)} className={input} />
        </label>
      )}
      {src.id === "session.idle" && (
        <label className="block text-[0.7rem] text-muted">
          Quiet for (min)
          <input type="number" min={5} value={f.idle} onChange={(e) => set("idle", e.target.value)} className={input} />
        </label>
      )}
      {(src.group === "github" || src.group === "harness" || src.group === "gmail" || src.id === "command") && (
        <label className="block text-[0.7rem] text-muted">
          Check every (min, 5 or more)
          <input type="number" min={5} value={f.every} onChange={(e) => set("every", e.target.value)} className={input} />
        </label>
      )}
      <label className="block text-[0.7rem] text-muted">
        Follows
        <select value={f.playbook} onChange={(e) => set("playbook", e.target.value)} className={input}>
          <option value="">its whole playbook</option>
          {parts.map((p) => (
            <option key={p} value={p}>
              the “{p}” part
            </option>
          ))}
        </select>
        {!parts.length && <span className="text-[0.65rem]">Add a “## …” part to PLAYBOOK.md to point a trigger at it.</span>}
      </label>
      <label className="block text-[0.7rem] text-muted">
        What to tell it (optional)
        <textarea value={f.brief} onChange={(e) => set("brief", e.target.value)} rows={2} placeholder={src.brief} className={input} />
      </label>
      <div className="flex items-center gap-2">
        <button onClick={() => onSave(f)} disabled={!f.name.trim() || missing.length > 0} className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
          Review the change
        </button>
        <button onClick={onCancel} className="text-xs text-muted hover:text-ink">
          Cancel
        </button>
        {missing.length > 0 && <span className="text-[0.7rem] text-muted">Needs: {missing.join(", ")}</span>}
      </div>
    </div>
  );
}

export function TriggerBoard({ bot, file, files, saved, onPropose }: { bot: Bot; file: BotFile; files: BotFiles; saved: boolean; onPropose: (agent: string) => void }) {
  const [watch, setWatch] = useState<Watch>({});
  const [form, setForm] = useState<{ src: Source; index: number | null } | null>(null);
  const [tried, setTried] = useState<Record<string, { busy?: boolean; text?: string; ok?: boolean }>>({});
  useEffect(() => {
    fetch(`/api/bots/${bot.id}/watch`)
      .then((r) => r.json())
      .then((d) => setWatch(d.triggers ?? {}))
      .catch(() => {});
  }, [bot.id, bot.triggers]);
  const parts = playbookParts(file.operations);
  const idOf = (t: FileTrigger) => (bot.triggers ?? []).find((x) => x.name === t.name)?.id;
  const edit = (fn: (doc: Doc) => void) => onPropose(editAgent(files.agent, fn));

  const tryNow = async (t: FileTrigger) => {
    const id = idOf(t);
    if (!id) return;
    setTried((x) => ({ ...x, [t.name]: { busy: true } }));
    const d = await fetch(`/api/bots/${bot.id}/watch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: id, action: "list" }) })
      .then((r) => r.json())
      .catch((e) => ({ ok: false, error: (e as Error).message }));
    const items = (d.items ?? []) as { key: string; title: string }[];
    setTried((x) => ({
      ...x,
      [t.name]: d.ok ? { ok: true, text: items.length ? `Would find ${items.length}: ${items.slice(0, 3).map((i) => i.title || i.key).join(" · ")}${items.length > 3 ? " …" : ""}` : "Finds nothing right now." } : { ok: false, text: d.error ?? "It didn't work." },
    }));
  };

  return (
    <div className="space-y-3">
      <Limits file={file} onSave={(l) => edit((doc) => void (doc.limits = l))} />
      <div className="grid gap-3 2xl:grid-cols-2">
        {GROUPS.map((g) => {
          const sources = SOURCES.filter((x) => x.group === g);
          const mine = file.when.map((t, i) => ({ t, i })).filter(({ t }) => sourceOf(t.source)?.group === g);
          const need = sources[0]?.connector;
          const missing = need && !file.apps.includes(need);
          const cost = sources[0]?.cost === "small AI call" ? "small AI call per check" : "free";
          return (
            <section key={g} className={`rounded-xl border bg-panel p-3 ${missing ? "border-dashed border-line" : "border-line"}`}>
              <div className="mb-1.5 flex items-center gap-2">
                <h3 className="text-sm font-semibold">{GROUP_LABEL[g]}</h3>
                <span className="ml-auto text-[0.65rem] text-muted">{g === "github" ? "via gh · " : need ? "connector · " : g === "sessions" ? "on this Mac · " : ""}{cost}</span>
              </div>
              {missing ? (
                <p className="text-xs text-muted">Add the {need} connector under connectors in agent.yaml to use these.</p>
              ) : (
                <>
                  <ul className="divide-y divide-line">
                    {mine.map(({ t, i }) => {
                      const id = idOf(t);
                      const w = id ? watch[id] : undefined;
                      const tr = tried[t.name];
                      return (
                        <li key={i} className="py-1.5">
                          <div className="flex items-center gap-2 text-xs">
                            <Switch on={t.on} label={`${t.name} on or off`} onClick={() => edit((doc) => void (t.on ? (doc.on![i].paused = true) : delete doc.on![i].paused))} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {t.name}
                                {t.playbook && <span className="ml-1.5 rounded bg-accent-soft px-1 text-[0.65rem] font-normal text-accent">follows “{t.playbook}”</span>}
                              </span>
                              <span className="block truncate text-[0.7rem] text-muted" title={triggerText(t)}>
                                {triggerText(t)}
                              </span>
                            </span>
                            {saved && id && (
                              <button onClick={() => void tryNow(t)} disabled={tr?.busy} className={btn} title="What it would find right now. No AI, nothing opened.">
                                {tr?.busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} <span className="whitespace-nowrap">Try now</span>
                              </button>
                            )}
                            <button onClick={() => setForm({ src: sourceOf(t.source)!, index: i })} aria-label={`Edit ${t.name}`} className="text-muted hover:text-accent">
                              <Pencil size={12} />
                            </button>
                            <button onClick={() => edit((doc) => void doc.on!.splice(i, 1))} aria-label={`Remove ${t.name}`} className="text-muted hover:text-red-600">
                              <Trash2 size={12} />
                            </button>
                          </div>
                          {tr?.text && <p className={`mt-1 pl-9 text-[0.7rem] ${tr.ok ? "text-muted" : "text-red-600"}`}>{tr.text}</p>}
                          {!tr?.text && w && (w.lastError || w.lastResult) && <p className={`mt-0.5 pl-9 text-[0.65rem] ${w.lastError ? "text-red-600" : "text-muted"}`}>Last check: {w.lastError ?? w.lastResult}</p>}
                          {form?.index === i && <TriggerForm src={form.src} start={t} parts={parts} onCancel={() => setForm(null)} onSave={(f) => (setForm(null), edit((doc) => void (doc.on![i] = toYaml(f, form.src))))} />}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {sources.map((src) => (
                      <button key={src.id} onClick={() => setForm({ src, index: null })} title={src.hint} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] text-muted hover:bg-sunken hover:text-ink">
                        <Plus size={11} /> {src.label}
                      </button>
                    ))}
                  </div>
                  {form && form.index === null && form.src.group === g && <TriggerForm src={form.src} start={null} parts={parts} onCancel={() => setForm(null)} onSave={(f) => (setForm(null), edit((doc) => void doc.on!.push(toYaml(f, form.src))))} />}
                </>
              )}
            </section>
          );
        })}
      </div>
      {!saved && <p className="text-[0.7rem] text-muted">Try now works once the change is applied.</p>}
    </div>
  );
}

// Quiet hours, weekdays only and a daily limit: when its triggers stay asleep.
function Limits({ file, onSave }: { file: BotFile; onSave: (l: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const q = file.limits.quietHours?.split("-") ?? [];
  const [from, setFrom] = useState(q[0] ?? "");
  const [to, setTo] = useState(q[1] ?? "");
  const [week, setWeek] = useState(!!file.limits.weekdaysOnly);
  const [max, setMax] = useState(file.limits.maxRunsPerDay ? String(file.limits.maxRunsPerDay) : "");
  const save = () => {
    const l: Record<string, unknown> = {};
    if (from && to) l.quietHours = `${from}-${to}`;
    if (week) l.weekdaysOnly = true;
    if (Number(max) > 0) l.maxRunsPerDay = Math.round(Number(max));
    setOpen(false);
    onSave(l);
  };
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <b className="font-medium">When it may run</b>
        <span className="min-w-0 flex-1 truncate text-muted">{limitsText(file.limits) || "Any time, no daily limit"}</span>
        <button onClick={() => setOpen((v) => !v)} className={btn}>
          {open ? "Close" : "Change"}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-end gap-3 text-[0.7rem] text-muted">
          <label>
            Asleep from
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} w-28`} />
          </label>
          <label>
            until
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} w-28`} />
          </label>
          <label className="flex items-center gap-1.5 pb-1.5">
            <input type="checkbox" checked={week} onChange={(e) => setWeek(e.target.checked)} /> Weekdays only
          </label>
          <label>
            At most runs a day
            <input type="number" min={1} value={max} placeholder="no limit" onChange={(e) => setMax(e.target.value)} className={`${input} w-28`} />
          </label>
          <button onClick={save} className="mb-0.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">
            Review the change
          </button>
        </div>
      )}
    </div>
  );
}
