import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export const FONT_SIZE_LEVELS = [
  { value: 100, label: "Small" },
  { value: 125, label: "Medium" },
  { value: 150, label: "Large" },
  { value: 175, label: "Extra large" },
] as const;

export type FontSize = (typeof FONT_SIZE_LEVELS)[number]["value"];
export const DEFAULT_FONT_SIZE: FontSize = 125;
export const FONT_SIZE_STORAGE_KEY = "little-toolbox.font-size.v1";

export function parseFontSize(value: string | null): FontSize {
  return (
    FONT_SIZE_LEVELS.find((level) => String(level.value) === value)?.value ??
    DEFAULT_FONT_SIZE
  );
}

export function readFontSizePreference(): FontSize {
  try {
    return parseFontSize(localStorage.getItem(FONT_SIZE_STORAGE_KEY));
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

export function saveFontSizePreference(fontSize: FontSize): void {
  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  } catch {
    // Text sizing still works for this session if local storage is unavailable.
  }
}

const FontSizeContext = createContext<{
  fontSize: FontSize;
  setFontSize: (fontSize: FontSize) => void;
} | null>(null);

export function FontSizeProvider({ children }: PropsWithChildren) {
  const [fontSize, setFontSize] = useState(readFontSizePreference);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--ui-font-scale",
      String(fontSize / 100),
    );
    document.documentElement.dataset.uiFontSize = String(fontSize);
    saveFontSizePreference(fontSize);
  }, [fontSize]);

  const value = useMemo(() => ({ fontSize, setFontSize }), [fontSize]);
  return (
    <FontSizeContext.Provider value={value}>{children}</FontSizeContext.Provider>
  );
}

export function useFontSize() {
  const context = useContext(FontSizeContext);
  if (!context) throw new Error("useFontSize must be used within FontSizeProvider");
  return context;
}
