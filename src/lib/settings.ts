import "server-only";
import { jsonStore } from "./jsonStore";
import { isModel } from "./models";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: "",
  subAgentModel: "",
  autoRestore: false,
  terminalApp: "Terminal",
};

const store = jsonStore<Partial<Settings>>("settings.json", () => ({}));

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await store.load()) };
}

// Applies only the fields that are valid; returns the new settings.
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  await store.update((s) => {
    if (isModel(patch.defaultModel)) s.defaultModel = patch.defaultModel;
    if (isModel(patch.subAgentModel)) s.subAgentModel = patch.subAgentModel;
    if (typeof patch.autoRestore === "boolean") s.autoRestore = patch.autoRestore;
    if (patch.terminalApp === "Terminal" || patch.terminalApp === "iTerm") s.terminalApp = patch.terminalApp;
  });
  return getSettings();
}
