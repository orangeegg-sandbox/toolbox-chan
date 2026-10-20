import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_LEVELS,
  FONT_SIZE_STORAGE_KEY,
  parseFontSize,
  readFontSizePreference,
  saveFontSizePreference,
} from "../appearance/FontSizeProvider";

describe("font-size preferences", () => {
  let saved: Map<string, string>;

  beforeEach(() => {
    saved = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("defaults to the more readable Medium 125% level", () => {
    expect(DEFAULT_FONT_SIZE).toBe(125);
    expect(readFontSizePreference()).toBe(125);
  });

  it.each(FONT_SIZE_LEVELS)(
    "persists and restores $label at $value%",
    ({ value }) => {
      saveFontSizePreference(value);
      expect(saved.get(FONT_SIZE_STORAGE_KEY)).toBe(String(value));
      expect(readFontSizePreference()).toBe(value);
    },
  );

  it.each([
    null,
    "",
    "broken",
    "null",
    "{}",
    "1.5",
    "0",
    "200",
    "125px",
    " 150 ",
  ])(
    "falls back safely for the malformed or unsupported value %s",
    (value) => {
      expect(parseFontSize(value)).toBe(DEFAULT_FONT_SIZE);
      if (value !== null) saved.set(FONT_SIZE_STORAGE_KEY, value);
      expect(readFontSizePreference()).toBe(DEFAULT_FONT_SIZE);
    },
  );

  it("keeps the default available when local storage cannot be read", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage unavailable");
      },
    });
    expect(readFontSizePreference()).toBe(DEFAULT_FONT_SIZE);
  });

  it("allows session changes even when local storage cannot be written", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("Storage full");
      },
    });
    expect(() => saveFontSizePreference(175)).not.toThrow();
  });
});
