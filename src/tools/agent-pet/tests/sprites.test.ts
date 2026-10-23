import { describe, expect, it } from "vitest";
import { AGENT_IDS } from "../../../core/sdk";
import { POSES } from "../model/motion";
import { buildLibrary, frameIndex, resolveFrames } from "../sprites/animations";
import { frameLibrary } from "../sprites/library";
import { buildMoves, builtInMoves, mergeMoves, moveDuration, moveFrame, parseMoveInfo } from "../sprites/moves";
import { DEFAULT_SETTINGS, parseSettings, parseZone } from "../settings";

describe("sprite frames", () => {
  const library = buildLibrary({
    "../assets/claude/walk-2.png": "/walk-2.png",
    "../assets/claude/walk-10.png": "/walk-10.png",
    "../assets/claude/walk-1.png": "/walk-1.png",
    "../assets/claude/idle-1.png": "/idle-1.png",
    "../assets/claude/happy-1.png": "/happy-1.png",
    "../assets/claude/dance-1.png": "/ignored.png",
    "../assets/gemini/idle-1.png": "/ignored.png",
    "../assets/codex/readme.png": "/ignored.png",
  });

  it("orders frames by number and ignores unknown names", () => {
    expect(library.claude.walk).toEqual(["/walk-1.png", "/walk-2.png", "/walk-10.png"]);
    expect(Object.keys(library.claude).sort()).toEqual(["happy", "idle", "walk"]);
    expect(library.codex).toEqual({});
  });

  it("falls back so a partial set of art never breaks a pet", () => {
    expect(resolveFrames(library, "claude", "walk")).toEqual({ pose: "walk", frames: library.claude.walk });
    expect(resolveFrames(library, "claude", "laugh")).toEqual({ pose: "happy", frames: ["/happy-1.png"] });
    expect(resolveFrames(library, "claude", "done")).toEqual({ pose: "happy", frames: ["/happy-1.png"] });
    expect(resolveFrames(library, "claude", "working")).toEqual({ pose: "idle", frames: ["/idle-1.png"] });
    expect(resolveFrames(library, "codex", "idle")).toBeNull();
  });

  it("ships every animation for every pet, without gaps in the numbering", () => {
    for (const agent of AGENT_IDS) {
      for (const pose of POSES) {
        const frames = frameLibrary[agent][pose] ?? [];
        expect(frames.length, `${agent} ${pose}`).toBeGreaterThan(0);
        expect(frames.map((url) => Number(/-(\d+)\.png/.exec(url)?.[1])), `${agent} ${pose}`)
          .toEqual(frames.map((_, index) => index + 1));
      }
    }
  });

  it("loops most poses and holds the last landing frame", () => {
    expect([0, 125, 250, 375, 500].map((elapsed) => frameIndex("walk", 4, elapsed))).toEqual([0, 1, 2, 3, 0]);
    expect([0, 125, 250, 5000].map((elapsed) => frameIndex("land", 2, elapsed))).toEqual([0, 1, 1, 1]);
    expect(frameIndex("idle", 1, 9999)).toBe(0);
  });
});

describe("idle moves", () => {
  it("ships one demo move per pet, in the import format", () => {
    expect(builtInMoves.map((move) => [move.id, move.frames.length])).toEqual([
      ["claude/stretch", 6], ["codex/tea", 6], ["deepseek/dance", 6],
    ]);
    expect(AGENT_IDS.every((agent) => builtInMoves.some((move) => move.agent === agent))).toBe(true);
    const dance = builtInMoves.find((move) => move.id === "deepseek/dance")!;
    expect(moveDuration(dance)).toBe(2000);
    expect(moveFrame(dance, 0)).toBe(dance.frames[0]);
    expect(moveFrame(dance, 1000)).toBe(dance.frames[0]);
    expect(moveFrame(dance, 170)).toBe(dance.frames[1]);
  });

  it("reads only folders that follow the format, frames in order", () => {
    const moves = buildMoves({
      "../a/move.json": { format: 1, agent: "codex", name: "wave", fps: 4, loops: 2 },
      "../b/move.json": { format: 1, agent: "codex", name: "Bad Name", fps: 4, loops: 2 },
      "../c/move.json": { format: 2, agent: "codex", name: "spin", fps: 4, loops: 1 },
      "../d/move.json": { format: 1, agent: "gemini", name: "hop", fps: 4, loops: 1 },
      "../e/move.json": { format: 1, agent: "claude", name: "nap", fps: 30, loops: 1 },
    }, {
      "../a/wave-2.png": "/w2", "../a/wave-1.png": "/w1", "../a/wave-4.png": "/w4",
      "../b/Bad Name-1.png": "/b1", "../c/spin-1.png": "/s1", "../d/hop-1.png": "/h1", "../e/nap-1.png": "/n1",
    });
    // A gap ends the frames: wave-3 is missing, so wave-4 is not played.
    expect(moves).toEqual([{ agent: "codex", name: "wave", label: "wave", fps: 4, loops: 2, id: "codex/wave", frames: ["/w1", "/w2"], builtIn: true }]);
    expect(parseMoveInfo({ format: 1, agent: "claude", name: "x", fps: 1, loops: 1, label: "y".repeat(41) })).toBeNull();
    const imported = { ...moves[0], frames: ["/new"], builtIn: false };
    expect(mergeMoves(moves, [imported])).toEqual([imported]);
  });
});

describe("pet settings", () => {
  it("fills in defaults for missing or broken values", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
    // Settings saved before the new options existed keep their choices and get the new defaults.
    expect(parseSettings(JSON.stringify({ enabled: { codex: false, gemini: true }, size: "huge" }))).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: { claude: true, codex: false, deepseek: true },
      size: "medium",
    });
    expect(parseSettings(JSON.stringify({ size: "large" })).size).toBe("large");
  });

  it("keeps valid choices and replaces broken ones", () => {
    const settings = parseSettings(JSON.stringify({
      zoneOn: false,
      zone: { x: 0, y: 0.8, width: 0.3, height: 0.2 },
      followScreen: "yes",
      behaviour: { done: "teleport", needsYou: "fly", notice: "walk" },
      idleTalkMinutes: 7,
      idleLines: ["  Hi   there ", "", 3, "x".repeat(80)],
      disabledMoves: ["claude/stretch", 4],
    }));
    expect(settings.zoneOn).toBe(false);
    expect(settings.zone).toEqual({ x: 0, y: 0.8, width: 0.3, height: 0.2 });
    expect(settings.followScreen).toBe(true);
    expect(settings.behaviour).toEqual({ done: "teleport", needsYou: "stay", notice: "walk" });
    expect(settings.idleTalkMinutes).toBe(DEFAULT_SETTINGS.idleTalkMinutes);
    expect(settings.idleLines).toEqual(["Hi there", "x".repeat(60)]);
    expect(settings.disabledMoves).toEqual(["claude/stretch"]);
  });

  it("refuses zones that leave the screen or are too small to see", () => {
    expect(parseZone({ x: 0.9, y: 0, width: 0.3, height: 0.5 })).toBeNull();
    expect(parseZone({ x: 0.1, y: 0.1, width: 0.001, height: 0.5 })).toBeNull();
    expect(parseZone({ x: -0.1, y: 0, width: 0.3, height: 0.5 })).toBeNull();
    expect(parseZone({ x: "0", y: 0, width: 0.3, height: 0.5 })).toBeNull();
    expect(parseZone({ x: 0.7, y: 0.5, width: 0.3, height: 0.5 })).toEqual({ x: 0.7, y: 0.5, width: 0.3, height: 0.5 });
  });
});
