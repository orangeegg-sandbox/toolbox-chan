import { describe, expect, it } from "vitest";
import type { GeneralChatAnalyze, SessionEvent, SessionPreview } from "../types";
import { contextSignals, estimateCost, filterSessions, projectName } from "../utils";

function session(id: string, overrides: Partial<SessionPreview> = {}): SessionPreview {
  return {
    id, agent: "codex", title: `Review ${id}`, project: "D:\\Work\\app",
    sourcePath: `/sessions/${id}.jsonl`, modifiedAt: 1, sizeBytes: 100, tower: "unknown", ...overrides,
  };
}

const usage: GeneralChatAnalyze["usage"] = {
  inputTokens: 2_000_000, cachedInputTokens: 500_000, outputTokens: 250_000,
  reasoningTokens: null, basis: "Synthetic provider counts; input includes cached input.",
};

function event(id: string, kind: SessionEvent["kind"], text: string): SessionEvent {
  return { id, order: Number(id), kind, text, name: `Event ${id}`, timestamp: null,
    role: null, callId: null, status: "observed", source: `fixture:${id}` };
}

describe("session catalog filtering", () => {
  const sessions = [
    session("one", { title: "Review login", tower: "yes" }),
    session("two", { agent: "claude", tower: "no" }),
    session("three", { agent: "dsh", project: "/srv/api", tower: "yes" }),
    session("four", { agent: "other", project: null, sourcePath: "/exports/vendor-report.json" }),
  ];

  it("combines project, agent, Tower origin, and case-insensitive search without changing order", () => {
    expect(filterSessions(sessions, "  LOGIN  ", "D:\\Work\\app", "codex", "yes")).toEqual([sessions[0]]);
    expect(filterSessions(sessions, "", "D:\\Work\\app", "", "")).toEqual(sessions.slice(0, 2));
    expect(filterSessions(sessions, "", "", "", "yes")).toEqual([sessions[0], sessions[2]]);
    expect(filterSessions(sessions, "", "", "", "no")).toEqual([sessions[1]]);
    expect(filterSessions(sessions, "", "", "", "unknown")).toEqual([sessions[3]]);
    expect(filterSessions(sessions, "login", "/srv/api", "", "")).toEqual([]);
    expect(filterSessions(sessions, "", "", "claude", "yes")).toEqual([]);
  });

  it("searches IDs, source paths and project paths, including chats without a project", () => {
    expect(filterSessions(sessions, "THREE", "", "", "")).toEqual([sessions[2]]);
    expect(filterSessions(sessions, "vendor-report", "", "", "")).toEqual([sessions[3]]);
    expect(filterSessions(sessions, "/SRV/API", "", "", "")).toEqual([sessions[2]]);
    expect(filterSessions(sessions, "   ", "", "", "")).toEqual(sessions);
    expect(projectName("D:\\Work\\app\\")).toBe("app");
    expect(projectName("/srv/api/")).toBe("api");
    expect(projectName(null)).toBe("No project recorded");
  });
});

describe("API-equivalent cost estimates", () => {
  it("prices cached input once and keeps unknown reasoning separate from billable output", () => {
    expect(estimateCost(usage, ["2", "0.5", "8"])).toBeCloseTo(5.25, 8);
    expect(estimateCost({ ...usage, reasoningTokens: 100_000 }, ["2", "0.5", "8"])).toBeCloseTo(5.25, 8);
    expect(estimateCost({ ...usage, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, ["0", "0", "0"])).toBe(0);
  });

  it("does not turn missing token counts or missing prices into zero cost", () => {
    for (const field of ["inputTokens", "cachedInputTokens", "outputTokens"] as const) {
      expect(estimateCost({ ...usage, [field]: null }, ["2", "0.5", "8"])).toBeNull();
    }
    for (const rates of [["", "0.5", "8"], ["2", " ", "8"], ["2", "0.5"], ["2", "0.5", "8", "1"]]) {
      expect(estimateCost(usage, rates)).toBeNull();
    }
  });

  it("rejects impossible cached counts, invalid rates, and non-finite results", () => {
    expect(estimateCost({ ...usage, cachedInputTokens: usage.inputTokens! + 1 }, ["2", "0.5", "8"])).toBeNull();
    for (const rate of ["-1", "NaN", "Infinity", "not a price"]) {
      expect(estimateCost(usage, [rate, "0.5", "8"])).toBeNull();
    }
    expect(estimateCost(usage, ["1e308", "0.5", "8"])).toBeNull();
    expect(estimateCost({ ...usage, outputTokens: Number.NaN }, ["2", "0.5", "8"])).toBeNull();
    expect(estimateCost({ ...usage, inputTokens: Infinity }, ["2", "0.5", "8"])).toBeNull();
  });
});

describe("context evidence summaries", () => {
  it("counts repeated reads separately from searches and writes, preserves source order, and ranks text by characters", () => {
    const events = [
      event("1", "context", "Instructions"), event("2", "tool", "Read a file"),
      event("3", "skill", "Loaded skill instructions"), event("4", "mcp", "A long result".repeat(20)),
      event("5", "compaction", "Earlier context summarized"), event("6", "message", ""),
    ];
    const report: GeneralChatAnalyze = {
      schemaVersion: 1, session: session("one"), analyzedAt: "2026-10-27T00:00:00Z", events,
      files: [
        { path: "src/main.ts", operation: "read", eventId: "2", evidence: "explicit" },
        { path: "src/main.ts", operation: "read", eventId: "2", evidence: "inferred" },
        { path: "src/main.ts", operation: "write", eventId: "2", evidence: "explicit" },
        { path: "src", operation: "search", eventId: "2", evidence: "explicit" },
        { path: "src", operation: "search", eventId: "2", evidence: "explicit" },
        { path: "README.md", operation: "read", eventId: "2", evidence: "explicit" },
      ],
      usage, cost: { amount: null, currency: "USD", basis: "unknown", detail: "No cost recorded." }, warnings: [],
    };
    const before = structuredClone(report);
    const result = contextSignals(report);
    expect(result.repeatedReads).toEqual([["src/main.ts", 2]]);
    expect(result.contextEvents.map((entry) => entry.id)).toEqual(["1", "3", "5"]);
    expect(result.largestEvents[0].id).toBe("4");
    expect(result.largestEvents.map((entry) => entry.id)).not.toContain("6");
    expect(report).toEqual(before);
    expect(contextSignals({ ...report, events: [], files: [] })).toEqual({ repeatedReads: [], largestEvents: [], contextEvents: [] });
  });
});
