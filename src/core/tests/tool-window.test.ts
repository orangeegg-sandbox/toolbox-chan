import { describe, expect, it } from "vitest";
import { parseToolWindowHash, toolWindowHash } from "../windows/toolWindow";

describe("tool window addresses", () => {
  it("round-trips a tool and window id", () => {
    const hash = toolWindowHash({ toolId: "example-tool", windowId: "overlay" });
    expect(hash).toBe("#tool-window/example-tool/overlay");
    expect(parseToolWindowHash(hash)).toEqual({ toolId: "example-tool", windowId: "overlay" });
  });

  it("ignores every other page", () => {
    for (const hash of [
      "", "#", "#command-palette", "#tool-window/", "#tool-window/example", "#tool-window/example/",
      "#tool-window/Example/overlay", "#tool-window/example/overlay/extra", "#tool-window/../overlay",
      "#tool-window/example/over lay",
    ]) expect(parseToolWindowHash(hash), hash).toBeNull();
  });

  it("refuses ids that could not be routed", () => {
    expect(() => toolWindowHash({ toolId: "Example", windowId: "overlay" })).toThrow();
    expect(() => toolWindowHash({ toolId: "example", windowId: "a/b" })).toThrow();
  });
});
