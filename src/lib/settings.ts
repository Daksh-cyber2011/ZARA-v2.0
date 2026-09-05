/**
 * MYRAA — client-side settings store.
 * Preferences auto-save to localStorage and mirror the autoStart flag to the
 * backend /api/settings endpoint (which also reaches the Python agent).
 */
import { useCallback, useEffect, useState } from "react";
import type { ThemeName } from "./themes";

export interface MyraaSettings {
  autoStart: boolean;
  animations: boolean;
  wakeWordEnabled: boolean;
  wakePhrase: string;
  micSensitivity: number;
  theme: ThemeName;
}

export const DEFAULT_SETTINGS: MyraaSettings = {
  autoStart: false,
  animations: true,
  wakeWordEnabled: false,
  wakePhrase: "hey myraa",
  micSensitivity: 0.5,
  theme: "charcoal",
};

const STORAGE_KEY = "myraa.settings.v1";

export function loadStoredSettings(): MyraaSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<MyraaSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function useSettings(): {
  settings: MyraaSettings;
  update: (patch: Partial<MyraaSettings>) => void;
} {
  const [settings, setSettings] = useState<MyraaSettings>(() => loadStoredSettings());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }, [settings]);

  const update = useCallback((patch: Partial<MyraaSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    if ("autoStart" in patch) {
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoStart: patch.autoStart }),
      }).catch(() => {});
    }
  }, []);

  return { settings, update };
}
