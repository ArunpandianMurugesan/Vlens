"use client";

import { ArrowUp, Paperclip, Slash, Sparkles, Square, X } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { type Attachment, toAttachment } from "@/lib/clientImages";
import type { ImageInput, SlashCommand } from "@/lib/types";

interface Props {
  placeholder: string;
  running: boolean;
  disabled?: boolean;
  onSend: (text: string, images: ImageInput[]) => void;
  onStop: () => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  footer?: ReactNode; // shown under the text, left of the send button
  cwd?: string | null; // folder of the session; turns on the "/" command menu
}

// Slash commands for a folder. The server may need a moment to learn a new
// folder's list, so ask again once if it comes back empty.
function useCommands(cwd: string | null | undefined) {
  const [cmds, setCmds] = useState<SlashCommand[]>([]);
  useEffect(() => {
    if (cwd === undefined) return;
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;
    const load = (again: boolean) =>
      fetch(`/api/commands${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`)
        .then((r) => r.json())
        .then((c: SlashCommand[]) => {
          if (stop) return;
          setCmds(c);
          if (!c.length && again) retry = setTimeout(() => load(false), 8000);
        })
        .catch(() => {});
    void load(true);
    return () => {
      stop = true;
      clearTimeout(retry);
    };
  }, [cwd]);
  return cmds;
}

export function Composer({ placeholder, running, disabled, onSend, onStop, inputRef, footer, cwd }: Props) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<Attachment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pick, setPick] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  const commands = useCommands(cwd);

  // The menu shows while you're typing the first word and it starts with "/".
  const query = /^\/(\S*)$/.exec(input)?.[1];
  const matches = useMemo(() => {
    if (query === undefined || menuClosed) return [];
    const q = query.toLowerCase();
    const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q));
    const has = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && `${c.name} ${c.description}`.toLowerCase().includes(q));
    return [...starts, ...has].slice(0, 50);
  }, [commands, query, menuClosed]);
  useEffect(() => setPick(0), [query]);

  const add = async (files: File[]) => {
    setErr(null);
    for (const f of files) {
      try {
        const a = await toAttachment(f);
        setImages((prev) => (prev.length >= 10 ? prev : [...prev, a]));
      } catch (e) {
        setErr((e as Error).message);
      }
    }
  };

  const choose = (c: SlashCommand) => {
    setInput(`/${c.name} `);
    setMenuClosed(true);
    ref.current?.focus();
  };

  const submit = () => {
    const t = input.trim();
    if ((!t && !images.length) || running || disabled) return;
    onSend(t, images.map(({ mediaType, data }) => ({ mediaType, data })));
    setInput("");
    setImages([]);
    setErr(null);
  };

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void add([...e.dataTransfer.files]);
      }}
      className={`relative rounded-2xl border bg-bg px-3 py-2 focus-within:border-accent ${dragging ? "border-accent border-dashed" : "border-line"}`}
    >
      {matches.length > 0 && (
        <div className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border border-line bg-panel py-1 shadow-xl scroll-thin">
          {matches.map((c, i) => (
            <button
              key={c.name}
              ref={(el) => {
                if (i === pick) el?.scrollIntoView({ block: "nearest" });
              }}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the text box
              onClick={() => choose(c)}
              onMouseEnter={() => setPick(i)}
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-left ${i === pick ? "bg-sunken" : ""}`}
            >
              {c.kind === "skill" ? (
                <Sparkles size={13} className="mt-0.5 shrink-0 text-accent" />
              ) : (
                <Slash size={13} className="mt-0.5 shrink-0 text-muted" />
              )}
              <span className="min-w-0">
                <span className="font-mono text-xs">/{c.name}</span>
                {c.description && <span className="line-clamp-1 text-xs text-muted">{c.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((im) => (
            <div key={im.id} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- local data: URL preview */}
              <img src={im.preview} alt={im.name} title={im.name} className="h-16 w-16 rounded-lg border border-line object-cover" />
              <button
                onClick={() => setImages((p) => p.filter((x) => x.id !== im.id))}
                aria-label={`Remove ${im.name}`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-bg opacity-0 shadow group-hover:opacity-100 focus:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={ref}
        value={input}
        rows={1}
        onChange={(e) => {
          setInput(e.target.value);
          setMenuClosed(false);
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.items].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
          if (files.length) {
            e.preventDefault();
            void add(files);
          }
        }}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setPick((p) => (p + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault();
              choose(matches[pick]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setMenuClosed(true);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="field-sizing-content max-h-40 w-full resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted"
      />
      {err && <p className="pb-1 text-xs text-red-500">{err}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          aria-label="Attach images"
          title="Attach images (or paste / drop them)"
          className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink disabled:opacity-40"
        >
          <Paperclip size={14} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <div className="min-w-0 flex-1">{footer}</div>
        {running ? (
          <button onClick={onStop} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-bg" aria-label="Stop">
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={(!input.trim() && !images.length) || disabled}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
