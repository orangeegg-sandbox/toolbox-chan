import { describe, expect, it } from "vitest";
import { getPetState, petEventError, subscribePetEvents, type PetEvent } from "../../../core/sdk";
import { createPreviewBackend, PREVIEW_KEY } from "../services/backend";
import type { TodoItem } from "../types";
import { badgeEvents, filterItems, openCounts, projectName, projectOptions, shortTime } from "../utils";

function item(id: string, overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id,
    agent: "claude",
    project: "D:\\Work\\demo-app",
    chatTitle: "Demo",
    text: `Item ${id}`,
    kind: "step",
    foundAt: Number(id),
    sessionId: "s1",
    ...overrides,
  };
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("list helpers", () => {
  it("names projects by their folder and filters by agent and project", () => {
    expect(projectName("D:\\Work\\demo-app\\")).toBe("demo-app");
    expect(projectName("/home/me/site")).toBe("site");
    expect(projectName("")).toBe("");
    const items = [
      item("1"),
      item("2", { agent: "codex", project: "/srv/api" }),
      item("3", { agent: "codex", project: "D:\\Work\\demo-app" }),
      item("4", { project: "" }),
    ];
    expect(projectOptions(items)).toEqual([
      { path: "/srv/api", name: "api" },
      { path: "D:\\Work\\demo-app", name: "demo-app" },
    ]);
    expect(filterItems(items, "codex", "").map((entry) => entry.id)).toEqual(["2", "3"]);
    expect(filterItems(items, "all", "D:\\Work\\demo-app").map((entry) => entry.id)).toEqual(["1", "3"]);
    expect(filterItems(items, "deepseek", "")).toEqual([]);
    expect(openCounts(items)).toEqual({ claude: 2, codex: 2, deepseek: 0 });
  });

  it("sends every agent's badge first, then only changes, as valid pet events", () => {
    const first = badgeEvents(null, { claude: 2, codex: 0, deepseek: 0 });
    expect(first).toEqual([
      { source: "agent-todo", agent: "claude", badge: { count: 2, action: { type: "open-tool", toolId: "agent-todo" } } },
      { source: "agent-todo", agent: "codex", badge: null },
      { source: "agent-todo", agent: "deepseek", badge: null },
    ]);
    for (const event of first) expect(petEventError(event)).toBeNull();
    expect(badgeEvents({ claude: 2, codex: 0, deepseek: 0 }, { claude: 2, codex: 0, deepseek: 0 })).toEqual([]);
    expect(badgeEvents({ claude: 2, codex: 0, deepseek: 0 }, { claude: 2, codex: 1, deepseek: 0 }).map((event) => event.agent)).toEqual(["codex"]);
    expect(badgeEvents(null, { claude: 12345, codex: 0, deepseek: 0 })[0].badge?.count).toBe(9999);
  });

  it("shows only the time for today", () => {
    const now = new Date(2026, 9, 22, 15, 0).getTime();
    expect(shortTime(new Date(2026, 9, 22, 9, 5).getTime(), now)).not.toMatch(/Oct|22/);
    expect(shortTime(new Date(2026, 9, 20, 9, 5).getTime(), now)).toMatch(/20/);
  });
});

describe("browser preview list", () => {
  it("moves items to History, restores them, clears History, and keeps the list in storage", async () => {
    const storage = new MemoryStorage();
    storage.setItem(PREVIEW_KEY, JSON.stringify({ items: [item("1"), item("2"), { broken: true }], history: [], enabledAt: 5, paused: false }));
    const backend = createPreviewBackend(storage);
    let changes = 0;
    backend.subscribe(() => changes++);
    expect((await backend.state()).items.map((entry) => entry.id)).toEqual(["1", "2"]);

    const removed = await backend.remove(["1"]);
    expect(removed.items.map((entry) => entry.id)).toEqual(["2"]);
    expect(removed.history[0]).toMatchObject({ id: "1" });
    expect(removed.history[0].removedAt).toBeGreaterThan(0);

    const reloaded = createPreviewBackend(storage);
    expect((await reloaded.state()).history.map((entry) => entry.id)).toEqual(["1"]);

    const restored = await backend.restore(["1"]);
    expect(restored.items.map((entry) => entry.id)).toEqual(["1", "2"]);
    expect(restored.items[0].removedAt).toBeUndefined();

    await backend.remove(["2"]);
    expect((await backend.clearHistory()).history).toEqual([]);
    expect(changes).toBe(4);
    await expect(backend.addRule("claude")).rejects.toThrow(/desktop app/);
  });

  it("reports open-item counts to the pets once at start and when they change", async () => {
    const storage = new MemoryStorage();
    storage.setItem(PREVIEW_KEY, JSON.stringify({ items: [item("1"), item("2", { agent: "deepseek" })], history: [] }));
    const events: PetEvent[] = [];
    const stop = subscribePetEvents((event) => {
      if (event.source === "agent-todo") events.push(event);
    });
    const backend = createPreviewBackend(storage);
    await backend.state();
    expect(events.map((event) => [event.agent, event.badge?.count ?? null])).toEqual([["claude", 1], ["codex", null], ["deepseek", 1]]);
    events.length = 0;
    await backend.state();
    expect(events).toEqual([]);
    await backend.remove(["2"]);
    expect(events).toEqual([{ source: "agent-todo", agent: "deepseek", badge: null }]);
    const badges = (await getPetState()).badges.filter((entry) => entry.source === "agent-todo");
    expect(badges.map((entry) => [entry.agent, entry.badge.count])).toEqual([["claude", 1]]);
    stop();
  });
});
