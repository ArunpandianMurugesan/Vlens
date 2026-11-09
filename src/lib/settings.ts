import "server-only";
import { jsonStore } from "./jsonStore";
import { isModel } from "./models";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: "",
  subAgentModel: "",
  autoRestore: false,
  terminalApp: "Terminal",
  showDiagrams: true,
  animateDiagrams: false,
  diagramSkill: true,
  showWhiteboards: true,
  whiteboardSkill: true,
  onboarded: false,
  notifications: true,
};

const store = jsonStore<Partial<Settings>>("settings.json", () => ({}));

export async function getSettings(): Promise<Settings> {
  // Coach (retros, lessons) was removed: drop its old settings if they're still saved.
  const { coach: _c, retro: _r, lessonsToClaudeMd: _l, lessonsTarget: _t, retroModel: _m, ...saved } = (await store.load()) as Partial<Settings> & Record<string, unknown>;
  void [_c, _r, _l, _t, _m];
  return { ...DEFAULT_SETTINGS, ...saved };
}

// Applies only the fields that are valid; returns the new settings.
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  await store.update((s) => {
    if (isModel(patch.defaultModel)) s.defaultModel = patch.defaultModel;
    if (isModel(patch.subAgentModel)) s.subAgentModel = patch.subAgentModel;
    if (typeof patch.autoRestore === "boolean") s.autoRestore = patch.autoRestore;
    if (patch.terminalApp === "Terminal" || patch.terminalApp === "iTerm") s.terminalApp = patch.terminalApp;
    // Only an agent Vlens has an adapter for (lib/providers).
    if (patch.provider === "claude-code") s.provider = patch.provider;
    for (const k of ["showDiagrams", "animateDiagrams", "diagramSkill", "showWhiteboards", "whiteboardSkill", "onboarded", "notifications"] as const)
      if (typeof patch[k] === "boolean") s[k] = patch[k];
  });
  return getSettings();
}
