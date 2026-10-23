import { describe, expect, it } from "vitest";
import type { PetEvent } from "../../../core/sdk";
import {
  applyPetEvent, clickPet, createBook, expireSessions, FORGET_MS, petView, STALE_WORKING_MS, type PetBook,
} from "../model/petModel";

const hook = (event: Omit<PetEvent, "source">): PetEvent => ({ source: "hook", ...event });

function play(events: PetEvent[], start = 0): PetBook {
  return events.reduce((book, event, index) => applyPetEvent(book, event, start + index), createBook(start));
}

describe("pet states from events", () => {
  it("starts idle and works while a chat works", () => {
    const book = play([hook({ agent: "claude", sessionId: "a", status: "working", note: "Repo · Fix it" })]);
    expect(petView(createBook(0), "claude")).toMatchObject({ mood: "idle", count: 0, done: false, needsYou: false });
    expect(petView(book, "claude")).toMatchObject({ mood: "working", count: 1, note: "Repo · Fix it" });
    expect(petView(book, "codex").mood).toBe("idle");
  });

  it("counts parallel chats by session", () => {
    const book = play([
      hook({ agent: "codex", sessionId: "a", status: "working" }),
      hook({ agent: "codex", sessionId: "b", status: "working" }),
      hook({ agent: "codex", sessionId: "c", status: "working" }),
      hook({ agent: "codex", sessionId: "a", status: "working" }),
    ]);
    expect(petView(book, "codex").count).toBe(3);
    expect(petView(applyPetEvent(book, hook({ agent: "codex", sessionId: "b", status: "done" }), 9), "codex").count).toBe(2);
  });

  it("keeps done until the pet is clicked, and done wins over working", () => {
    let book = play([
      hook({ agent: "claude", sessionId: "a", status: "working" }),
      hook({ agent: "claude", sessionId: "b", status: "working" }),
      hook({ agent: "claude", sessionId: "a", status: "done" }),
    ]);
    expect(petView(book, "claude")).toMatchObject({ mood: "done", done: true, count: 1 });
    // A new prompt in the finished chat does not hide the notice either.
    book = applyPetEvent(book, hook({ agent: "claude", sessionId: "a", status: "working" }), 10);
    book = applyPetEvent(book, hook({ agent: "claude", sessionId: "a", status: "idle" }), 11);
    expect(petView(book, "claude").mood).toBe("done");
    const clicked = clickPet(book, "claude", 12);
    expect(clicked.cleared).toBe(true);
    expect(petView(clicked.book, "claude")).toMatchObject({ mood: "working", done: false });
    expect(clickPet(clicked.book, "claude", 13).cleared).toBe(false);
  });

  it("clears needs-you on that session's next status or a click", () => {
    let book = play([
      hook({ agent: "codex", sessionId: "a", status: "working" }),
      hook({ agent: "codex", sessionId: "a", status: "needs-you" }),
      hook({ agent: "codex", sessionId: "b", status: "needs-you" }),
    ]);
    expect(petView(book, "codex")).toMatchObject({ mood: "needs-you", needsYou: true, count: 2 });
    book = applyPetEvent(book, hook({ agent: "codex", sessionId: "a", status: "working" }), 5);
    expect(petView(book, "codex").needsYou).toBe(true);
    // A badge or note from another source is not the session's next status.
    book = applyPetEvent(book, { source: "todo", agent: "codex", badge: { count: 1 } }, 6);
    expect(petView(book, "codex").needsYou).toBe(true);
    book = applyPetEvent(book, hook({ agent: "codex", sessionId: "b", status: "working" }), 7);
    expect(petView(book, "codex")).toMatchObject({ mood: "working", needsYou: false });

    book = applyPetEvent(book, hook({ agent: "codex", sessionId: "b", status: "needs-you" }), 8);
    expect(petView(clickPet(book, "codex", 9).book, "codex").needsYou).toBe(false);
  });

  it("shows a question bubble even while done", () => {
    const book = play([
      hook({ agent: "deepseek", sessionId: "a", status: "done" }),
      hook({ agent: "deepseek", sessionId: "b", status: "needs-you" }),
    ]);
    expect(petView(book, "deepseek")).toMatchObject({ mood: "done", done: true, needsYou: true });
  });

  it("addresses every pet when an event names no agent", () => {
    const book = play([{ source: "script", status: "working", note: "Everyone" }, { source: "script", emote: "laugh" }]);
    for (const agent of ["claude", "codex", "deepseek"] as const) {
      expect(petView(book, agent)).toMatchObject({ mood: "working", note: "Everyone" });
      expect(book.agents[agent].emote).toEqual({ name: "laugh", serial: 1 });
    }
  });

  it("numbers emotes so each request plays once", () => {
    const book = play([hook({ agent: "claude", emote: "happy" }), hook({ agent: "claude", emote: "happy" })]);
    expect(book.agents.claude.emote).toEqual({ name: "happy", serial: 2 });
  });
});

describe("pet badges", () => {
  it("keeps one badge per agent and source and hides empty ones", () => {
    const action = { type: "open-tool", toolId: "example" } as const;
    let book = createBook(0, [{ agent: "claude", source: "todo", badge: { count: 2, action } }]);
    book = applyPetEvent(book, { source: "todo", agent: "claude", badge: { count: 5, action } }, 1);
    book = applyPetEvent(book, { source: "mail", agent: "claude", badge: { count: 1 } }, 2);
    book = applyPetEvent(book, { source: "everyone", badge: { count: 4 } }, 3);
    book = applyPetEvent(book, { source: "zero", agent: "claude", badge: { count: 0 } }, 4);
    expect(petView(book, "claude").badges).toEqual([
      { agent: "claude", source: "todo", badge: { count: 5, action } },
      { agent: "claude", source: "mail", badge: { count: 1 } },
      { source: "everyone", badge: { count: 4 } },
    ]);
    expect(petView(book, "codex").badges).toEqual([{ source: "everyone", badge: { count: 4 } }]);
    book = applyPetEvent(book, { source: "todo", agent: "claude", badge: null }, 5);
    expect(petView(book, "claude").badges.map((entry) => entry.source)).toEqual(["mail", "everyone"]);
  });
});

describe("bubbles and calls", () => {
  const link = { type: "open-link", url: "codex://threads/a" } as const;

  it("says what a message says and answers with the strongest call", () => {
    let book = play([hook({ agent: "codex", sessionId: "a", status: "done", message: { text: "Fix it is ready", action: link } })]);
    expect(petView(book, "codex")).toMatchObject({ call: "done", bubble: { text: "Fix it is ready", action: link, kind: "done", sessionId: "a" } });
    expect(petView(book, "claude")).toMatchObject({ call: null, reset: false });
    expect(petView(book, "claude").bubble).toBeUndefined();
    // A newer message replaces the bubble, but done still wins the call.
    book = applyPetEvent(book, { source: "todo", agent: "codex", message: { text: "Run tests is marked as TODO" } }, 5);
    expect(petView(book, "codex")).toMatchObject({ call: "done", bubble: { kind: "notice", serial: 2 } });
    const cleared = clickPet(book, "codex", 6);
    expect(cleared.cleared).toBe(true);
    expect(petView(cleared.book, "codex")).toMatchObject({ call: null, done: false });
    expect(petView(cleared.book, "codex").bubble).toBeUndefined();
  });

  it("makes any other message a notice call until it is dismissed", () => {
    const book = play([{ source: "todo", agent: "claude", message: { text: "Rotate the key is marked as TODO" } }]);
    expect(petView(book, "claude")).toMatchObject({ mood: "idle", call: "notice", bubble: { kind: "notice" } });
    expect(clickPet(book, "claude", 1).cleared).toBe(true);
  });

  it("drops a question's bubble when that chat moves on", () => {
    let book = play([
      hook({ agent: "claude", sessionId: "a", status: "needs-you", message: { text: "Fix it needs you" } }),
    ]);
    expect(petView(book, "claude")).toMatchObject({ call: "needsYou", bubble: { kind: "needs-you" } });
    book = applyPetEvent(book, hook({ agent: "claude", sessionId: "b", status: "working" }), 1);
    expect(petView(book, "claude").bubble?.kind).toBe("needs-you");
    book = applyPetEvent(book, hook({ agent: "claude", sessionId: "a", status: "working" }), 2);
    expect(petView(book, "claude").bubble).toBeUndefined();
    expect(petView(book, "claude").call).toBeNull();
  });

  it("keeps a limit reset until the pet is clicked", () => {
    const book = play([{ source: "limits", agent: "codex", notice: "limit-reset", message: { text: "Codex's weekly limit is reset" } }]);
    expect(petView(book, "codex")).toMatchObject({ reset: true, call: null, bubble: { kind: "reset" } });
    const clicked = clickPet(book, "codex", 1);
    expect(clicked.cleared).toBe(true);
    expect(petView(clicked.book, "codex").reset).toBe(false);
  });
});

describe("pet session cleanup", () => {
  it("ends silent working chats and forgets quiet ones, but keeps notices", () => {
    const book = play([
      hook({ agent: "claude", sessionId: "silent", status: "working" }),
      hook({ agent: "claude", sessionId: "finished", status: "done" }),
      hook({ agent: "claude", sessionId: "quiet", status: "idle" }),
    ]);
    expect(expireSessions(book, 1000)).toBe(book);
    const later = expireSessions(book, STALE_WORKING_MS + FORGET_MS);
    expect(Object.keys(later.agents.claude.sessions).sort()).toEqual(["finished", "silent"]);
    expect(petView(later, "claude")).toMatchObject({ mood: "done", count: 0 });
    const latest = expireSessions(later, STALE_WORKING_MS * 3);
    expect(Object.keys(latest.agents.claude.sessions)).toEqual(["finished"]);
  });
});
