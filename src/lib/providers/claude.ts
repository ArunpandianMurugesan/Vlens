import "server-only";
import { forkSession } from "@anthropic-ai/claude-agent-sdk";
import { activeSessions, endSession } from "../active";
import { claudeCmd } from "../cli";
import { compactSession, handoffNote } from "../context";
import { getLimits, probe } from "../limits";
import { interruptLive, liveState, procFor, releaseLive, reloadLive, steerLive, stopLiveTask } from "../liveSessions";
import { deleteSession, renameSession } from "../manage";
import { runClaudeOnce } from "../runClaude";
import { findSessionFile, getSession, listSessions } from "../sessions";
import type { AgentProvider } from "./types";

// Claude Code: the code that was already here, behind the provider interface.
// Nothing changes in how it works; each method is the function the app called before.
export const claudeCode: AgentProvider = {
  id: "claude-code",
  name: "Claude Code",
  binary: "claude",
  capabilities: {
    fork: true,
    cliView: true,
    compact: true,
    usageLimits: true,
    permissionModes: true,
    hooks: true,
    skills: true,
    plugins: true,
    mcp: true,
    bots: true,
  },

  async detect() {
    const v = await claudeCmd(["--version"]);
    return { installed: v.ok, version: v.ok ? (v.out.match(/\d+\.\d+\.\d+/)?.[0] ?? v.out.split("\n")[0]) : null };
  },

  listSessions,
  getSession,
  findSessionFile,
  renameSession,
  deleteSession,
  forkSession: (id, title) => forkSession(id, { title }),

  activeSessions,
  endSession,

  openSession: procFor,
  liveState,
  interrupt: interruptLive,
  steer: steerLive,
  stopTask: stopLiveTask,
  release: releaseLive,
  reload: reloadLive,
  runOnce: runClaudeOnce,
  compact: compactSession,
  handoffNote,

  getLimits,
  probe,

  resumeCommand: (id) => ["claude", "--resume", id],
  forkCommand: (id) => ["claude", "--resume", id, "--fork-session"],
};
