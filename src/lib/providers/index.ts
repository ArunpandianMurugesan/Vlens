import "server-only";
import { getSettings } from "../settings";
import { claudeCode } from "./claude";
import type { AgentProvider, ProviderId } from "./types";

export type { AgentProvider, ProviderId } from "./types";

// The agents Vlens can drive. Add an adapter here to support another one.
const PROVIDERS: Partial<Record<ProviderId, AgentProvider>> = {
  "claude-code": claudeCode,
};

// Shown in Settings. Only agents with an adapter are listed (Codex, opencode and
// Cursor CLI can come back here once they have one).
export const PROVIDER_CHOICES: { id: ProviderId; name: string; binary: string }[] = [
  { id: "claude-code", name: "Claude Code", binary: "claude" },
];

export const isSupported = (id: unknown): id is ProviderId => typeof id === "string" && id in PROVIDERS;

// The agent picked in Settings (Claude Code until another is added and picked).
export async function getProvider(): Promise<AgentProvider> {
  const { provider } = await getSettings();
  return (provider && PROVIDERS[provider]) || claudeCode;
}
