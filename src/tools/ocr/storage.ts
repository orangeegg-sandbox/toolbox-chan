import { LANGUAGES, type HistoryEntry, type Preferences } from "./types";

const SETTINGS_KEY = "little-toolbox.preferences.v1";
const HISTORY_KEY = "little-toolbox.history.v1";
export const DEFAULT_PREFERENCES: Preferences = {
  language: "eng",
  layout: "auto",
  keepHistory: true,
  autoCopy: false,
};
export const HISTORY_LIMIT = 20;

export function loadPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return {
      language: LANGUAGES.some((l) => l.value === value?.language)
        ? value.language
        : "eng",
      layout: ["auto", "sparse", "block"].includes(value?.layout)
        ? value.layout
        : "auto",
      keepHistory:
        typeof value?.keepHistory === "boolean" ? value.keepHistory : true,
      autoCopy: typeof value?.autoCopy === "boolean" ? value.autoCopy : false,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
export function savePreferences(preferences: Preferences) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences));
}
export function loadHistory(): HistoryEntry[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(HISTORY_KEY) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (v): v is HistoryEntry =>
          v &&
          typeof v.id === "string" &&
          typeof v.name === "string" &&
          typeof v.text === "string" &&
          typeof v.createdAt === "number" &&
          Number.isFinite(v.createdAt) &&
          typeof v.duration === "number" &&
          typeof v.confidence === "number" &&
          LANGUAGES.some((l) => l.value === v.language),
      )
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}
export function saveHistory(history: HistoryEntry[]) {
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(history.slice(0, HISTORY_LIMIT)),
  );
}
export function clearStoredHistory() {
  localStorage.removeItem(HISTORY_KEY);
}
