import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// The pet window's link to its native side (`src-tauri/src/tools/agent-pet/window.rs`).
// The browser preview has no native window: the page gets real pointer events
// and nothing needs to pass clicks through.

export interface NativePointer {
  /** Cursor position in this window's CSS pixels. */
  x: number;
  y: number;
  /** Another app is full screen on this screen. */
  fullscreen: boolean;
}

/** The cursor, also while the window lets clicks pass through and receives no mouse events. */
export function subscribeNativePointer(listener: (pointer: NativePointer) => void): () => void {
  if (!isTauri()) return () => undefined;
  let disposed = false;
  const subscription = listen<NativePointer>("agent-pet-pointer", ({ payload }) => {
    if (!disposed) listener(payload);
  });
  void subscription.catch(() => undefined);
  return () => {
    disposed = true;
    void subscription.then((unlisten) => unlisten()).catch(() => undefined);
  };
}

let reported = "";

/**
 * Tells the native window whether any pet is shown, whether the cursor is over
 * one, and whether the window follows the mouse to other screens (otherwise it
 * stays on the main screen). Clicks pass through everywhere the page does not
 * take them. Repeats are not sent.
 */
export function reportPetWindow(shown: boolean, interactive: boolean, follow: boolean) {
  if (!isTauri()) return;
  const key = `${shown}:${interactive}:${follow}`;
  if (key === reported) return;
  reported = key;
  void invoke("agent_pet_set_window", { shown, interactive, follow }).catch(() => {
    reported = "";
  });
}
