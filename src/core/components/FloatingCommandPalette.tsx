import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { History, Keyboard, LayoutGrid, Settings2, Terminal, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FONT_SIZE_STORAGE_KEY, FontSizeProvider, parseFontSize, readFontSizePreference, useFontSize,
} from "../appearance/FontSizeProvider";
import { ThemeProvider } from "../appearance/ThemeProvider";
import type { PaletteCommand, PaletteSnapshot } from "../commands/types";
import { CommandPaletteView } from "./CommandPalette";
import "../styles.css";
import "../commands/palette.css";

function describeError(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

/** A lightweight window that forwards commands to the existing main session. */
export function FloatingCommandPalette() {
  return (
    <ThemeProvider>
      <FontSizeProvider>
        <FloatingPaletteSession />
      </FontSizeProvider>
    </ThemeProvider>
  );
}

function FloatingPaletteSession() {
  const [snapshot, setSnapshot] = useState<PaletteSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState(0);
  const execution = useRef(false);
  const hasSnapshot = useRef(false);
  const { setFontSize } = useFontSize();

  useEffect(() => {
    document.title = "Toolbox-Chan — Command palette";
    const syncFontSize = (event: StorageEvent) => {
      if (event.key === FONT_SIZE_STORAGE_KEY || event.key === null) {
        setFontSize(event.key === null ? readFontSizePreference() : parseFontSize(event.newValue));
      }
    };
    window.addEventListener("storage", syncFontSize);
    return () => window.removeEventListener("storage", syncFontSize);
  }, [setFontSize]);

  useEffect(() => {
    let active = true;
    let eventRevision = 0;
    const subscriptions: UnlistenFn[] = [];
    setLoading(true);
    setError(null);

    function receive(value: PaletteSnapshot) {
      hasSnapshot.current = true;
      setSnapshot(value);
      setLoading(false);
      setError(null);
    }

    void (async () => {
      if (!isTauri()) throw new Error("Open the Toolbox-Chan desktop app to use the floating palette.");
      const unsubscribeSnapshot = await listen<PaletteSnapshot>("palette-snapshot", ({ payload }) => {
        if (!active) return;
        eventRevision++;
        receive(payload);
      });
      if (!active) { unsubscribeSnapshot(); return; }
      subscriptions.push(unsubscribeSnapshot);
      const unsubscribeOpened = await listen("palette-opened", () => {
        if (!active) return;
        setSession((value) => value + 1);
        if (hasSnapshot.current) setError(null);
      });
      if (!active) { unsubscribeOpened(); return; }
      subscriptions.push(unsubscribeOpened);
      // Subscribe first so an update cannot be lost during the initial read.
      const revisionBeforeRead = eventRevision;
      try {
        const initial = await invoke<PaletteSnapshot>("palette_get_snapshot");
        if (active && revisionBeforeRead === eventRevision) receive(initial);
      } catch (reason) {
        // A newer pushed snapshot is already usable, even if the older read fails.
        if (revisionBeforeRead === eventRevision) throw reason;
      }
    })().catch((reason: unknown) => {
      if (!active) return;
      setLoading(false);
      setError(`Could not load your commands. ${describeError(reason)}`);
    });
    return () => {
      active = false;
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }, [attempt]);

  const commands = useMemo<PaletteCommand[]>(() => (snapshot?.commands ?? []).map((command) => ({
    ...command,
    icon: command.id === "tools" ? LayoutGrid
      : command.id === "history" ? History
        : command.id === "settings" ? Settings2
          : command.id === "help" ? Keyboard
            : command.kind === "tool" ? Wrench : Terminal,
    run: () => undefined,
  })), [snapshot]);

  async function run(command: PaletteCommand) {
    if (execution.current) return;
    execution.current = true;
    setBusy(true);
    setError(null);
    try {
      await invoke("palette_execute", { id: command.id });
    } catch (reason) {
      setError(`Could not run “${command.name}”. ${describeError(reason)}`);
    } finally {
      execution.current = false;
      setBusy(false);
    }
  }

  function close() {
    void invoke("palette_hide").catch((reason: unknown) => {
      setError(`Could not close the palette. ${describeError(reason)}`);
    });
  }

  return (
    <div className="floating-palette-shell">
      <CommandPaletteView
        key={session}
        commands={commands}
        shortcutLabel={snapshot?.shortcutLabel ?? "Command palette"}
        onRun={run}
        onClose={close}
        floating
        loading={loading}
        busy={busy}
        error={error}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    </div>
  );
}
