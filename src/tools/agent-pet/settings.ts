import { useCallback, useSyncExternalStore } from "react";
import { AGENT_IDS, type AgentId } from "../../core/sdk";

// Settings are written by the toolbox window and read by the pet window. Both
// share local storage, and the pet window follows changes through `storage` events.

export const PET_SIZES = { small: 96, medium: 128, large: 160 } as const;
export type PetSize = keyof typeof PET_SIZES;

export interface PetSettings {
  enabled: Record<AgentId, boolean>;
  size: PetSize;
}

export const SETTINGS_KEY = "toolbox-chan.agent-pet.settings.v1";

export const DEFAULT_SETTINGS: PetSettings = {
  enabled: { claude: true, codex: true, deepseek: true },
  size: "medium",
};

export function parseSettings(text: string | null): PetSettings {
  try {
    const value: unknown = JSON.parse(text ?? "{}");
    const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
    const enabled = typeof record.enabled === "object" && record.enabled !== null ? record.enabled as Record<string, unknown> : {};
    return {
      enabled: Object.fromEntries(AGENT_IDS.map((agent) => [
        agent, typeof enabled[agent] === "boolean" ? enabled[agent] : DEFAULT_SETTINGS.enabled[agent],
      ])) as Record<AgentId, boolean>,
      size: typeof record.size === "string" && record.size in PET_SIZES ? record.size as PetSize : DEFAULT_SETTINGS.size,
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(SETTINGS_KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let cachedText: string | null | undefined;
let cached: PetSettings = DEFAULT_SETTINGS;

function snapshot(): PetSettings {
  const text = read();
  if (text !== cachedText) {
    cachedText = text;
    cached = parseSettings(text);
  }
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const storage = (event: StorageEvent) => {
    if (event.key === SETTINGS_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storage);
  };
}

export function saveSettings(settings: PetSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } finally {
    for (const listener of [...listeners]) listener();
  }
}

/** Current pet settings, updated live from either window. */
export function usePetSettings(): [PetSettings, (change: Partial<PetSettings>) => void] {
  const settings = useSyncExternalStore(subscribe, snapshot);
  const update = useCallback((change: Partial<PetSettings>) => saveSettings({ ...snapshot(), ...change }), []);
  return [settings, update];
}
