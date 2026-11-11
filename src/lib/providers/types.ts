import type { ClaudeProc } from "../runClaude";
import type { Running } from "../active";
import type { Limits, SessionDetail, SessionSummary } from "../types";

// An AI coding agent Vlens can drive (Claude Code today). Everything the app
// needs from "the agent" goes through this, so another one (Codex, opencode, …)
// can be added as one more adapter instead of touching every screen.
//
// Features one agent has and another doesn't (fork, hooks, skills, plugins…)
// are capabilities: the app checks them and hides what isn't there.

export type ProviderId = "claude-code" | "codex" | "opencode" | "cursor";

export interface ProviderCapabilities {
  fork: boolean; // copy a session with its history
  cliView: boolean; // run the agent's own terminal UI on a session (Chat ⇄ CLI)
  compact: boolean; // summarise a long conversation and keep going
  usageLimits: boolean; // plan usage windows (5 hours / week)
  permissionModes: boolean; // ask / accept edits / plan / auto …
  hooks: boolean;
  skills: boolean;
  plugins: boolean;
  mcp: boolean;
  bots: boolean; // Vlens bots run on this agent
}

// One session's agent, kept open between replies.
export type AgentProcess = Pick<ClaudeProc, "sessionId" | "runTurn">;

export interface AgentProvider {
  id: ProviderId;
  name: string; // shown in Settings
  binary: string; // the CLI command
  capabilities: ProviderCapabilities;

  // Is it installed here, and which version?
  detect(): Promise<{ installed: boolean; version: string | null }>;

  // Sessions, from the agent's own files.
  listSessions(): Promise<SessionSummary[]>;
  getSession(id: string): Promise<SessionDetail | null>;
  findSessionFile(id: string): Promise<{ dir: string; file: string } | null>;
  renameSession(id: string, title: string): Promise<unknown>;
  deleteSession(id: string): Promise<{ ok: true } | { ok: false; status: number; error: string }>;
  forkSession(id: string, title: string): Promise<{ sessionId: string }>;

  // Agents running right now (in a terminal, another app, or Vlens), and ending one.
  activeSessions(): Promise<Map<string, Running>>;
  endSession(id: string): Promise<{ ok: true } | { ok: false; error: string }>;

  // Talking to it: the open agent for a session (or a new one), and the live controls.
  openSession(o: { sessionId: string | null; cwd: string | null; mode: string; model: string; extra: string[]; onSession?: (id: string) => void }): Promise<AgentProcess>;
  liveState(sessionId: string): ReturnType<typeof import("../liveSessions").liveState>;
  interrupt(sessionId: string): Promise<unknown>;
  // A message for the agent while it's working, taken in at its next step. False when it isn't working.
  steer(sessionId: string, content: unknown[]): boolean;
  stopTask(sessionId: string, taskId: string): Promise<unknown>;
  release(sessionId: string): Promise<"none" | "closed" | "busy">;
  // A one-off run that returns the final text (slash commands, compact, bots).
  runOnce(o: { prompt: string; args: string[]; cwd: string | null; timeoutMs?: number }): Promise<{ ok: boolean; text: string; error?: string }>;
  compact(id: string): ReturnType<typeof import("../context").compactSession>;
  handoffNote(id: string): ReturnType<typeof import("../context").handoffNote>;

  // Usage and limits.
  getLimits(): Promise<Limits>;
  probe(model?: string, cwd?: string): Promise<void>;

  // Commands to run it in a terminal.
  resumeCommand(id: string): string[];
  forkCommand(id: string): string[];
}
