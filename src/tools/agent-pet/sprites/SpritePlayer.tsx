import type { AgentId } from "../../../core/sdk";
import type { Pose } from "../model/motion";
import { frameIndex, resolveFrames, type FrameLibrary } from "./animations";
import { frameLibrary } from "./library";

interface SpritePlayerProps {
  agent: AgentId;
  pose: Pose;
  /** Milliseconds since the pose began. */
  elapsed: number;
  size: number;
  /** The art faces right; -1 mirrors it. */
  facing: 1 | -1;
  library?: FrameLibrary;
}

/** Plays a pose from the agent's frames, falling back to a similar pose when one is missing. */
export function SpritePlayer({ agent, pose, elapsed, size, facing, library = frameLibrary }: SpritePlayerProps) {
  const resolved = resolveFrames(library, agent, pose);
  if (!resolved) return null;
  const index = frameIndex(resolved.pose, resolved.frames.length, elapsed);
  return (
    <img
      className="pet-frame"
      src={resolved.frames[index]}
      width={size}
      height={size}
      alt=""
      draggable={false}
      data-pose={resolved.pose}
      style={facing < 0 ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}
