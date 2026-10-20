import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isThemePreference,
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "../appearance/theme";

describe("theme preferences", () => {
  let saved: Map<string, string>;

  beforeEach(() => {
    saved = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("accepts only the three supported preference strings", () => {
    for (const value of ["light", "dark", "system"]) {
      expect(isThemePreference(value)).toBe(true);
    }
    for (const value of [
      undefined,
      null,
      true,
      0,
      {},
      ["dark"],
      "",
      "Dark",
      " dark ",
      "auto",
    ]) {
      expect(isThemePreference(value)).toBe(false);
    }
  });

  it.each(["light", "dark", "system"] as const)(
    "restores the saved %s preference",
    (preference) => {
      saved.set(THEME_STORAGE_KEY, preference);
      expect(readThemePreference()).toBe(preference);
    },
  );

  it.each([null, "", "broken", "null", '{"theme":"dark"}', '"dark"'])(
    "follows the system for missing or corrupt storage value %s",
    (value) => {
      if (value !== null) saved.set(THEME_STORAGE_KEY, value);
      expect(readThemePreference()).toBe("system");
    },
  );

  it("follows the system when storage access is denied", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage unavailable");
      },
    });
    expect(readThemePreference()).toBe("system");
  });

  it("follows the system when local storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readThemePreference()).toBe("system");
  });

  const resolutions: [ThemePreference, ResolvedTheme, ResolvedTheme][] = [
    ["system", "light", "light"],
    ["system", "dark", "dark"],
    ["light", "light", "light"],
    ["light", "dark", "light"],
    ["dark", "light", "dark"],
    ["dark", "dark", "dark"],
  ];

  it.each(resolutions)(
    "resolves %s with a %s system theme to %s",
    (preference, systemTheme, expected) => {
      expect(resolveTheme(preference, systemTheme)).toBe(expected);
    },
  );
});
