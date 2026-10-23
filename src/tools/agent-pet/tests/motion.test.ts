import { describe, expect, it } from "vitest";
import {
  createBody, dragBody, emoteBody, EMOTE_MS, fitBody, grabBody, LAND_MS, releaseBody, SLEEP_AFTER_MS, stepBody,
  type Body, type Point, type World,
} from "../model/motion";
import type { Mood } from "../model/petModel";

const SIZE = 128;

function world(now: number, cursor: Point | null = null, overrides: Partial<World> = {}): World {
  return { width: 1600, height: 900, size: SIZE, cursor, now, dt: 1 / 60, random: () => 0.9, ...overrides };
}

/** Runs the body for `seconds` at 60 steps per second and returns the time reached. */
function run(body: Body, mood: Mood, from: number, seconds: number, cursor: Point | null = null, overrides: Partial<World> = {}) {
  let now = from;
  for (let step = 0; step < seconds * 60; step++) {
    now += 1000 / 60;
    stepBody(body, mood, world(now, cursor, overrides));
  }
  return now;
}

describe("pet motion", () => {
  it("stands on the bottom edge and spreads pets out", () => {
    const bodies = [0, 1, 2].map((index) => createBody(index, world(0)));
    for (const body of bodies) expect(body.y).toBe(900);
    expect(new Set(bodies.map((body) => Math.round(body.x))).size).toBe(3);
  });

  it("wanders while idle and sleeps after a long quiet time", () => {
    const body = createBody(0, world(0));
    // random() = 0.9 never starts a walk (needs < 0.65), so make one with a lower value.
    let now = 0;
    const walking: string[] = [];
    for (let step = 0; step < 60 * 10; step++) {
      now += 1000 / 60;
      stepBody(body, "idle", world(now, null, { random: () => 0.1 }));
      walking.push(body.pose);
    }
    expect(walking).toContain("walk");
    expect(walking).toContain("idle");
    run(body, "idle", now, SLEEP_AFTER_MS / 1000);
    expect(body.pose).toBe("sleep");
    expect(body.y).toBe(900);
  });

  it("stops beside other pets rather than on top of them", () => {
    const others = [600, 1000];
    // A small seeded generator, so the walk is varied but repeatable.
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const body = createBody(0, world(0));
    body.x = 800;
    let now = 0;
    const stops: number[] = [];
    for (let step = 0; step < 60 * 120; step++) {
      now += 1000 / 60;
      const wasWalking = body.wander.walking;
      stepBody(body, "idle", world(now, null, { random, others }));
      if (wasWalking && !body.wander.walking) stops.push(body.x);
      body.calmSince = now;
    }
    expect(stops.length).toBeGreaterThan(3);
    for (const x of stops) for (const other of others) expect(Math.abs(x - other)).toBeGreaterThanOrEqual(SIZE * 0.75);
  });

  it("stays put for working and needs-you", () => {
    const body = createBody(0, world(0));
    const x = body.x;
    run(body, "working", 0, 5, null, { random: () => 0.1 });
    expect([body.pose, body.x]).toEqual(["working", x]);
    run(body, "needs-you", 5000, 2);
    expect(body.pose).toBe("needsyou");
  });

  it("follows the cursor when done but stops close enough to be clicked", () => {
    const body = createBody(0, world(0));
    const cursor = { x: 300, y: 300 };
    run(body, "done", 0, 4, cursor);
    const distance = Math.hypot(cursor.x - body.x, cursor.y - (body.y - SIZE * 0.45));
    expect(distance).toBeLessThan(SIZE * 1.1);
    expect(distance).toBeGreaterThan(SIZE * 0.5);
    expect(body.pose).toBe("done");
    expect(body.facing).toBe(-1);
    expect(body.y).toBeLessThan(900);
    // Moving the cursor onto the pet does not make it run away.
    const near = { x: body.x, y: body.y - SIZE * 0.45 };
    const before = { x: body.x, y: body.y };
    run(body, "done", 4000, 1, near);
    expect({ x: body.x, y: body.y }).toEqual(before);
  });

  it("falls back to the ground and lands when done is cleared", () => {
    const body = createBody(0, world(0));
    run(body, "done", 0, 3, { x: 400, y: 200 });
    expect(body.y).toBeLessThan(600);
    const poses = new Set<string>();
    let now = 3000;
    for (let step = 0; step < 120; step++) {
      now += 1000 / 60;
      stepBody(body, "idle", world(now));
      poses.add(body.pose);
    }
    expect(poses).toContain("held");
    expect(poses).toContain("land");
    expect(body.y).toBe(900);
  });

  it("dangles while dragged and bounces down when dropped", () => {
    const body = createBody(0, world(0));
    grabBody(body, { x: body.x, y: body.y - 60 }, 0);
    dragBody(body, { x: 500, y: 300 }, world(0));
    stepBody(body, "working", world(16));
    expect(body.pose).toBe("held");
    expect(body.x).toBe(500);
    expect(body.y).toBe(360);
    releaseBody(body, world(20));
    let bounced = false;
    let lowest = 0;
    let now = 20;
    for (let step = 0; step < 120; step++) {
      now += 1000 / 60;
      stepBody(body, "working", world(now));
      if (body.vy < 0) bounced = true;
      lowest = Math.max(lowest, body.y);
    }
    expect(bounced).toBe(true);
    expect(lowest).toBe(900);
    run(body, "working", now, LAND_MS / 1000 + 0.1);
    expect(body.pose).toBe("working");
  });

  it("plays an emote, then goes back to what it was doing", () => {
    const body = createBody(0, world(0));
    emoteBody(body, "sleepy", 0);
    stepBody(body, "idle", world(16));
    expect(body.pose).toBe("sleep");
    run(body, "idle", 16, EMOTE_MS / 1000 + 0.1);
    expect(body.pose).toBe("idle");
  });

  it("moves with the window to a smaller screen", () => {
    const body = createBody(2, world(0));
    fitBody(body, { width: 1600, height: 900 }, { width: 800, height: 600, size: SIZE });
    expect(body.x).toBeLessThanOrEqual(800 - SIZE * 0.4);
    expect(body.y).toBe(600);
  });
});
