import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createShortcutMatcher, DEFAULT_PALETTE_SHORTCUT, DOUBLE_TAP_INTERVAL_MS,
  formatShortcut, MAX_TAP_DURATION_MS, PALETTE_SHORTCUT_STORAGE_KEY, parseShortcut,
  readPaletteShortcut, savePaletteShortcut, shortcutFromEvent,
  validateShortcut, type ShortcutKeyEvent,
} from "../commands/shortcuts";

function key(key: string, modifiers: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, ...modifiers };
}

describe("palette shortcut preferences", () => {
  let saved: Map<string, string>;

  beforeEach(() => {
    saved = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (name: string) => saved.get(name) ?? null,
      setItem: (name: string, value: string) => saved.set(name, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to the double Ctrl + Shift tap", () => {
    expect(readPaletteShortcut()).toBe(DEFAULT_PALETTE_SHORTCUT);
    expect(formatShortcut(DEFAULT_PALETTE_SHORTCUT)).toBe("Ctrl + Shift × 2");
  });

  it("saves and restores custom shortcuts in canonical order", () => {
    savePaletteShortcut("Shift+Ctrl+p");
    expect(saved.get(PALETTE_SHORTCUT_STORAGE_KEY)).toBe("Shift+Ctrl+p");
    expect(readPaletteShortcut()).toBe("Ctrl+Shift+P");
    expect(formatShortcut("Meta+Shift+P")).toBe("Shift + Win / ⌘ + P");
  });

  it.each(["broken", "P", "Shift+P", "Shift+1", "Shift+Space", "Shift+Home", "Shift+F12", "Ctrl+Ctrl+P", "Ctrl+Shift", "Ctrl+Alt+DoubleTap", "Ctrl+K", "Ctrl+O", "Meta+V", "Ctrl+Enter", "Ctrl+Shift+C"])(
    "ignores malformed or conflicting stored shortcut %s", (value) => {
      saved.set(PALETTE_SHORTCUT_STORAGE_KEY, value);
      expect(readPaletteShortcut()).toBe(DEFAULT_PALETTE_SHORTCUT);
      expect(validateShortcut(value)).not.toBeNull();
    },
  );

  it.each(["Ctrl+Shift+P", "Alt+Space", "Meta+1", "Ctrl+F12", "Alt+ArrowUp", "Ctrl+Shift+Home"])(
    "accepts supported chord %s", (value) => expect(validateShortcut(value)).toBeNull(),
  );

  it("handles unavailable local storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("Storage disabled"); },
      setItem: () => { throw new Error("Storage disabled"); },
    });
    expect(readPaletteShortcut()).toBe(DEFAULT_PALETTE_SHORTCUT);
    expect(() => savePaletteShortcut("Alt+P")).not.toThrow();
  });

  it("records actual modifier state and normalizes keyboard keys", () => {
    expect(shortcutFromEvent(key("p", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+P");
    expect(shortcutFromEvent(key(" ", { altKey: true }))).toBe("Alt+Space");
    expect(shortcutFromEvent(key("Control", { ctrlKey: true }))).toBeNull();
    expect(parseShortcut("Ctrl+ArrowDown")).toMatchObject({ type: "chord", key: "ArrowDown" });
  });
});

describe("palette shortcut matcher", () => {
  let time = 0;
  let trigger: ReturnType<typeof vi.fn>;
  let matcher: ReturnType<typeof createShortcutMatcher>;

  beforeEach(() => {
    time = 0;
    trigger = vi.fn();
    matcher = createShortcutMatcher(DEFAULT_PALETTE_SHORTCUT, trigger, () => time);
  });

  function tap() {
    matcher.keydown(key("Control", { ctrlKey: true }));
    matcher.keydown(key("Shift", { ctrlKey: true, shiftKey: true }));
    matcher.keyup(key("Shift", { ctrlKey: true }));
    return matcher.keyup(key("Control"));
  }

  it("fires only after the second complete release within the interval", () => {
    expect(tap()).toBe(false);
    time = DOUBLE_TAP_INTERVAL_MS;
    matcher.keydown(key("Shift", { shiftKey: true }));
    matcher.keydown(key("Control", { ctrlKey: true, shiftKey: true }));
    matcher.keyup(key("Control", { shiftKey: true }));
    expect(trigger).not.toHaveBeenCalled();
    expect(matcher.keyup(key("Shift"))).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("starts a new pair after a timeout", () => {
    tap();
    time = DOUBLE_TAP_INTERVAL_MS + 1;
    expect(tap()).toBe(false);
    time += 100;
    expect(tap()).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("rejects a held modifier chord and starts a fresh pair afterward", () => {
    matcher.keydown(key("Control", { ctrlKey: true }));
    matcher.keydown(key("Shift", { ctrlKey: true, shiftKey: true }));
    time = MAX_TAP_DURATION_MS + 1;
    matcher.keyup(key("Shift", { ctrlKey: true }));
    expect(matcher.keyup(key("Control"))).toBe(false);
    time += 100;
    expect(tap()).toBe(false);
    time += 100;
    expect(tap()).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("measures tap duration from the first modifier, rather than chord completion", () => {
    tap();
    time = 100;
    matcher.keydown(key("Control", { ctrlKey: true }));
    time += MAX_TAP_DURATION_MS;
    matcher.keydown(key("Shift", { ctrlKey: true, shiftKey: true }));
    time += 1;
    matcher.keyup(key("Control", { shiftKey: true }));
    expect(matcher.keyup(key("Shift"))).toBe(false);
    expect(trigger).not.toHaveBeenCalled();
  });

  it.each(["Control", "Shift"])("invalidates a pair when an incomplete %s tap intervenes", (modifier) => {
    tap();
    time = 100;
    matcher.keydown(key(modifier, modifier === "Control" ? { ctrlKey: true } : { shiftKey: true }));
    matcher.keyup(key(modifier));
    time = 200;
    expect(tap()).toBe(false);
    time = 300;
    expect(tap()).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("requires both modifiers to be released between taps", () => {
    matcher.keydown(key("Control", { ctrlKey: true }));
    for (let i = 0; i < 3; i++) {
      matcher.keydown(key("Shift", { ctrlKey: true, shiftKey: true }));
      matcher.keyup(key("Shift", { ctrlKey: true }));
    }
    matcher.keyup(key("Control"));
    expect(trigger).not.toHaveBeenCalled();
    time = 100;
    tap();
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("does not treat typing, tool actions or repeated modifier events as taps", () => {
    tap();
    matcher.keydown(key("Control", { ctrlKey: true }));
    matcher.keydown(key("Shift", { ctrlKey: true, shiftKey: true }));
    matcher.keydown(key("P", { ctrlKey: true, shiftKey: true }));
    matcher.keyup(key("P", { ctrlKey: true, shiftKey: true }));
    matcher.keyup(key("Shift", { ctrlKey: true }));
    matcher.keyup(key("Control"));
    expect(tap()).toBe(false);
    matcher.keydown(key("Shift", { shiftKey: true, repeat: true }));
    matcher.keyup(key("Shift"));
    expect(trigger).not.toHaveBeenCalled();
  });

  it("invalidates taps with extra modifiers and resets on focus changes", () => {
    tap();
    matcher.keydown(key("Alt", { altKey: true }));
    matcher.keyup(key("Alt"));
    expect(tap()).toBe(false);
    matcher.reset();
    time = 100;
    expect(tap()).toBe(false);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("matches custom chords exactly and ignores key repeats", () => {
    matcher = createShortcutMatcher("Ctrl+Shift+P", trigger);
    expect(matcher.keydown(key("p", { ctrlKey: true }))).toBe(false);
    expect(matcher.keydown(key("p", { ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(matcher.keydown(key("p", { ctrlKey: true, shiftKey: true, repeat: true }))).toBe(false);
    expect(matcher.keydown(key("p", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matcher.keyup(key("p"))).toBe(false);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("waits for the other-side modifier to be released", () => {
    tap();
    matcher.keydown(key("Control", { ctrlKey: true }));
    matcher.keydown(key("Shift", { ctrlKey: true, shiftKey: true }));
    matcher.keyup(key("Shift", { ctrlKey: true }));
    matcher.keyup(key("Control", { ctrlKey: true }));
    expect(trigger).not.toHaveBeenCalled();
    expect(matcher.keyup(key("Control"))).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});
