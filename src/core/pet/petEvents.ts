import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { petEventError, type PetAction, type PetBadgeEntry, type PetEvent, type PetState } from "./types";

// In the desktop app the native hub validates events, keeps the latest badges and
// forwards events to every window, including events from outside programs. The
// browser preview has no native hub; this page-local one follows the same rules
// so tool workspaces and tests run without Tauri.
const local = {
  badges: new Map<string, PetBadgeEntry>(),
  events: new Set<(event: PetEvent) => void>(),
  openTool: new Set<(toolId: string) => void>(),
};

function publishLocally(event: PetEvent) {
  if (event.badge !== undefined) {
    const key = `${event.agent ?? "*"}\u0000${event.source}`;
    if (event.badge)
      local.badges.set(key, { ...(event.agent && { agent: event.agent }), source: event.source, badge: event.badge });
    else local.badges.delete(key);
  }
  for (const listener of [...local.events]) listener(event);
}

function subscribeNative<T>(name: string, listener: (payload: T) => void): () => void {
  let disposed = false;
  const subscription = listen<T>(name, ({ payload }) => {
    if (!disposed) listener(payload);
  });
  void subscription.catch(() => undefined);
  return () => {
    disposed = true;
    void subscription.then((unlisten) => unlisten()).catch(() => undefined);
  };
}

/**
 * Tells the pets what happened. Never throws: when no pet is listening, or the
 * event is invalid, it is dropped with a console warning.
 */
export async function notifyPet(event: PetEvent): Promise<void> {
  try {
    if (isTauri()) {
      await invoke("pet_notify", { event });
      return;
    }
    const error = petEventError(event);
    if (error) throw new Error(error);
    publishLocally(structuredClone(event));
  } catch (error) {
    console.warn("The pet event was not delivered.", error);
  }
}

/** Every valid event from any caller, in the app or outside it. */
export function subscribePetEvents(listener: (event: PetEvent) => void): () => void {
  if (isTauri()) return subscribeNative("pet-event", listener);
  local.events.add(listener);
  return () => {
    local.events.delete(listener);
  };
}

/** The tray's Show pets switch. The browser preview has no tray, so it never changes there. */
export function subscribePetVisibility(listener: (visible: boolean) => void): () => void {
  if (isTauri()) return subscribeNative<{ visible: boolean }>("pet-visibility", ({ visible }) => listener(visible));
  return () => undefined;
}

/** Current visibility, latest badges, and the outside door's address, for a pet that just started. */
export async function getPetState(): Promise<PetState> {
  if (isTauri()) return invoke<PetState>("pet_get_state");
  return {
    visible: true,
    badges: [...local.badges.values()].map((entry) => structuredClone(entry)),
    door: { url: "", listening: false, error: "Outside programs can reach the pets in the desktop app only." },
  };
}

/**
 * Runs a badge's or a message's action. For `open-tool` the core shows the
 * toolbox and opens that tool; for `open-link` it opens the agent's app.
 */
export async function runPetAction(action: PetAction): Promise<void> {
  if (isTauri()) {
    await invoke("pet_run_action", { action });
    return;
  }
  if (action.type === "open-tool") for (const listener of [...local.openTool]) listener(action.toolId);
  else window.open(action.url, "_blank", "noopener");
}

/** Core only: the toolbox window opens the tool that a badge action names. */
export function subscribePetOpenTool(listener: (toolId: string) => void): () => void {
  if (isTauri()) return subscribeNative<{ toolId: string }>("pet-open-tool", ({ toolId }) => listener(toolId));
  local.openTool.add(listener);
  return () => {
    local.openTool.delete(listener);
  };
}
