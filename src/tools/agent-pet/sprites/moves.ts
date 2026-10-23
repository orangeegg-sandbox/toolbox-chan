import { AGENT_IDS, type AgentId } from "../../../core/sdk";

// Idle moves: short extra animations a pet plays now and then while idle. The
// format is in `docs/design/agent-pets/idle-moves.md`; the native importer
// (`src-tauri/src/tools/agent-pet/idle_moves.rs`) checks the same rules.

export interface MoveInfo {
  agent: AgentId;
  name: string;
  label: string;
  fps: number;
  loops: number;
}

export interface IdleMove extends MoveInfo {
  /** `<agent>/<name>`, used to turn a move off. */
  id: string;
  frames: string[];
  /** Shipped with the app; imported moves can be removed. */
  builtIn: boolean;
}

export const MAX_MOVE_FRAMES = 24;
const NAME = /^[a-z][a-z0-9]{0,23}$/;

/** The fields of a `move.json`, or null when they break the format. */
export function parseMoveInfo(value: unknown): MoveInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const fields = value as Record<string, unknown>;
  const { agent, name, label, fps, loops } = fields;
  if (fields.format !== 1 || !AGENT_IDS.includes(agent as AgentId) || typeof name !== "string" || !NAME.test(name)) return null;
  if (typeof fps !== "number" || !Number.isInteger(fps) || fps < 1 || fps > 24) return null;
  if (typeof loops !== "number" || !Number.isInteger(loops) || loops < 1 || loops > 10) return null;
  if (label !== undefined && (typeof label !== "string" || label.length > 40)) return null;
  const text = typeof label === "string" && label.trim() ? label.trim() : name;
  return { agent: agent as AgentId, name, label: text, fps, loops };
}

export function moveId(move: Pick<MoveInfo, "agent" | "name">) {
  return `${move.agent}/${move.name}`;
}

/** How long one play of the move lasts, in milliseconds. */
export function moveDuration(move: Pick<IdleMove, "frames" | "fps" | "loops">) {
  return (move.frames.length / move.fps) * move.loops * 1000;
}

export function moveFrame(move: Pick<IdleMove, "frames" | "fps">, elapsed: number) {
  return move.frames[Math.floor((Math.max(0, elapsed) * move.fps) / 1000) % move.frames.length];
}

/** Builds moves from `<folder>/move.json` files and their `<folder>/<name>-<n>.png` frames. */
export function buildMoves(infos: Record<string, unknown>, files: Record<string, string>): IdleMove[] {
  const moves: IdleMove[] = [];
  for (const [path, value] of Object.entries(infos)) {
    const info = parseMoveInfo(value);
    if (!info) continue;
    const folder = path.slice(0, path.lastIndexOf("/") + 1);
    const frames: string[] = [];
    for (let index = 1; index <= MAX_MOVE_FRAMES && files[`${folder}${info.name}-${index}.png`]; index++)
      frames.push(files[`${folder}${info.name}-${index}.png`]);
    if (frames.length) moves.push({ ...info, id: moveId(info), frames, builtIn: true });
  }
  return moves.sort((a, b) => a.id.localeCompare(b.id));
}

// Runtime copies of `docs/design/agent-pets/idle-moves/<folder>/`, found at build time.
const infos = import.meta.glob("../assets/idle-moves/*/move.json", { eager: true, import: "default" });
const frames = import.meta.glob<string>("../assets/idle-moves/*/*.png", { eager: true, query: "?url", import: "default" });

export const builtInMoves = buildMoves(infos, frames);

/** Imported moves replace shipped ones with the same id. */
export function mergeMoves(builtIn: readonly IdleMove[], imported: readonly IdleMove[]): IdleMove[] {
  const byId = new Map(builtIn.map((move) => [move.id, move]));
  for (const move of imported) byId.set(move.id, move);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
