import { describe, expect, it } from "vitest";
import { AGENT_IDS } from "../../../core/sdk";
import { POSES } from "../model/motion";
import { buildLibrary, frameIndex, resolveFrames } from "../sprites/animations";
import { frameLibrary } from "../sprites/library";
import { DEFAULT_SETTINGS, parseSettings } from "../settings";

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

describe("pet settings", () => {
  it("fills in defaults for missing or broken values", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ enabled: { codex: false, gemini: true }, size: "huge" }))).toEqual({
      enabled: { claude: true, codex: false, deepseek: true },
      size: "medium",
    });
    expect(parseSettings(JSON.stringify({ size: "large" })).size).toBe("large");
  });
});
