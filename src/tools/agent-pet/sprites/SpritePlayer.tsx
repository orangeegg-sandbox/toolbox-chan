import type { AgentId } from "../../../core/sdk";
import type { Pose } from "../model/motion";
import { frameIndex, resolveFrames, type FrameLibrary } from "./animations";
import { frameLibrary } from "./library";
import { moveFrame, type IdleMove } from "./moves";

interface SpritePlayerProps {
  agent: AgentId;
  pose: Pose;
  /** Milliseconds since the pose (or the move) began. */
  elapsed: number;
  size: number;
  /** The art faces right; -1 mirrors it. */
  facing: 1 | -1;
  library?: FrameLibrary;
  /** An idle move to play instead of the pose. */
  move?: IdleMove;
}

/** Plays a pose from the agent's frames, falling back to a similar pose when one is missing. */
export function SpritePlayer({ agent, pose, elapsed, size, facing, library = frameLibrary, move }: SpritePlayerProps) {
  const resolved = move ? null : resolveFrames(library, agent, pose);
  if (!move && !resolved) return null;
  const src = move ? moveFrame(move, elapsed) : resolved!.frames[frameIndex(resolved!.pose, resolved!.frames.length, elapsed)];
  return (
    <img
      className="pet-frame"
      src={src}
      width={size}
      height={size}
      alt=""
      draggable={false}
      data-pose={move ? "move" : resolved!.pose}
      data-move={move?.id}
      style={facing < 0 ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}
