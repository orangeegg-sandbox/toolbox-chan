import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useToolbox } from "../ToolboxContext";
import type { PaletteCommand, PaletteSnapshot } from "./types";

/** The main window retains all tool state and is the only action executor. */
export function useDesktopPalette(commands: readonly PaletteCommand[], shortcutLabel: string) {
  const { notify } = useToolbox();
  const latest = useRef(commands);
  latest.current = commands;
  const ready = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const subscription = listen<{ id: string }>("palette-execute", ({ payload }) => {
      if (disposed) return;
      const command = latest.current.find((entry) => entry.id === payload?.id);
      if (!command || command.disabled) {
        notify("That command is no longer available. Open the palette and try again.");
        return;
      }
      try {
        Promise.resolve(command.run()).catch(() => notify(`Could not run “${command.name}”. Please try again.`, true));
      } catch {
        notify(`Could not run “${command.name}”. Please try again.`, true);
      }
    });
    ready.current = subscription.then(() => undefined);
    // Attach a rejection handler immediately; publishing also reports failures.
    void ready.current.catch(() => undefined);
    return () => {
      disposed = true;
      ready.current = null;
      void subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [notify]);

  useEffect(() => {
    if (!isTauri()) return;
    let current = true;
    const snapshot: PaletteSnapshot = {
      commands: commands.map(({ id, name, description, keywords, kind, disabled }) => ({ id, name, description, keywords, kind, disabled })),
      shortcutLabel,
    };
    void ready.current?.then(() => {
      if (current) return invoke("palette_update_snapshot", { snapshot });
    }).catch(() => {
      if (current) notify("The floating command palette could not connect. In-app search is still available.", true);
    });
    return () => { current = false; };
  }, [commands, shortcutLabel, notify]);
}
