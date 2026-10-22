import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type PropsWithChildren,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  formatShortcut, PALETTE_SHORTCUT_STORAGE_KEY, parseShortcut,
  readPaletteShortcut, savePaletteShortcut, validateShortcut,
} from "./shortcuts";

type ShortcutContextValue = {
  shortcut: string;
  shortcutLabel: string;
  setShortcut: (shortcut: string) => Promise<boolean>;
  recording: boolean;
  setRecording: (recording: boolean) => void;
  nativeActive: boolean;
  nativeRequest: number;
  error: string | null;
};

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

function supportsNativeShortcut() {
  return isTauri() && /Windows|Win32|Win64/i.test(navigator.userAgent + navigator.platform);
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ShortcutProvider({ children }: PropsWithChildren) {
  const [shortcut, setShortcutState] = useState(readPaletteShortcut);
  const [recording, setRecordingState] = useState(false);
  const [nativeActive, setNativeActive] = useState(false);
  const [nativeRequest, setNativeRequest] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const nativeSupported = supportsNativeShortcut();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const updateSequence = useRef(0);
  const setRecording = useCallback((value: boolean) => {
    if (value) setError(null);
    setRecordingState(value);
  }, []);

  // Keep asynchronous native updates in order, including React effect cleanups.
  const applyNative = useCallback((value: string): Promise<unknown> => {
    const operation = queue.current.catch(() => undefined).then(() =>
      invoke("set_palette_shortcut", { shortcut: value }),
    );
    queue.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    if (!nativeSupported) return;
    let current = true;
    let unlisten: (() => void) | undefined;
    if (recording) setNativeActive(false);
    // Subscribe before enabling Windows input so a registered shortcut always
    // has a frontend receiver. Failed subscription leaves the local fallback.
    void (async () => {
      if (!recording) {
        unlisten = await listen("palette-requested", () => {
          if (current) setNativeRequest((previous) => previous + 1);
        });
      }
      if (!current) { unlisten?.(); return; }
      await applyNative(recording ? "" : shortcut);
      if (current) {
        setNativeActive(!recording);
        // Keep a rejected replacement's explanation after restoring the prior
        // binding. Clear it when the user records again or successfully saves.
        setError((previous) => previous?.startsWith("The desktop shortcut could not be enabled.") ? null : previous);
      }
    })().catch((reason: unknown) => {
      if (!current) return;
      void applyNative("").catch(() => undefined);
      setNativeActive(false);
      setError(`The desktop shortcut could not be enabled. It still works while the toolbox is focused. ${describeError(reason)}`);
    });
    return () => {
      current = false;
      unlisten?.();
      void applyNative("").catch(() => undefined);
    };
  }, [applyNative, nativeSupported, recording, shortcut]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === PALETTE_SHORTCUT_STORAGE_KEY || event.key === null) {
        setShortcutState(readPaletteShortcut());
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const setShortcut = useCallback(async (value: string): Promise<boolean> => {
    const validationError = validateShortcut(value);
    if (validationError || !parseShortcut(value)) {
      setError(validationError ?? "Choose a valid shortcut.");
      return false;
    }
    const sequence = ++updateSequence.current;
    if (nativeSupported) {
      try {
        await applyNative(value);
      } catch (reason) {
        if (sequence === updateSequence.current) {
          setError(`The shortcut could not be saved. Your previous shortcut is still selected. ${describeError(reason)}`);
        }
        return false;
      }
    }
    if (sequence !== updateSequence.current) return false;
    setShortcutState(value);
    savePaletteShortcut(value);
    setNativeActive(nativeSupported && !recording);
    setError(null);
    return true;
  }, [applyNative, nativeSupported, recording]);

  return (
    <ShortcutContext.Provider value={{
      shortcut, shortcutLabel: formatShortcut(shortcut), setShortcut,
      recording, setRecording, nativeActive, nativeRequest, error,
    }}>
      {children}
    </ShortcutContext.Provider>
  );
}

export function usePaletteShortcut() {
  const context = useContext(ShortcutContext);
  if (!context) throw new Error("usePaletteShortcut must be used within ShortcutProvider");
  return context;
}
