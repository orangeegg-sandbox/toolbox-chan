import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { moveId, type IdleMove, type MoveInfo } from "../sprites/moves";

// Imported idle moves live in the app data folder, managed by native code
// (`src-tauri/src/tools/agent-pet/idle_moves.rs`), which checks every frame
// before copying it. The browser preview has only the moves shipped with the app.

interface NativeMove extends MoveInfo {
  /** PNG frames as data URLs, in order. */
  frames: string[];
}

const CHANGED_EVENT = "agent-pet-idle-moves";

export function idleMovesAvailable() {
  return isTauri();
}

function toMove(move: NativeMove): IdleMove {
  return { ...move, id: moveId(move), builtIn: false };
}

export async function listIdleMoves(): Promise<IdleMove[]> {
  if (!isTauri()) return [];
  return (await invoke<NativeMove[]>("agent_pet_idle_moves")).map(toMove);
}

/**
 * Asks for a move folder, checks it, and copies it. Resolves to null when the
 * user cancels; rejects with the reason when the folder breaks the format.
 */
export async function importIdleMove(): Promise<IdleMove | null> {
  const move = await invoke<NativeMove | null>("agent_pet_import_idle_move");
  return move ? toMove(move) : null;
}

export async function removeIdleMove(move: Pick<IdleMove, "agent" | "name">): Promise<void> {
  await invoke("agent_pet_remove_idle_move", { agent: move.agent, name: move.name });
}

/** Calls `listener` after a move is added or removed in any window. */
export function subscribeIdleMoves(listener: () => void): () => void {
  if (!isTauri()) return () => undefined;
  let disposed = false;
  const subscription = listen(CHANGED_EVENT, () => {
    if (!disposed) listener();
  });
  void subscription.catch(() => undefined);
  return () => {
    disposed = true;
    void subscription.then((unlisten) => unlisten()).catch(() => undefined);
  };
}
