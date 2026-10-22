import type { AgentId } from "../../../core/sdk";
import type { Pose } from "../model/motion";

// TEMPORARY placeholder art, drawn by code until the real sprite frames exist
// (see `docs/design/agent-pets/art-brief.md`). Simple chibi silhouettes in each
// character's colours, in the same 256×256 frame with feet at y = 244 and
// facing right. These are artwork colours, so they do not follow the UI theme.

interface Look {
  hair: string;
  hairTip: string;
  skin: string;
  outfit: string;
  trim: string;
  eyes: string;
  shoes: string;
  line: string;
}

const LOOKS: Record<AgentId, Look> = {
  claude: { hair: "#e07a2e", hairTip: "#f4a259", skin: "#ffe6d4", outfit: "#f5ecdc", trim: "#2b2422", eyes: "#c2581a", shoes: "#efe1c8", line: "#3a2a24" },
  codex: { hair: "#e8e6f6", hairTip: "#c4cbf2", skin: "#fff1e8", outfit: "#ffffff", trim: "#79aee8", eyes: "#3f86d8", shoes: "#ffffff", line: "#3a3a52" },
  deepseek: { hair: "#22397a", hairTip: "#3d8cff", skin: "#ffe9de", outfit: "#203066", trim: "#ffffff", eyes: "#3478f6", shoes: "#203066", line: "#1c2240" },
};

/** Frames per pose in the placeholder art. */
export const PLACEHOLDER_FRAMES: Record<Pose, number> = {
  idle: 3, walk: 4, working: 2, done: 2, needsyou: 2, held: 2, land: 2, sleep: 2, happy: 2, laugh: 2, surprised: 1,
};

type Eyes = "open" | "closed" | "happy" | "wide";
type Mouth = "smile" | "open" | "o";
type Arms = "down" | "up" | "forward" | "wave" | "sing";

interface Shape {
  bob: number;
  tilt: number;
  swing: number;
  squash: boolean;
  sit: boolean;
  stride: number;
  eyes: Eyes;
  mouth: Mouth;
  arms: Arms;
  wave: number;
}

function shapeOf(agent: AgentId, pose: Pose, frame: number): Shape {
  const shape: Shape = { bob: 0, tilt: 0, swing: 0, squash: false, sit: false, stride: 0, eyes: "open", mouth: "smile", arms: "down", wave: 0 };
  switch (pose) {
    case "idle":
      return { ...shape, bob: frame === 1 ? 1 : 0, eyes: frame === 2 ? "closed" : "open" };
    case "walk":
      return { ...shape, bob: frame % 2 ? -2 : 0, stride: [-5, 0, 5, 0][frame] ?? 0 };
    case "working":
      if (agent === "deepseek") return { ...shape, arms: "sing", mouth: "open", eyes: "happy", bob: frame ? -1 : 0, wave: frame };
      return { ...shape, arms: "forward", wave: frame, eyes: agent === "claude" && frame ? "closed" : "open" };
    case "done":
      return { ...shape, arms: "up", eyes: "happy", mouth: "open", bob: frame ? -6 : 0 };
    case "needsyou":
      return { ...shape, tilt: 9, arms: "wave", wave: frame, mouth: "o" };
    case "held":
      return { ...shape, swing: frame ? 5 : -5, arms: "up", eyes: "wide", mouth: "o" };
    case "land":
      return { ...shape, squash: frame === 0, eyes: frame === 0 ? "closed" : "open" };
    case "sleep":
      return { ...shape, sit: true, tilt: 10 + frame * 2, eyes: "closed", mouth: "o", bob: frame };
    case "happy":
      return { ...shape, arms: "up", eyes: "happy", bob: frame ? -3 : 0 };
    case "laugh":
      return { ...shape, arms: "down", eyes: "happy", mouth: "open", bob: frame ? -2 : 1, tilt: frame ? -4 : 4 };
    case "surprised":
      return { ...shape, eyes: "wide", mouth: "o", arms: "up", bob: -2 };
  }
}

const ARM_ENDS: Record<Arms, [number, number, number, number]> = {
  down: [92, 196, 164, 196],
  up: [84, 116, 172, 116],
  forward: [116, 184, 150, 182],
  wave: [92, 196, 180, 114],
  sing: [94, 194, 178, 120],
};

function Eye({ x, kind, look, sleepy }: { x: number; kind: Eyes; look: Look; sleepy: boolean }) {
  const y = 110;
  if (kind === "closed") return <path d={`M${x - 7} ${y + 1} Q${x} ${y + 7} ${x + 7} ${y + 1}`} fill="none" stroke={look.line} strokeWidth={3} strokeLinecap="round" />;
  if (kind === "happy") return <path d={`M${x - 7} ${y + 4} Q${x} ${y - 5} ${x + 7} ${y + 4}`} fill="none" stroke={look.line} strokeWidth={3} strokeLinecap="round" />;
  const ry = kind === "wide" ? 10 : sleepy ? 5 : 8;
  return (
    <g>
      <ellipse cx={x} cy={y + (sleepy && kind !== "wide" ? 2 : 0)} rx={kind === "wide" ? 8 : 6} ry={ry} fill={look.eyes} stroke={look.line} strokeWidth={1.5} />
      <circle cx={x + 2} cy={y - 3} r={2.2} fill="#ffffff" />
      {sleepy && kind !== "wide" && <path d={`M${x - 8} ${y - 3} L${x + 8} ${y - 3}`} stroke={look.line} strokeWidth={2.5} strokeLinecap="round" />}
    </g>
  );
}

function Mouth({ kind, look }: { kind: Mouth; look: Look }) {
  if (kind === "open") return <ellipse cx={132} cy={131} rx={6} ry={6} fill="#c0485a" stroke={look.line} strokeWidth={1.5} />;
  if (kind === "o") return <circle cx={132} cy={131} r={3.5} fill="#c0485a" stroke={look.line} strokeWidth={1.2} />;
  return <path d="M126 128 Q132 134 138 128" fill="none" stroke={look.line} strokeWidth={2.5} strokeLinecap="round" />;
}

function Accessories({ agent, look }: { agent: AgentId; look: Look }) {
  if (agent === "claude") {
    return (
      <g>
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <circle key={angle} cx={168 + 9 * Math.cos((angle * Math.PI) / 180)} cy={62 + 9 * Math.sin((angle * Math.PI) / 180)} r={5} fill="#f6a03a" stroke={look.line} strokeWidth={1} />
        ))}
        <circle cx={168} cy={62} r={5} fill="#d4581c" />
        <path d="M176 72 l10 6 l-10 4 z" fill={look.trim} />
      </g>
    );
  }
  if (agent === "codex") {
    return (
      <g>
        <path d="M98 58 L92 36 L110 52 Z" fill="#cfe3ff" stroke={look.line} strokeWidth={1.5} />
        <path d="M158 58 L164 36 L146 52 Z" fill="#cfe3ff" stroke={look.line} strokeWidth={1.5} />
        <ellipse cx={170} cy={70} rx={11} ry={7} fill="#7fb6ef" stroke={look.line} strokeWidth={1.2} />
      </g>
    );
  }
  return (
    <g>
      <path d="M78 96 L52 80 L70 124 Z" fill={look.hair} stroke={look.line} strokeWidth={1.5} />
      <path d="M178 96 L204 80 L186 124 Z" fill={look.hair} stroke={look.line} strokeWidth={1.5} />
      <path d="M92 56 Q128 34 164 56" fill="none" stroke={look.trim} strokeWidth={7} strokeLinecap="round" />
    </g>
  );
}

function Tail({ agent, look }: { agent: AgentId; look: Look }) {
  if (agent === "codex") return <path d="M104 200 Q60 214 46 188 Q66 200 98 188 Z" fill="#a9cdf2" stroke={look.line} strokeWidth={1.5} />;
  if (agent === "deepseek") return <path d="M100 198 Q74 206 66 196 L50 184 L60 208 L44 220 Q72 218 100 210 Z" fill={look.outfit} stroke={look.line} strokeWidth={1.5} />;
  return null;
}

function Outfit({ agent, look }: { agent: AgentId; look: Look }) {
  const dress = "M100 150 L156 150 L176 210 Q128 222 80 210 Z";
  return (
    <g>
      <path d={dress} fill={look.outfit} stroke={look.line} strokeWidth={2} />
      {agent === "claude" && (
        <g>
          <rect x={104} y={160} width={48} height={16} rx={4} fill={look.trim} />
          <path d="M96 192 L160 192" stroke="#e8833a" strokeWidth={5} />
          <circle cx={128} cy={154} r={4} fill="#e8833a" />
        </g>
      )}
      {agent === "codex" && <path d="M118 154 L128 162 L138 154 L128 160 Z M114 150 Q128 170 142 150" fill={look.trim} stroke={look.trim} strokeWidth={3} />}
      {agent === "deepseek" && (
        <g>
          <path d="M108 160 L148 160 L156 206 Q128 212 100 206 Z" fill={look.trim} stroke={look.line} strokeWidth={1.5} />
          <ellipse cx={128} cy={182} rx={6} ry={3.5} fill={look.hairTip} />
        </g>
      )}
    </g>
  );
}

function Prop({ agent, look, frame }: { agent: AgentId; look: Look; frame: number }) {
  if (agent === "claude") {
    return frame ? (
      <g>
        <path d="M104 172 L128 178 L152 172 L152 196 L128 202 L104 196 Z" fill="#fffaf0" stroke={look.line} strokeWidth={1.5} />
        <path d="M128 178 L128 202" stroke={look.line} strokeWidth={1.2} />
      </g>
    ) : (
      <g>
        <rect x={108} y={170} width={40} height={30} rx={3} fill="#8a5a35" stroke={look.line} strokeWidth={1.5} />
        <circle cx={128} cy={185} r={6} fill="#f6a03a" />
      </g>
    );
  }
  if (agent === "codex") {
    return (
      <g>
        <rect x={144} y={142} width={70} height={46} rx={6} fill="#1d2433" stroke="#7fb6ef" strokeWidth={2} />
        <path d="M154 156 L162 162 L154 168" fill="none" stroke="#9bd6c5" strokeWidth={3} strokeLinecap="round" />
        {frame === 0 && <path d="M168 170 L182 170" stroke="#9bd6c5" strokeWidth={3} strokeLinecap="round" />}
      </g>
    );
  }
  const y = 84 - frame * 10;
  return (
    <g>
      <circle cx={196} cy={y + 18} r={6} fill={look.hairTip} />
      <path d={`M201 ${y + 18} L201 ${y} L212 ${y + 4}`} fill="none" stroke={look.hairTip} strokeWidth={3} strokeLinecap="round" />
    </g>
  );
}

/** One placeholder frame: `frame` counts from 0 within the pose. */
export function PlaceholderPet({ agent, pose, frame, size, flipped }: { agent: AgentId; pose: Pose; frame: number; size: number; flipped: boolean }) {
  const look = LOOKS[agent];
  const shape = shapeOf(agent, pose, frame);
  const [leftX, leftY, rightX, rightY] = ARM_ENDS[shape.arms];
  const wave = shape.arms === "wave" || shape.arms === "forward" ? shape.wave * 6 : 0;
  const whole = [
    shape.swing ? `rotate(${shape.swing} 128 60)` : "",
    shape.squash ? "translate(128 244) scale(1.08 0.86) translate(-128 -244)" : "",
    `translate(0 ${shape.bob + (shape.sit ? 18 : 0)})`,
  ].join(" ");
  return (
    <svg
      className="pet-placeholder"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      aria-hidden="true"
      style={flipped ? { transform: "scaleX(-1)" } : undefined}
    >
      <g transform={whole}>
        <path d="M72 100 Q64 170 86 214 L170 214 Q192 170 184 100 Z" fill={look.hair} stroke={look.line} strokeWidth={2} />
        <path d="M80 196 Q84 208 86 214 L170 214 Q172 208 176 196 Z" fill={look.hairTip} />
        <Tail agent={agent} look={look} />
        {!shape.sit && (
          <g>
            <rect x={106 + shape.stride} y={204} width={12} height={34} rx={6} fill={look.skin} stroke={look.line} strokeWidth={1.5} />
            <rect x={138 - shape.stride} y={204} width={12} height={34} rx={6} fill={look.skin} stroke={look.line} strokeWidth={1.5} />
            <ellipse cx={113 + shape.stride} cy={240} rx={10} ry={5} fill={look.shoes} stroke={look.line} strokeWidth={1.5} />
            <ellipse cx={145 - shape.stride} cy={240} rx={10} ry={5} fill={look.shoes} stroke={look.line} strokeWidth={1.5} />
          </g>
        )}
        <Outfit agent={agent} look={look} />
        <path d={`M102 158 L${leftX} ${leftY - (shape.arms === "forward" ? wave : 0)}`} stroke={look.outfit} strokeWidth={12} strokeLinecap="round" />
        <path d={`M154 158 L${rightX} ${rightY - wave}`} stroke={look.outfit} strokeWidth={12} strokeLinecap="round" />
        <circle cx={leftX} cy={leftY - (shape.arms === "forward" ? wave : 0)} r={6} fill={look.skin} stroke={look.line} strokeWidth={1.2} />
        <circle cx={rightX} cy={rightY - wave} r={6} fill={look.skin} stroke={look.line} strokeWidth={1.2} />
        <g transform={shape.tilt ? `rotate(${shape.tilt} 128 146)` : undefined}>
          <circle cx={128} cy={104} r={46} fill={look.skin} stroke={look.line} strokeWidth={2} />
          <path d="M76 98 Q78 44 128 42 Q178 44 180 98 Q162 74 142 82 Q128 66 112 82 Q94 74 76 98 Z" fill={look.hair} stroke={look.line} strokeWidth={2} />
          <ellipse cx={106} cy={124} rx={7} ry={4} fill="#f4a3a8" opacity={0.5} />
          <ellipse cx={156} cy={124} rx={7} ry={4} fill="#f4a3a8" opacity={0.5} />
          <Eye x={116} kind={shape.eyes} look={look} sleepy={agent === "codex"} />
          <Eye x={148} kind={shape.eyes} look={look} sleepy={agent === "codex"} />
          <Mouth kind={shape.mouth} look={look} />
          <Accessories agent={agent} look={look} />
        </g>
        {pose === "working" && <Prop agent={agent} look={look} frame={frame} />}
      </g>
    </svg>
  );
}
