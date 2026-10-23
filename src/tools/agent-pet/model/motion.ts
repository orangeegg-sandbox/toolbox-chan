import type { PetEmote } from "../../../core/sdk";
import type { Mood } from "./petModel";

// How one pet moves. A body stands on the floor of its idle zone (or the bottom
// edge of the pet window, the top of the taskbar) unless it is held, falling,
// going home, warping through a portal, or travelling to the cursor. Distances
// and speeds scale with the pet's size. Mutating functions keep the animation
// loop allocation-free; they are pure apart from `world.random`.

export const POSES = ["idle", "walk", "working", "done", "needsyou", "held", "land", "sleep", "happy", "laugh", "surprised"] as const;
export type Pose = (typeof POSES)[number];

/** How a pet reaches the user while something wants them. */
export type Travel = "stay" | "walk" | "teleport";

export interface Point {
  x: number;
  y: number;
}

/** The idle zone in window CSS pixels: pets stand on `floor` between `left` and `right`. */
export interface Band {
  left: number;
  right: number;
  floor: number;
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
  /** Feet x of the other pets, so a wandering pet stops beside them rather than on top of them. */
  others?: readonly number[];
  /** The idle zone; without one, pets use the whole bottom edge. */
  zone?: Band;
  /** Walk about while idle. On unless false. */
  wander?: boolean;
  /** Fall asleep after a quiet while. On unless false. */
  doze?: boolean;
}

/** What the pet should do beyond its mood. */
export interface Plan {
  /** How to reach the user. Defaults to "walk" when done and "stay" otherwise. */
  travel?: Travel;
  /** The agent's limit was reset: cheer at home until clicked. */
  reset?: boolean;
}

/** A trip through two portals: in at `from`, out at `to`. */
export interface Warp {
  from: Point;
  to: Point;
  since: number;
  /** What the pet does on arrival: keep near the cursor, or stand at home. */
  then: "follow" | "ground";
}

export interface Body {
  /** Feet position: the middle of the pet's baseline, in window CSS pixels. */
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  phase: "ground" | "held" | "air" | "landing" | "follow" | "home" | "warp";
  wander: { walking: boolean; until: number; target: number };
  landUntil: number;
  emote?: { pose: Pose; until: number };
  /** An idle move playing now, by id. */
  act?: { id: string; since: number; until: number };
  warp?: Warp;
  /** How the pet reached the cursor, so it goes home the same way. */
  via: Travel;
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
/** Portal timing: open, fall in, open the exit, jump out, close. */
export const WARP = { open: 220, sink: 420, rise: 480, close: 220 } as const;
export const WARP_MS = WARP.open + WARP.sink + WARP.open + WARP.rise + WARP.close;
/** Matches the walk cycle's stride at 8 frames per second, so feet do not slide. */
const WALK_SPEED = 0.32;
const HOME_SPEED = 0.9;
const FOLLOW_SPEED = 3;
/** Start chasing beyond this distance and stop inside the near one, so the cursor can reach the pet to click it. */
const FOLLOW_FAR = 1.1;
const FOLLOW_NEAR = 0.7;
/** A teleporting pet warps again when the cursor gets this far away (in screen widths); shorter moves it walks. */
const WARP_AGAIN = 1 / 3;
/** Closest a wandering pet chooses to stop next to another pet. */
const PERSONAL_SPACE = 0.75;
/** Height of the hop into a portal and out of it. */
const HOP = 0.28;
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

/** The art spans about 0.35 of the frame either side of its centre; keep all of it on screen. */
function clampX(x: number, world: Pick<World, "width" | "size">) {
  return clamp(x, world.size * 0.4, world.width - world.size * 0.4);
}

export function bandOf(world: Pick<World, "width" | "height" | "zone">): Band {
  return world.zone ?? { left: 0, right: world.width, floor: world.height };
}

/** Where feet may stand at home; a zone narrower than a pet keeps it at the zone's middle. */
function clampHome(x: number, world: Pick<World, "width" | "height" | "size" | "zone">) {
  const band = bandOf(world);
  const inner = { left: band.left + world.size * 0.4, right: band.right - world.size * 0.4 };
  const home = inner.left <= inner.right ? clamp(x, inner.left, inner.right) : (band.left + band.right) / 2;
  return clampX(home, world);
}

/** The ground under `x`: the zone's floor above the zone, the bottom edge elsewhere. */
function floorAt(x: number, world: Pick<World, "width" | "height" | "zone">) {
  const band = bandOf(world);
  return x >= band.left && x <= band.right ? band.floor : world.height;
}

function atHome(body: Body, world: World) {
  return Math.abs(body.y - bandOf(world).floor) < 0.5 && Math.abs(clampHome(body.x, world) - body.x) < 1;
}

export function createBody(index: number, world: World): Body {
  const band = bandOf(world);
  // Spread across the zone, so three pets start apart even in a small one.
  const x = clampHome(band.left + (band.right - band.left) * (0.2 + index * 0.3), world);
  return {
    x, y: band.floor, vy: 0, facing: -1, phase: "ground",
    wander: { walking: false, until: world.now + 1500 + index * 900, target: x },
    landUntil: 0, via: "stay", chasing: false, calmSince: world.now, grab: { x: 0, y: 0 },
    pose: "idle", poseSince: world.now,
  };
}

function setPose(body: Body, pose: Pose, now: number) {
  if (body.pose !== pose) {
    body.pose = pose;
    body.poseSince = now;
  }
}

/** The pose for a pet resting near the cursor. */
function callPose(mood: Mood): Pose {
  return mood === "done" ? "done" : mood === "needs-you" ? "needsyou" : "happy";
}

function startWarp(body: Body, to: Point, then: Warp["then"], now: number) {
  body.warp = { from: { x: body.x, y: body.y }, to, since: now, then };
  body.phase = "warp";
  body.vy = 0;
  body.chasing = false;
  body.wander.walking = false;
  body.act = undefined;
  if (Math.abs(to.x - body.x) > 1) body.facing = to.x > body.x ? 1 : -1;
}

/** A spot beside the cursor, on the side the pet comes from, so the cursor can still reach it. */
function besideCursor(body: Body, cursor: Point, world: World): Point {
  const side = body.x <= cursor.x ? -1 : 1;
  let x = cursor.x + side * world.size * FOLLOW_NEAR;
  if (x < world.size * 0.4 || x > world.width - world.size * 0.4) x = cursor.x - side * world.size * FOLLOW_NEAR;
  return { x: clampX(x, world), y: clamp(cursor.y + world.size * 0.45, world.size * 0.95, world.height) };
}

/** A spot in the zone away from the other pets, so pets coming home do not pile up. */
function homeTarget(body: Body, world: World) {
  const band = bandOf(world);
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = clampHome(band.left + (band.right - band.left) * (0.15 + world.random() * 0.7), world);
    if (!(world.others ?? []).some((x) => Math.abs(x - candidate) < world.size * PERSONAL_SPACE)) return candidate;
  }
  return clampHome(body.x, world);
}

function homeSpot(world: World): Point {
  const band = bandOf(world);
  const x = clampHome(band.left + (band.right - band.left) * (0.25 + world.random() * 0.5), world);
  return { x, y: band.floor };
}

/** Where portals and the sprite's cut-off line are during a warp. */
export interface WarpView {
  portals: { x: number; y: number; open: number; exit: boolean }[];
  /** Hide the sprite below this line (the active portal's surface). */
  clipY: number;
}

function opening(t: number, start: number, end: number) {
  if (t < start || t > end) return 0;
  return Math.min(1, (t - start) / WARP.open, (end - t) / WARP.close);
}

export function warpView(body: Body, now: number): WarpView | null {
  const warp = body.warp;
  if (!warp) return null;
  const t = now - warp.since;
  const exitStart = WARP.open + WARP.sink;
  return {
    portals: [
      { x: warp.from.x, y: warp.from.y, open: opening(t, 0, exitStart + WARP.close), exit: false },
      { x: warp.to.x, y: warp.to.y, open: opening(t, exitStart, WARP_MS), exit: true },
    ],
    clipY: t < exitStart ? warp.from.y : warp.to.y,
  };
}

function stepWarp(body: Body, warp: Warp, world: World) {
  const { now, size } = world;
  const t = now - warp.since;
  const hop = size * HOP;
  const sinkStart = WARP.open;
  const exitStart = WARP.open + WARP.sink;
  const riseStart = exitStart + WARP.open;
  const riseEnd = riseStart + WARP.rise;
  if (t < sinkStart) {
    body.x = warp.from.x;
    body.y = warp.from.y;
    setPose(body, "surprised", now);
  } else if (t < exitStart) {
    // A small hop, then a fall through the portal.
    const p = (t - sinkStart) / WARP.sink;
    body.y = p < 0.3 ? warp.from.y - hop * (p / 0.3) : warp.from.y - hop + (hop + size * 1.05) * ((p - 0.3) / 0.7) ** 2;
    setPose(body, "held", now);
  } else if (t < riseStart) {
    body.x = warp.to.x;
    body.y = warp.to.y + size * 1.05;
    setPose(body, "held", now);
  } else if (t < riseEnd) {
    // Jump out past the exit, then drop onto it.
    const p = (t - riseStart) / WARP.rise;
    body.x = warp.to.x;
    body.y = p < 0.55
      ? warp.to.y + size * 1.05 - (size * 1.05 + hop) * Math.sin((p / 0.55) * (Math.PI / 2))
      : warp.to.y - hop + hop * ((p - 0.55) / 0.45) ** 2;
    setPose(body, p < 0.55 ? "happy" : "held", now);
  } else {
    body.x = warp.to.x;
    body.y = warp.to.y;
    setPose(body, "land", now);
    if (t >= WARP_MS) {
      body.warp = undefined;
      if (warp.then === "follow") {
        body.phase = "follow";
        body.via = "teleport";
      } else {
        body.phase = "landing";
        body.landUntil = now;
        body.via = "stay";
        body.wander.until = now + 1500;
      }
    }
  }
}

/** Advances one pet by `world.dt` seconds and picks its pose. */
export function stepBody(body: Body, mood: Mood, world: World, plan: Plan = {}) {
  const { now, dt, size } = world;
  const travel = plan.travel ?? (mood === "done" ? "walk" : "stay");
  if (body.phase === "held") {
    setPose(body, "held", now);
    return;
  }
  if (mood !== "idle" || plan.reset) body.calmSince = now;
  if (body.emote && now >= body.emote.until) body.emote = undefined;
  if (body.act && (mood !== "idle" || plan.reset || body.emote || body.phase !== "ground" || now >= body.act.until)) body.act = undefined;
  const emote = body.emote?.pose;

  if (body.phase === "warp" && body.warp) {
    stepWarp(body, body.warp, world);
    return;
  }

  if (travel !== "stay" && world.cursor) {
    const cursor = world.cursor;
    const dx = cursor.x - body.x;
    const dy = cursor.y - (body.y - size * 0.45);
    const distance = Math.hypot(dx, dy);
    // Teleport there, and again whenever the cursor gets far away; short moves are walked.
    if (travel === "teleport" && (body.phase !== "follow" || distance > world.width * WARP_AGAIN)) {
      startWarp(body, besideCursor(body, cursor, world), "follow", now);
      stepWarp(body, body.warp!, world);
      return;
    }
    if (body.phase !== "follow") {
      body.phase = "follow";
      body.via = travel;
      body.chasing = true;
      body.wander.walking = false;
    }
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
    body.y = clamp(body.y, size * 0.95, world.height);
    body.vy = 0;
    // Walk when following along the ground; show the call while flying to the cursor.
    setPose(body, emote ?? (body.chasing && body.y >= world.height - 0.5 ? "walk" : callPose(mood)), now);
    return;
  }
  // Nothing wants the user any more, or the cursor is unknown: go back the way it came.
  if (body.phase === "follow") {
    if (body.via === "teleport") {
      startWarp(body, homeSpot(world), "ground", now);
      stepWarp(body, body.warp!, world);
      return;
    }
    body.phase = "air";
    body.via = "stay";
  }

  if (body.phase === "home") {
    const target = { x: body.wander.target, y: bandOf(world).floor };
    const dx = target.x - body.x;
    const dy = target.y - body.y;
    const distance = Math.hypot(dx, dy);
    const step = HOME_SPEED * size * dt;
    if (distance <= step) {
      body.x = target.x;
      body.y = target.y;
      body.phase = "ground";
      body.wander.until = now + 2000 + world.random() * 3000;
    } else {
      body.x += (dx / distance) * step;
      body.y += (dy / distance) * step;
      if (Math.abs(dx) > 1) body.facing = dx > 0 ? 1 : -1;
      return setPose(body, emote ?? "walk", now);
    }
  }

  const floor = floorAt(body.x, world);
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
  // Away from the zone (dropped, or the zone moved): go home after a short pause.
  if (!atHome(body, world) && !emote && now >= body.wander.until) {
    body.phase = "home";
    body.wander.walking = false;
    body.wander.target = homeTarget(body, world);
    return setPose(body, "walk", now);
  }
  if (emote) return setPose(body, emote, now);
  if (mood === "working") return setPose(body, "working", now);
  if (mood === "needs-you") return setPose(body, "needsyou", now);
  if (mood === "done") return setPose(body, "done", now);
  if (plan.reset) {
    body.wander.walking = false;
    return setPose(body, "happy", now);
  }
  if (body.act) {
    body.wander.walking = false;
    return setPose(body, "idle", now);
  }
  if (world.doze !== false && now - body.calmSince >= SLEEP_AFTER_MS) {
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
  if (world.wander !== false && now >= wander.until) {
    const band = bandOf(world);
    const reach = Math.min((band.right - band.left) * 0.6, world.width * 0.3, size * 4);
    let target: number | null = null;
    for (let attempt = 0; attempt < 4 && target === null; attempt++) {
      const candidate = clampHome(body.x + (world.random() * 2 - 1) * reach, world);
      const crowded = (world.others ?? []).some((x) => Math.abs(x - candidate) < size * PERSONAL_SPACE);
      if (Math.abs(candidate - body.x) > size * 0.3 && !crowded) target = candidate;
    }
    if (target !== null && world.random() < 0.65) {
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
  body.act = undefined;
  body.calmSince = now;
}

/** A calm pet standing at home, free to play an idle move. */
export function canAct(body: Body) {
  return body.phase === "ground" && body.pose === "idle" && !body.wander.walking && !body.emote && !body.act;
}

/** Plays an idle move for `duration` milliseconds. The pet stands still meanwhile. */
export function actBody(body: Body, id: string, duration: number, now: number) {
  body.act = { id, since: now, until: now + duration };
  body.wander.walking = false;
}

export function grabBody(body: Body, pointer: Point, now: number) {
  body.phase = "held";
  body.grab = { x: pointer.x - body.x, y: pointer.y - body.y };
  body.vy = 0;
  body.emote = undefined;
  body.act = undefined;
  body.warp = undefined;
  body.via = "stay";
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
export function releaseBody(body: Body, world: Pick<World, "width" | "height" | "now" | "zone">) {
  body.phase = body.y < floorAt(body.x, world) - 0.5 ? "air" : "landing";
  body.landUntil = world.now + LAND_MS;
  body.vy = 0;
  body.calmSince = world.now;
  body.wander.until = world.now + 1500;
}

/** Keeps a pet on screen when the window moves to a screen of another size. */
export function fitBody(body: Body, from: Pick<World, "width" | "height">, to: Pick<World, "width" | "height" | "size" | "zone">) {
  if (from.width > 0 && from.width !== to.width) body.x = (body.x / from.width) * to.width;
  body.x = clampX(body.x, to);
  body.wander.target = clampX(body.wander.target, to);
  if (body.warp) {
    // Finish a warp on the new screen without its portals.
    body.warp = undefined;
    body.phase = "air";
  }
  const grounded = body.phase === "ground" || body.phase === "landing" || body.y >= floorOf(from) - 0.5;
  body.y = grounded ? floorAt(body.x, to) : clamp(body.y, to.size * 0.6, floorOf(to));
}
