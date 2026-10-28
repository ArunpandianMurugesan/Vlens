"use client";

import { Check, Loader2, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { answerPermission, answerQuestions, type PermissionAsk } from "@/hooks/useTreeChat";
import type { Question } from "@/lib/types";

const OTHER = "__other__";

// Claude is asking you something (AskUserQuestion), like the picker in the terminal.
// Pick an option per question (or type your own), then send.
export function QuestionCard({ ask }: { ask: PermissionAsk }) {
  const questions = ask.questions ?? [];
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<"send" | "skip" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (qi: number, label: string, multi?: boolean) =>
    setPicked((p) => {
      const cur = p[qi] ?? [];
      if (!multi) return { ...p, [qi]: [label] };
      return { ...p, [qi]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
    });

  const answerFor = (qi: number) =>
    (picked[qi] ?? [])
      .map((l) => (l === OTHER ? other[qi]?.trim() ?? "" : l))
      .filter(Boolean)
      .join(", ");
  const ready = questions.length > 0 && questions.every((_, qi) => answerFor(qi));

  const send = async () => {
    setBusy("send");
    setErr(null);
    try {
      await answerQuestions(ask.id, Object.fromEntries(questions.map((q, qi) => [q.question, answerFor(qi)])));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };
  const skip = async () => {
    setBusy("skip");
    setErr(null);
    try {
      await answerPermission(ask.id, "deny");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50";
  return (
    <div className="rounded-xl border border-accent/40 bg-accent-soft/40 p-3" data-no-select>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <MessageCircleQuestion size={15} className="text-accent" />
        Claude has {questions.length > 1 ? `${questions.length} questions` : "a question"} for you
      </div>
      <div className="mt-2 space-y-3">
        {questions.map((q, qi) => (
          <div key={qi}>
            <div className="mb-1.5 text-sm">
              {q.header && <span className="mr-1.5 rounded bg-sunken px-1.5 py-0.5 text-[0.68rem] font-medium text-muted">{q.header}</span>}
              {q.question}
              {q.multiSelect && <span className="ml-1 text-xs text-muted">(pick any)</span>}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {[...q.options, { label: OTHER, description: "Type your own answer" }].map((o) => {
                const on = (picked[qi] ?? []).includes(o.label);
                return (
                  <button
                    key={o.label}
                    disabled={!!busy}
                    onClick={() => toggle(qi, o.label, q.multiSelect)}
                    className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs ${
                      on ? "border-accent bg-panel" : "border-line bg-panel/60 hover:border-accent/60"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${q.multiSelect ? "rounded" : "rounded-full"} ${
                        on ? "border-accent bg-accent text-white" : "border-line"
                      }`}
                    >
                      {on && <Check size={10} />}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">{o.label === OTHER ? "Other" : o.label}</span>
                      {o.description && <span className="block text-muted">{o.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {(picked[qi] ?? []).includes(OTHER) && (
              <input
                autoFocus
                value={other[qi] ?? ""}
                onChange={(e) => setOther((o) => ({ ...o, [qi]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && ready && !busy && send()}
                placeholder="Your answer"
                className="mt-1.5 w-full rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs outline-none focus:border-accent"
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button className={`${btn} bg-accent text-white`} disabled={!ready || !!busy} onClick={send}>
          {busy === "send" && <Loader2 size={12} className="animate-spin" />} Send {questions.length > 1 ? "answers" : "answer"}
        </button>
        <button className={`${btn} text-muted hover:text-ink`} disabled={!!busy} onClick={skip} title="Claude carries on without an answer">
          {busy === "skip" && <Loader2 size={12} className="animate-spin" />} Skip
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}

// Reads the answers back out of the tool's result text:
// `... "Which color?"="Blue", "Size?"="M". You can now continue ...`
function parseAnswers(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)+)"="((?:[^"\\]|\\.)*)"/g)) out.set(m[1], m[2]);
  return out;
}

// A question Claude asked earlier in the session (or is asking in a terminal):
// shows the choices and what you picked. Read-only.
export function QuestionRecord({ input, result }: { input: unknown; result?: { text: string; isError: boolean } }) {
  const questions = ((input as { questions?: Question[] } | null)?.questions ?? []).filter((q) => q?.question);
  if (!questions.length) return null;
  const answers = result && !result.isError ? parseAnswers(result.text) : new Map<string, string>();
  return (
    <div className="rounded-lg border border-line bg-sunken/60 px-3 py-2 text-[0.8rem]" data-no-select>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
        <MessageCircleQuestion size={13} className={result ? "" : "animate-pulse text-accent"} />
        {result ? (result.isError ? "Question skipped" : "Claude asked") : "Waiting for an answer…"}
      </div>
      <div className="space-y-1.5">
        {questions.map((q, i) => {
          const a = answers.get(q.question);
          const picks = new Set(a?.split(", "));
          return (
            <div key={i}>
              <div>{q.question}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {q.options.map((o) => (
                  <span
                    key={o.label}
                    title={o.description}
                    className={`rounded-md border px-1.5 py-0.5 text-[0.72rem] ${picks.has(o.label) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`}
                  >
                    {picks.has(o.label) && <Check size={10} className="mr-0.5 inline" />}
                    {o.label}
                  </span>
                ))}
                {a && !q.options.some((o) => picks.has(o.label)) && (
                  <span className="rounded-md border border-accent bg-accent-soft px-1.5 py-0.5 text-[0.72rem] text-accent">
                    <Check size={10} className="mr-0.5 inline" />
                    {a}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
