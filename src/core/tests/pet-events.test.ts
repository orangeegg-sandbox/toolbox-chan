import { describe, expect, it, vi } from "vitest";
import {
  getPetState, notifyPet, runPetAction, subscribePetEvents, subscribePetOpenTool,
} from "../pet/petEvents";
import { petEventError, type PetEvent } from "../pet/types";

describe("pet event rules", () => {
  it("accepts complete and minimal events", () => {
    expect(petEventError({
      source: "hook",
      agent: "claude",
      sessionId: "abc-123",
      status: "needs-you",
      emote: "happy",
      note: "CustomOfflineTool · Add pet",
      badge: { count: 3, action: { type: "open-tool", toolId: "example" } },
    })).toBeNull();
    expect(petEventError({ source: "script", emote: "laugh" })).toBeNull();
    expect(petEventError({ source: "script", badge: null })).toBeNull();
  });

  it("rejects what the native hub rejects", () => {
    for (const value of [
      null,
      [],
      { agent: "claude", status: "done" },
      { source: "", status: "done" },
      { source: "   ", status: "done" },
      { source: "x".repeat(65), status: "done" },
      { source: "hook" },
      { source: "hook", agent: "gemini", status: "done" },
      { source: "hook", status: "finished" },
      { source: "hook", emote: "dance" },
      { source: "hook", status: "done", colour: "red" },
      { source: "hook", note: "line\nbreak" },
      { source: "hook", note: "x".repeat(201) },
      { source: "hook", sessionId: "", status: "done" },
      { source: "hook", badge: { count: 10000 } },
      { source: "hook", badge: { count: -1 } },
      { source: "hook", badge: { count: 1.5 } },
      { source: "hook", badge: { count: 1, action: { type: "open-tool", toolId: "" } } },
      { source: "hook", badge: { count: 1, action: { type: "run-script", path: "x" } } },
      { source: "hook", badge: { count: 1, action: { type: "open-tool", toolId: "a", extra: 1 } } },
    ]) expect(petEventError(value), JSON.stringify(value)).not.toBeNull();
  });
});

describe("pet event hub in the browser preview", () => {
  it("delivers valid events to every subscriber until they unsubscribe", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribePetEvents(first);
    const stopSecond = subscribePetEvents(second);
    const event: PetEvent = { source: "delivery-test", agent: "codex", status: "working", sessionId: "s1" };
    await notifyPet(event);
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);
    stopFirst();
    await notifyPet({ ...event, status: "done" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
  });

  it("drops invalid events quietly", async () => {
    const listener = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stop = subscribePetEvents(listener);
    await expect(notifyPet({ source: "drop-test" })).resolves.toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    stop();
    warn.mockRestore();
  });

  it("keeps the latest badge per agent and source", async () => {
    const badges = async () => (await getPetState()).badges.filter((entry) => entry.source.startsWith("badge-test"));
    await notifyPet({ source: "badge-test-a", agent: "claude", badge: { count: 2 } });
    await notifyPet({ source: "badge-test-b", agent: "claude", badge: { count: 5 } });
    await notifyPet({ source: "badge-test-a", badge: { count: 7 } });
    await notifyPet({ source: "badge-test-a", agent: "claude", badge: { count: 4 } });
    await notifyPet({ source: "badge-test-a", agent: "claude", status: "done" });
    expect(await badges()).toEqual([
      { agent: "claude", source: "badge-test-a", badge: { count: 4 } },
      { agent: "claude", source: "badge-test-b", badge: { count: 5 } },
      { source: "badge-test-a", badge: { count: 7 } },
    ]);
    await notifyPet({ source: "badge-test-a", agent: "claude", badge: null });
    expect(await badges()).toEqual([
      { agent: "claude", source: "badge-test-b", badge: { count: 5 } },
      { source: "badge-test-a", badge: { count: 7 } },
    ]);
    await notifyPet({ source: "badge-test-b", agent: "claude", badge: null });
    await notifyPet({ source: "badge-test-a", badge: null });
  });

  it("hands badge actions to the toolbox without the pet knowing the tool", async () => {
    const open = vi.fn();
    const stop = subscribePetOpenTool(open);
    await runPetAction({ type: "open-tool", toolId: "example" });
    expect(open).toHaveBeenCalledWith("example");
    stop();
  });
});
