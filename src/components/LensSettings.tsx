"use client";

import { createContext, useContext } from "react";
import type { Settings } from "@/lib/types";

// Lets deep components (like diagrams inside markdown) read Vlens settings
// without passing them through every message bubble.
export const LensSettingsContext = createContext<Settings | null>(null);

export const useLensSettings = () => useContext(LensSettingsContext);
