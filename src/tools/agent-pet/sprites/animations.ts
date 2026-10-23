import { AGENT_IDS, type AgentId } from "../../../core/sdk";
import { POSES, type Pose } from "../model/motion";

// Animation names match the frame names in `docs/design/agent-pets/art-brief.md`:
// `<agent>/<name>-<n>.png`, 256×256, facing right, feet at about y = 244.

export const FRAME_SIZE = 256;
export const BASELINE = 244;

export const ANIMATIONS: Record<Pose, { fps: number; loop: boolean }> = {
  idle: { fps: 3, loop: true },
  walk: { fps: 8, loop: true },
  working: { fps: 5, loop: true },
  done: { fps: 5, loop: true },
  needsyou: { fps: 3, loop: true },
  held: { fps: 4, loop: true },
  land: { fps: 8, loop: false },
  sleep: { fps: 1.2, loop: true },
  happy: { fps: 5, loop: true },
  laugh: { fps: 6, loop: true },
  surprised: { fps: 4, loop: true },
};

/** Used when an animation has no frames, so a partial set of art never breaks a pet. */
export const FALLBACK: Record<Pose, Pose | null> = {
  idle: null,
  walk: "idle",
  working: "idle",
  done: "happy",
  needsyou: "idle",
  held: "idle",
  land: "idle",
  sleep: "idle",
  happy: "idle",
  laugh: "happy",
  surprised: "idle",
};

export type FrameLibrary = Record<AgentId, Partial<Record<Pose, string[]>>>;

const FRAME_FILE = /(?:^|\/)([a-z]+)\/([a-z]+)-(\d+)\.png$/;

/** Builds the frame library from file paths such as `../assets/claude/walk-2.png` and their URLs. */
export function buildLibrary(files: Record<string, string>): FrameLibrary {
  const numbered: Record<string, [number, string][]> = {};
  for (const [path, url] of Object.entries(files)) {
    const match = FRAME_FILE.exec(path);
    if (!match || !AGENT_IDS.includes(match[1] as AgentId) || !POSES.includes(match[2] as Pose)) continue;
    (numbered[`${match[1]}/${match[2]}`] ??= []).push([Number(match[3]), url]);
  }
  const library = Object.fromEntries(AGENT_IDS.map((agent) => [agent, {}])) as FrameLibrary;
  for (const [key, frames] of Object.entries(numbered)) {
    const [agent, pose] = key.split("/") as [AgentId, Pose];
    library[agent][pose] = frames.sort(([a], [b]) => a - b).map(([, url]) => url);
  }
  return library;
}

/** The frames to play for a pose, following the fallbacks; null when the agent has no art at all. */
export function resolveFrames(library: FrameLibrary, agent: AgentId, pose: Pose): { pose: Pose; frames: string[] } | null {
  for (let current: Pose | null = pose; current; current = FALLBACK[current]) {
    const frames = library[agent][current];
    if (frames?.length) return { pose: current, frames };
  }
  return null;
}

/** Which frame shows `elapsed` milliseconds after the pose began. */
export function frameIndex(pose: Pose, count: number, elapsed: number): number {
  if (count <= 1) return 0;
  const { fps, loop } = ANIMATIONS[pose];
  const frame = Math.floor((Math.max(0, elapsed) * fps) / 1000);
  return loop ? frame % count : Math.min(frame, count - 1);
}
