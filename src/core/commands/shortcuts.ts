export const DEFAULT_PALETTE_SHORTCUT = "Ctrl+Shift+DoubleTap";
export const PALETTE_SHORTCUT_STORAGE_KEY = "toolbox-command-palette-shortcut";
export const DOUBLE_TAP_INTERVAL_MS = 500;
export const MAX_TAP_DURATION_MS = 500;

type ChordShortcut = {
  type: "chord";
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
};

export type ParsedShortcut = { type: "double-tap" } | ChordShortcut;
export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "repeat"
>;

const NAMED_KEYS = [
  "Space", "Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End",
  "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
];
const MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"] as const;

function normalizeKey(key: string): string | null {
  if (key === " " || key.toLowerCase() === "space") return "Space";
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (/^f([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  return NAMED_KEYS.find((name) => name.toLowerCase() === key.toLowerCase()) ?? null;
}

export function parseShortcut(value: string | null): ParsedShortcut | null {
  if (!value) return null;
  if (value === DEFAULT_PALETTE_SHORTCUT) return { type: "double-tap" };
  const parts = value.split("+");
  const key = normalizeKey(parts.pop() ?? "");
  if (!key || parts.length === 0) return null;
  if (parts.some((part) => !MODIFIERS.some((modifier) => modifier === part))) return null;
  if (new Set(parts).size !== parts.length) return null;
  return {
    type: "chord",
    ctrl: parts.includes("Ctrl"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    meta: parts.includes("Meta"),
    key,
  };
}

function serializeShortcut(shortcut: ParsedShortcut): string {
  if (shortcut.type === "double-tap") return DEFAULT_PALETTE_SHORTCUT;
  return [
    shortcut.ctrl && "Ctrl", shortcut.alt && "Alt", shortcut.shift && "Shift",
    shortcut.meta && "Meta", shortcut.key,
  ].filter(Boolean).join("+");
}

export function validateShortcut(value: string): string | null {
  const parsed = parseShortcut(value);
  if (!parsed) return "Use Ctrl, Alt, Shift or Windows/Command together with a letter, number or navigation key.";
  if (parsed.type === "double-tap") return null;
  if (!parsed.ctrl && !parsed.alt && !parsed.meta) {
    return "Add Ctrl, Alt or Windows/Command so the shortcut does not interrupt normal typing.";
  }
  // Preserve the toolbox's existing commands, including their macOS equivalents.
  if ((parsed.ctrl || parsed.meta) && !parsed.alt) {
    if (!parsed.shift && ["K", "O", "V", "Enter"].includes(parsed.key)) {
      return `${formatShortcut(value)} is already used by the toolbox. Choose another shortcut.`;
    }
    if (parsed.shift && parsed.key === "C") {
      return `${formatShortcut(value)} is already used by the toolbox. Choose another shortcut.`;
    }
  }
  return null;
}

export function formatShortcut(value: string): string {
  const parsed = parseShortcut(value);
  if (!parsed) return value;
  if (parsed.type === "double-tap") return "Ctrl + Shift × 2";
  return serializeShortcut(parsed).split("+").map((part) => part === "Meta" ? "Win / ⌘" : part).join(" + ");
}

export function shortcutFromEvent(event: ShortcutKeyEvent): string | null {
  const key = normalizeKey(event.key);
  if (!key) return null;
  return [
    event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift",
    event.metaKey && "Meta", key,
  ].filter(Boolean).join("+");
}

export function readPaletteShortcut(): string {
  try {
    const value = localStorage.getItem(PALETTE_SHORTCUT_STORAGE_KEY);
    const parsed = parseShortcut(value);
    return parsed && !validateShortcut(value!) ? serializeShortcut(parsed) : DEFAULT_PALETTE_SHORTCUT;
  } catch {
    return DEFAULT_PALETTE_SHORTCUT;
  }
}

export function savePaletteShortcut(value: string): void {
  try {
    localStorage.setItem(PALETTE_SHORTCUT_STORAGE_KEY, value);
  } catch {
    // The selected shortcut remains available for the current session.
  }
}

/** Modifier taps must finish with both keys released; chords cannot count as taps. */
export function createShortcutMatcher(
  value: string,
  onTrigger: () => void,
  now: () => number = () => performance.now(),
) {
  const shortcut = parseShortcut(value);
  let ctrlDown = false;
  let shiftDown = false;
  let tapArmed = false;
  let invalidTap = false;
  let tapStartedAt: number | null = null;
  let firstTapAt: number | null = null;

  function reset() {
    ctrlDown = false;
    shiftDown = false;
    tapArmed = false;
    invalidTap = false;
    tapStartedAt = null;
    firstTapAt = null;
  }

  return {
    reset,
    keydown(event: ShortcutKeyEvent): boolean {
      if (!shortcut || event.repeat) return false;
      if (shortcut.type === "chord") {
        if (
          normalizeKey(event.key) === shortcut.key &&
          event.ctrlKey === shortcut.ctrl && event.altKey === shortcut.alt &&
          event.shiftKey === shortcut.shift && event.metaKey === shortcut.meta
        ) {
          onTrigger();
          return true;
        }
        return false;
      }
      ctrlDown = event.key === "Control" || event.ctrlKey;
      shiftDown = event.key === "Shift" || event.shiftKey;
      if ((ctrlDown || shiftDown) && tapStartedAt === null) tapStartedAt = now();
      if (!["Control", "Shift"].includes(event.key) || event.altKey || event.metaKey) {
        invalidTap = true;
        firstTapAt = null;
      }
      if (ctrlDown && shiftDown && !invalidTap) tapArmed = true;
      return false;
    },
    keyup(event: ShortcutKeyEvent): boolean {
      if (!shortcut || shortcut.type !== "double-tap") return false;
      // The aggregate modifier flags stay true when the opposite-side key is
      // still held (for example, releasing right Ctrl while holding left Ctrl).
      ctrlDown = event.ctrlKey;
      shiftDown = event.shiftKey;
      if (ctrlDown || shiftDown) return false;
      const time = now();
      const hadTap = tapStartedAt !== null;
      const completed = tapArmed && !invalidTap && tapStartedAt !== null && time - tapStartedAt <= MAX_TAP_DURATION_MS;
      tapArmed = false;
      invalidTap = false;
      tapStartedAt = null;
      if (!completed) {
        if (hadTap) firstTapAt = null;
        return false;
      }
      if (firstTapAt !== null && time - firstTapAt <= DOUBLE_TAP_INTERVAL_MS) {
        firstTapAt = null;
        onTrigger();
        return true;
      }
      firstTapAt = time;
      return false;
    },
  };
}
