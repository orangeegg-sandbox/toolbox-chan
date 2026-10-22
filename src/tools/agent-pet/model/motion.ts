import type { PetEmote } from "../../../core/sdk";
import type { Mood } from "./petModel";

// How one pet moves. A body stands on the bottom edge of the pet window (the
// top of the taskbar) unless it is held, falling, or following the cursor.
// Distances and speeds scale with the pet's size. Mutating functions keep the
// animation loop allocation-free; they are pure apart from `world.random`.

export const POSES = ["idle", "walk", "working", "done", "needsyou", "held", "land", "sleep", "happy", "laugh", "surprised"] as const;
export type Pose = (typeof POSES)[number];

export interface Point {
  x: number;
  y: number;
}

export interface World {
  width: number;
  height: number;
  /** Pet size in CSS pixels. */
  size: number;
  cursor: Point | null;
  now: number;
  /** Seconds since the last step. */
  dt: number;
  random: () => number;
}

export interface Body {
  /** Feet position: the middle of the pet's baseline, in window CSS pixels. */
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  phase: "ground" | "held" | "air" | "landing" | "follow";
  wander: { walking: boolean; until: number; target: number };
  landUntil: number;
  emote?: { pose: Pose; until: number };
  /** Moving towards the cursor (with hysteresis) while following it. */
  chasing: boolean;
  calmSince: number;
  grab: Point;
  pose: Pose;
  poseSince: number;
}

export const SLEEP_AFTER_MS = 3 * 60_000;
export const EMOTE_MS = 1800;
export const LAND_MS = 320;
const WALK_SPEED = 0.45;
const FOLLOW_SPEED = 3;
/** Start chasing beyond this distance and stop inside the near one, so the cursor can reach the pet to click it. */
const FOLLOW_FAR = 1.1;
const FOLLOW_NEAR = 0.7;
const GRAVITY = 18;
const BOUNCE_MIN = 3;
const BOUNCE = 0.3;

const EMOTE_POSES: Record<PetEmote, Pose> = { happy: "happy", laugh: "laugh", surprised: "surprised", sleepy: "sleep" };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function floorOf(world: Pick<World, "height">) {
  return world.height;
}

function clampX(x: number, world: Pick<World, "width" | "size">) {
  return clamp(x, world.size * 0.3, world.width - world.size * 0.3);
}

export function createBody(index: number, world: World): Body {
  const x = clampX(world.width * (0.55 + index * 0.12), world);
  return {
    x, y: floorOf(world), vy: 0, facing: -1, phase: "ground",
    wander: { walking: false, until: world.now + 1500 + index * 900, target: x },
    landUntil: 0, chasing: false, calmSince: world.now, grab: { x: 0, y: 0 },
    pose: "idle", poseSince: world.now,
  };
}

function setPose(body: Body, pose: Pose, now: number) {
  if (body.pose !== pose) {
    body.pose = pose;
    body.poseSince = now;
  }
}

/** Advances one pet by `world.dt` seconds and picks its pose. */
export function stepBody(body: Body, mood: Mood, world: World) {
  const { now, dt, size } = world;
  const floor = floorOf(world);
  if (body.phase === "held") {
    setPose(body, "held", now);
    return;
  }
  if (mood !== "idle") body.calmSince = now;
  if (body.emote && now >= body.emote.until) body.emote = undefined;
  const emote = body.emote?.pose;

  if (mood === "done" && world.cursor) {
    if (body.phase !== "follow") {
      body.phase = "follow";
      body.chasing = true;
    }
    const dx = world.cursor.x - body.x;
    const dy = world.cursor.y - (body.y - size * 0.45);
    const distance = Math.hypot(dx, dy);
    if (distance > size * FOLLOW_FAR) body.chasing = true;
    else if (distance < size * FOLLOW_NEAR) body.chasing = false;
    if (body.chasing && distance > 0) {
      const step = Math.min(distance - size * FOLLOW_NEAR * 0.95, FOLLOW_SPEED * size * dt);
      if (step > 0) {
        body.x += (dx / distance) * step;
        body.y += (dy / distance) * step;
      }
      if (Math.abs(dx) > 1) body.facing = dx > 0 ? 1 : -1;
    }
    body.x = clampX(body.x, world);
    body.y = clamp(body.y, size * 0.95, floor);
    body.vy = 0;
    setPose(body, emote ?? (body.chasing ? "walk" : "done"), now);
    return;
  }
  // Done was cleared, or the cursor is unknown: come back down.
  if (body.phase === "follow") body.phase = "air";

  if (body.phase === "air" || body.y < floor - 0.5) {
    body.phase = "air";
    body.vy += GRAVITY * size * dt;
    body.y += body.vy * dt;
    if (body.y >= floor) {
      body.y = floor;
      if (body.vy > BOUNCE_MIN * size) {
        body.vy = -body.vy * BOUNCE;
      } else {
        body.vy = 0;
        body.phase = "landing";
        body.landUntil = now + LAND_MS;
      }
    }
    setPose(body, "held", now);
    return;
  }
  if (body.phase === "landing") {
    if (now < body.landUntil) {
      setPose(body, "land", now);
      return;
    }
    body.phase = "ground";
  }

  body.y = floor;
  body.x = clampX(body.x, world);
  if (emote) return setPose(body, emote, now);
  if (mood === "working") return setPose(body, "working", now);
  if (mood === "needs-you") return setPose(body, "needsyou", now);
  if (mood === "done") return setPose(body, "done", now);
  if (now - body.calmSince >= SLEEP_AFTER_MS) {
    body.wander.walking = false;
    return setPose(body, "sleep", now);
  }

  const wander = body.wander;
  if (wander.walking) {
    const dx = wander.target - body.x;
    const step = WALK_SPEED * size * dt;
    if (Math.abs(dx) <= step) {
      body.x = wander.target;
      wander.walking = false;
      wander.until = now + 2000 + world.random() * 5000;
    } else {
      body.x += Math.sign(dx) * step;
      body.facing = dx > 0 ? 1 : -1;
    }
    return setPose(body, wander.walking ? "walk" : "idle", now);
  }
  if (now >= wander.until) {
    const reach = Math.min(world.width * 0.3, size * 4);
    const target = clampX(body.x + (world.random() * 2 - 1) * reach, world);
    if (world.random() < 0.65 && Math.abs(target - body.x) > size * 0.3) {
      wander.walking = true;
      wander.target = target;
    } else {
      wander.until = now + 2000 + world.random() * 4000;
    }
  }
  setPose(body, "idle", now);
}

/** Wakes a sleeping pet and resets its idle timer. */
export function wakeBody(body: Body, now: number) {
  body.calmSince = now;
}

export function emoteBody(body: Body, emote: PetEmote, now: number) {
  body.emote = { pose: EMOTE_POSES[emote], until: now + EMOTE_MS };
  body.wander.walking = false;
  body.calmSince = now;
}

export function grabBody(body: Body, pointer: Point, now: number) {
  body.phase = "held";
  body.grab = { x: pointer.x - body.x, y: pointer.y - body.y };
  body.vy = 0;
  body.emote = undefined;
  body.wander.walking = false;
  body.calmSince = now;
  setPose(body, "held", now);
}

export function dragBody(body: Body, pointer: Point, world: Pick<World, "width" | "height" | "size">) {
  const before = body.x;
  body.x = clampX(pointer.x - body.grab.x, world);
  body.y = clamp(pointer.y - body.grab.y, world.size * 0.6, floorOf(world));
  // A held pet swings to face the way it is carried.
  if (Math.abs(body.x - before) > 0.5) body.facing = body.x > before ? 1 : -1;
}

/** Lets go: the pet falls from where it was dropped and lands with a small bounce. */
export function releaseBody(body: Body, world: Pick<World, "height" | "now">) {
  body.phase = body.y < floorOf(world) - 0.5 ? "air" : "landing";
  body.landUntil = world.now + LAND_MS;
  body.vy = 0;
  body.calmSince = world.now;
  body.wander.until = world.now + 1500;
}

/** Keeps a pet on screen when the window moves to a screen of another size. */
export function fitBody(body: Body, from: Pick<World, "width" | "height">, to: Pick<World, "width" | "height" | "size">) {
  if (from.width > 0 && from.width !== to.width) body.x = (body.x / from.width) * to.width;
  body.x = clampX(body.x, to);
  body.wander.target = clampX(body.wander.target, to);
  const grounded = body.phase === "ground" || body.phase === "landing" || body.y >= floorOf(from) - 0.5;
  body.y = grounded ? floorOf(to) : clamp(body.y, to.size * 0.6, floorOf(to));
}
