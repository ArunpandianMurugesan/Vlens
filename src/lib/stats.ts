/* eslint-disable @typescript-eslint/no-explicit-any -- reads untyped CLI JSON lines */
import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getAccount } from "./account";
import { contextWindowFor, getLimits } from "./limits";
import { listSessions, PROJECTS_DIR } from "./sessions";
import type { DashboardData, DayStats } from "./types";

// Per-file numbers, re-read only when a session file changes.
interface FileStats {
  days: Record<string, DayStats>; // local date (YYYY-MM-DD) -> activity
  replies: number; // model calls in the session
  compactions: number;
  lastContext: number; // tokens sent with the most recent reply
}
const cache = new Map<string, { mtimeMs: number; stats: FileStats }>();

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const emptyDay = (): DayStats => ({ prompts: 0, replies: 0, toolCalls: 0, tokensSent: 0, tokensWritten: 0 });

function parse(raw: string): FileStats {
  const s: FileStats = { days: {}, replies: 0, compactions: 0, lastContext: 0 };
  for (const line of raw.split("\n")) {
    // Cheap pre-filter: most lines are attachments and tool output.
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"') && !line.includes("compact_boundary")) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.isSidechain || !d.timestamp) continue;
    if (d.subtype === "compact_boundary") {
      s.compactions++;
      continue;
    }
    const day = (s.days[dayKey(d.timestamp)] ??= emptyDay());
    if (d.type === "user" && !d.isMeta && !d.isCompactSummary) {
      const c = d.message?.content;
      const isToolResult = Array.isArray(c) && c.some((b: any) => b?.type === "tool_result");
      if (!isToolResult) day.prompts++;
    } else if (d.type === "assistant") {
      const u = d.message?.usage;
      for (const b of d.message?.content ?? []) if (b?.type === "tool_use") day.toolCalls++;
      if (!u) continue;
      const sent = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      if (sent <= 0) continue;
      // One reply can be split over several lines; count each model call once.
      day.replies++;
      day.tokensSent += sent;
      day.tokensWritten += u.output_tokens ?? 0;
      s.replies++;
      s.lastContext = sent;
    }
  }
  return s;
}

async function fileStats(file: string): Promise<FileStats | null> {
  try {
    const st = await fs.stat(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.stats;
    const stats = parse(await fs.readFile(file, "utf8"));
    cache.set(file, { mtimeMs: st.mtimeMs, stats });
    return stats;
  } catch {
    return null;
  }
}

// The CLI's own setting: compact automatically when the context window fills up.
async function autoCompactOn() {
  try {
    const d = JSON.parse(await fs.readFile(path.join(os.homedir(), ".claude", "settings.json"), "utf8"));
    return d.autoCompactEnabled !== false;
  } catch {
    return true; // the CLI's default
  }
}

export async function dashboard(): Promise<DashboardData> {
  const [sessions, limits, account, autoCompact] = await Promise.all([listSessions(), getLimits(), getAccount(), autoCompactOn()]);
  const today = new Date();
  const days: { date: string; stats: DayStats }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({ date: dayKey(d.toISOString()), stats: emptyDay() });
  }
  const byDay = new Map(days.map((d) => [d.date, d.stats]));

  const perSession = await Promise.all(
    sessions.map(async (s) => ({ s, st: await fileStats(path.join(PROJECTS_DIR, s.projectDir, `${s.id}.jsonl`)) })),
  );
  let compactions = 0;
  for (const { st } of perSession) {
    if (!st) continue;
    compactions += st.compactions;
    for (const [date, v] of Object.entries(st.days)) {
      const t = byDay.get(date);
      if (!t) continue;
      t.prompts += v.prompts;
      t.replies += v.replies;
      t.toolCalls += v.toolCalls;
      t.tokensSent += v.tokensSent;
      t.tokensWritten += v.tokensWritten;
    }
  }

  // Sessions you're likely to keep using, heaviest first: those are the ones
  // that make every new message expensive.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const heavy = perSession
    .filter(({ s, st }) => st && st.lastContext > 0 && (s.active || s.pinOrder !== undefined || s.recentAt || Date.parse(s.updatedAt) > weekAgo))
    .map(({ s, st }) => {
      const { window, estimated } = contextWindowFor(s.context?.model ?? null, st!.lastContext, limits.contextWindows);
      return {
        id: s.id,
        title: s.title,
        projectName: s.projectName,
        cwd: s.cwd,
        active: !!s.active,
        activeWhere: s.active?.entrypoint ?? null,
        used: st!.lastContext,
        window,
        estimated,
        replies: st!.replies,
        compactions: st!.compactions,
        updatedAt: s.updatedAt,
      };
    })
    .sort((a, b) => b.used - a.used)
    .slice(0, 8);

  return {
    account,
    limits,
    counts: {
      sessions: sessions.length,
      active: sessions.filter((s) => s.active).length,
      thisWeek: sessions.filter((s) => Date.parse(s.updatedAt) > weekAgo).length,
      compactions,
    },
    days,
    heavy,
    autoCompact,
  };
}
