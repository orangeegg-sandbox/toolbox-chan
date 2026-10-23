import { useCallback, useSyncExternalStore } from "react";
import { AGENT_IDS, type AgentId } from "../../core/sdk";

// Settings are written by the toolbox window and read by the pet window. Both
// share local storage, and the pet window follows changes through `storage` events.
// New fields fall back to their defaults, so older saved settings keep working.

export const PET_SIZES = { small: 96, medium: 128, large: 160 } as const;
export type PetSize = keyof typeof PET_SIZES;

/** How a pet answers something that wants the user: stay home, walk to the pointer, or teleport there. */
export const PET_BEHAVIOURS = ["stay", "walk", "teleport"] as const;
export type PetBehaviour = (typeof PET_BEHAVIOURS)[number];

/** Events the user picks a behaviour for. A limit reset always stays home. */
export const PET_CALLS = ["done", "needsYou", "notice"] as const;
export type PetCall = (typeof PET_CALLS)[number];

/** A part of the screen's work area, in fractions (0–1), so it keeps its place on any screen size. */
export interface Zone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const IDLE_TALK_MINUTES = [2, 5, 10, 20] as const;
export const MAX_IDLE_LINES = 30;
export const MAX_IDLE_LINE = 60;
/** The smallest zone side, in fractions; a smaller drag is a click. */
export const MIN_ZONE = 0.02;

export interface PetSettings {
  enabled: Record<AgentId, boolean>;
  size: PetSize;
  /** Pets rest inside `zone` instead of the whole bottom of the screen. */
  zoneOn: boolean;
  zone: Zone;
  /** Move to the screen the mouse is on; otherwise stay on the main screen. */
  followScreen: boolean;
  wander: boolean;
  doze: boolean;
  hideFullscreen: boolean;
  bubbles: boolean;
  hoverNote: boolean;
  behaviour: Record<PetCall, PetBehaviour>;
  limitReset: boolean;
  idleMoves: boolean;
  /** Idle moves the user turned off, as `<agent>/<name>`. */
  disabledMoves: string[];
  idleTalk: boolean;
  idleTalkMinutes: (typeof IDLE_TALK_MINUTES)[number];
  idleLines: string[];
}

export const SETTINGS_KEY = "toolbox-chan.agent-pet.settings.v1";
/** Written by the settings page to ask the pet window to let the user draw the zone. */
export const DRAW_ZONE_KEY = "toolbox-chan.agent-pet.draw-zone";

export const DEFAULT_ZONE: Zone = { x: 0.62, y: 0.7, width: 0.38, height: 0.3 };

export const DEFAULT_SETTINGS: PetSettings = {
  enabled: { claude: true, codex: true, deepseek: true },
  size: "medium",
  zoneOn: true,
  zone: DEFAULT_ZONE,
  followScreen: true,
  wander: true,
  doze: true,
  hideFullscreen: true,
  bubbles: true,
  hoverNote: true,
  behaviour: { done: "walk", needsYou: "stay", notice: "stay" },
  limitReset: true,
  idleMoves: true,
  disabledMoves: [],
  idleTalk: true,
  idleTalkMinutes: 10,
  idleLines: ["Need anything?", "I'm right here!", "Taking a little break.", "Ready when you are!", "Hmm hmm hmm~"],
};

type Fields = Record<string, unknown>;

function record(value: unknown): Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Fields : {};
}

function flag(fields: Fields, key: keyof PetSettings): boolean {
  const value = fields[key];
  return typeof value === "boolean" ? value : DEFAULT_SETTINGS[key] as boolean;
}

function choice<T extends string | number>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback;
}

/** A zone inside the screen and big enough to see, or null. */
export function parseZone(value: unknown): Zone | null {
  const fields = record(value);
  const zone = { x: fields.x, y: fields.y, width: fields.width, height: fields.height };
  if (!Object.values(zone).every((part) => typeof part === "number" && Number.isFinite(part))) return null;
  const { x, y, width, height } = zone as Zone;
  const fits = x >= 0 && y >= 0 && width >= MIN_ZONE && height >= MIN_ZONE && x + width <= 1.0001 && y + height <= 1.0001;
  // Rounding may push the far edge a hair past the screen; pull it back.
  return fits ? { x, y, width: x + width > 1 ? 1 - x : width, height: y + height > 1 ? 1 - y : height } : null;
}

/** Trims, drops empty lines, and keeps at most `MAX_IDLE_LINES` of at most `MAX_IDLE_LINE` characters. */
export function cleanLines(lines: readonly unknown[]): string[] {
  return lines
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.replace(/\s+/g, " ").trim().slice(0, MAX_IDLE_LINE))
    .filter(Boolean)
    .slice(0, MAX_IDLE_LINES);
}

export function parseSettings(text: string | null): PetSettings {
  let fields: Fields;
  try {
    fields = record(JSON.parse(text ?? "{}"));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const enabled = record(fields.enabled);
  const behaviour = record(fields.behaviour);
  return {
    enabled: Object.fromEntries(AGENT_IDS.map((agent) => [
      agent, typeof enabled[agent] === "boolean" ? enabled[agent] : DEFAULT_SETTINGS.enabled[agent],
    ])) as Record<AgentId, boolean>,
    size: choice(fields.size, Object.keys(PET_SIZES) as PetSize[], DEFAULT_SETTINGS.size),
    zoneOn: flag(fields, "zoneOn"),
    zone: parseZone(fields.zone) ?? DEFAULT_ZONE,
    followScreen: flag(fields, "followScreen"),
    wander: flag(fields, "wander"),
    doze: flag(fields, "doze"),
    hideFullscreen: flag(fields, "hideFullscreen"),
    bubbles: flag(fields, "bubbles"),
    hoverNote: flag(fields, "hoverNote"),
    behaviour: Object.fromEntries(PET_CALLS.map((call) => [
      call, choice(behaviour[call], PET_BEHAVIOURS, DEFAULT_SETTINGS.behaviour[call]),
    ])) as Record<PetCall, PetBehaviour>,
    limitReset: flag(fields, "limitReset"),
    idleMoves: flag(fields, "idleMoves"),
    disabledMoves: Array.isArray(fields.disabledMoves)
      ? fields.disabledMoves.filter((id): id is string => typeof id === "string").slice(0, 500)
      : [],
    idleTalk: flag(fields, "idleTalk"),
    idleTalkMinutes: choice(fields.idleTalkMinutes, IDLE_TALK_MINUTES, DEFAULT_SETTINGS.idleTalkMinutes),
    idleLines: Array.isArray(fields.idleLines) ? cleanLines(fields.idleLines) : [...DEFAULT_SETTINGS.idleLines],
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let cachedText: string | null | undefined;
let cached: PetSettings = DEFAULT_SETTINGS;

function snapshot(): PetSettings {
  const text = read(SETTINGS_KEY);
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

/** Asks the pet window to let the user draw the idle zone on the screen. */
export function requestZoneDrawing() {
  try {
    localStorage.setItem(DRAW_ZONE_KEY, String(Date.now()));
  } catch {
    // Without storage the pet window cannot be asked; the settings page says so.
  }
}

/** Calls `listener` when the settings page asks to draw the zone. Requests older than a few seconds are ignored. */
export function subscribeZoneDrawing(listener: () => void): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key === DRAW_ZONE_KEY && event.newValue && Date.now() - Number(event.newValue) < 5000) listener();
  };
  window.addEventListener("storage", storage);
  return () => window.removeEventListener("storage", storage);
}
