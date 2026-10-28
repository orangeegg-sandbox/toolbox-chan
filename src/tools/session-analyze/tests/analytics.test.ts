import { describe, expect, it } from "vitest";
import { commandName, getActivitySummary, getActivityTimeline, isSkillRead, literalCommand, mcpServer } from "../analytics";
import type { SessionEvent } from "../types";

function event(id: string, overrides: Partial<SessionEvent> = {}): SessionEvent {
  return { id, order: Number(id.replace(/\D/g, "")) || 1, timestamp: null, kind: "tool", name: "read",
    role: "assistant", text: "{}", callId: null, status: "observed", source: `record ${id}`, ...overrides };
}
function skillRead(id: string, path: string, callId: string | null): SessionEvent {
  return event(id, { kind: "skill", name: `Read ${path}`, callId,
    text: "A tool requested this SKILL.md file. Catalog mentions alone are not counted as loaded skills." });
}
function shell(id: string, command: string, overrides: Partial<SessionEvent> = {}): SessionEvent {
  return event(id, { name: "exec_command", text: JSON.stringify({ cmd: command }), ...overrides });
}

describe("session activity accounting", () => {
  it("counts primary calls once while retaining distinct derived skill evidence", () => {
    const events = [
      event("e1", { callId: "c1", status: "success" }),
      skillRead("e2", "/skills/review/SKILL.md", "c1"),
      skillRead("e3", "/skills/test/SKILL.md", "c1"),
      event("e4", { callId: "c1", status: "success" }),
      skillRead("e5", "/skills/review/SKILL.md", "c1"),
      event("e6", { kind: "skill", name: "Skill: review", callId: "c2", status: "success" }),
      event("e7", { role: "tool", callId: "c1", status: "success" }),
      event("e8", { name: "Unmatched tool result", role: "tool", status: "error" }),
    ];
    const summary = getActivitySummary({ events });
    expect(summary.eventCount).toBe(8);
    expect(summary.eventIds).toEqual(["e1", "e2", "e3", "e6"]);
    expect(summary.counts.tool).toBe(1);
    expect(summary.counts.skill).toBe(3);
    expect(summary.recordedCalls).toBe(2);
    expect(summary.skillReads).toBe(2);
    expect(summary.statuses).toEqual({ success: 2, observed: 0, error: 0, unknown: 0 });
    expect(summary.excludedResults).toBe(2);
    expect(summary.duplicateEvents).toBe(2);
    expect(summary.timeline.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(8);
    const skills = getActivitySummary({ events }, ["skill"]);
    expect(skills.eventCount).toBe(4);
    expect(skills.eventIds).toEqual(["e2", "e3", "e6"]);
    expect(skills.recordedCalls).toBe(1);
    expect(skills.skillReads).toBe(2);
  });

  it("keeps uncertain candidates apart from recorded calls and does not infer execution", () => {
    const summary = getActivitySummary({ events: [
      event("e1", { name: "read", status: "unknown" }),
      event("e2", { name: "read", status: "error" }),
      event("e3", { name: "read", status: "observed" }),
      event("e4", { name: "mcp__files__read", kind: "mcp", status: "unknown" }),
      { ...skillRead("e5", "/skills/review/SKILL.md", null), status: "unknown" },
    ] });
    expect(summary.recordedCalls).toBe(2);
    expect(summary.uncertainCalls).toBe(2);
    expect(summary.statuses).toEqual({ success: 0, error: 1, observed: 1, unknown: 2 });
    expect(summary.frequencies.find((row) => row.name === "read")).toMatchObject({ count: 3, recorded: 2, uncertain: 1 });
    expect(summary.servers[0]).toMatchObject({ name: "files", count: 1, recorded: 0, uncertain: 1 });
    expect(summary.skillReads).toBe(1);
  });

  it("deduplicates global call IDs consistently across views without merging anonymous calls", () => {
    const first = event("e1", { callId: "shared" });
    const events = [first, first, event("e2", { kind: "mcp", name: "mcp__fs__read", callId: "shared" }),
      event("e3"), event("e4")];
    expect(getActivitySummary({ events }).eventIds).toEqual(["e1", "e3", "e4"]);
    expect(getActivitySummary({ events }, ["mcp"]).eventIds).toEqual([]);
    expect(getActivitySummary({ events }, ["tool"]).counts.tool).toBe(3);
  });

  it("does not treat a catalog reference or a normally named skill call as a derived read", () => {
    expect(isSkillRead(skillRead("e1", "C:\\skills\\review\\SKILL.md", "c1"))).toBe(true);
    expect(isSkillRead(event("e2", { kind: "context", text: "Read /skills/review/SKILL.md" }))).toBe(false);
    expect(isSkillRead(event("e3", { kind: "skill", name: "Read /skills/review/SKILL.md", text: "{}" }))).toBe(false);
  });

  it("ranks frequencies deterministically and keeps different event kinds separate", () => {
    const summary = getActivitySummary({ events: [event("e1", { name: "zeta" }), event("e2", { name: "alpha" }),
      event("e3", { name: "alpha" }), event("e4", { name: "beta" }), event("e5", { name: "alpha", kind: "context" })] });
    expect(summary.frequencies.map((row) => [row.kind, row.name, row.count])).toEqual([
      ["tool", "alpha", 2], ["context", "alpha", 1], ["tool", "beta", 1], ["tool", "zeta", 1],
    ]);
  });

  it("orders raw timeline evidence by source order rather than timestamp, without mutating input", () => {
    const events = [event("e9", { timestamp: "2026-01-01T00:00:00Z" }),
      event("e2", { kind: "context", timestamp: "2026-12-31T00:00:00Z" }),
      event("e4", { status: "error" })];
    const summary = getActivitySummary({ events });
    expect(summary.timeline.map((bucket) => bucket.eventIds)).toEqual([["e2"], ["e4"], ["e9"]]);
    expect(summary.timeline[1].errors).toBe(1);
    expect(events.map((item) => item.id)).toEqual(["e9", "e2", "e4"]);
    expect(summary.eventIds).toEqual(["e2", "e4", "e9"]);
  });

  it("bounds timeline buckets while preserving every record and category count", () => {
    const events = Array.from({ length: 301 }, (_, index) => event(`e${index + 1}`, {
      kind: index % 2 ? "message" : "tool", status: index === 300 ? "error" : "observed",
    }));
    const summary = getActivitySummary({ events });
    expect(summary.timeline.length).toBeLessThanOrEqual(32);
    expect(summary.timeline.flatMap((bucket) => bucket.eventIds)).toEqual(events.map((item) => item.id));
    expect(summary.timeline.reduce((sum, bucket) => sum + bucket.counts.message, 0)).toBe(150);
    expect(summary.timeline.reduce((sum, bucket) => sum + bucket.counts.tool, 0)).toBe(151);
    expect(summary.timeline.at(-1)).toMatchObject({ firstOrder: 301, lastOrder: 301, errors: 1 });
  });

  it("returns explicit zero values for empty or absent kinds and retains all Context evidence", () => {
    const empty = getActivitySummary({ events: [] });
    expect(empty).toMatchObject({ eventCount: 0, eventIds: [], recordedCalls: 0, uncertainCalls: 0, frequencies: [], commands: [], timeline: [] });
    expect(Object.values(empty.counts).every((count) => count === 0)).toBe(true);
    const events = [event("e1", { kind: "context" }), event("e2", { kind: "compaction" }), skillRead("e3", "/x/SKILL.md", null)];
    expect(getActivitySummary({ events }, ["context", "skill", "compaction"]).eventCount).toBe(3);
    expect(getActivitySummary({ events }, []).eventCount).toBe(0);
    expect(getActivitySummary({ events }, ["mcp"]).eventIds).toEqual([]);
  });
});

describe("literal command evidence", () => {
  it("extracts only known shell-tool arguments before native result text", () => {
    const call = shell("e1", "rg --files");
    call.text += '\n\nResult (parsed record 23):\n{"cmd":"rm -rf /"}';
    expect(literalCommand(call)).toBe("rg --files");
    expect(literalCommand(event("e2", { name: "Bash", text: '{"command":"git status"}' }))).toBe("git status");
    expect(literalCommand(event("e3", { name: "functions.exec_command", text: '{"script":"Get-Content README.md"}' }))).toBe("Get-Content README.md");
    expect(literalCommand(event("e4", { name: "read", text: '{"cmd":"fake command"}' }))).toBeNull();
    expect(literalCommand(event("e5", { name: "exec_command", role: "tool", text: '{"cmd":"fake result"}' }))).toBeNull();
  });

  it("leaves raw orchestration, malformed JSON, nested values, arrays and output-only commands unclassified", () => {
    for (const text of ['tools.exec_command({cmd:"rg"})', '{"cmd":', '{"nested":{"cmd":"rg"}}', '[{"cmd":"rg"}]',
      'null', '"rg --files"', '{"cmd":42}', '{"cmd":" "}', '{}\n\nResult (parsed record 4):\n{"cmd":"rg"}']) {
      expect(literalCommand(event("e1", { name: "exec_command", text }))).toBeNull();
    }
    expect(literalCommand(event("e1", { name: "functions.exec", text: '{"cmd":"rg"}' }))).toBeNull();
  });

  it("reads complete literal JS objects from orchestration without executing expressions", () => {
    const command = "Get-Content 'C:\\project\\README.md'";
    expect(literalCommand(event("e1", { name: "exec_command", status: "unknown",
      text: `{cmd:${JSON.stringify(command)}, workdir:'C:\\\\project', max_output_tokens:500,}` }))).toBe(command);
    expect(literalCommand(event("e2", { name: "exec_command", status: "unknown", text: "{cmd:`rg --files\ngit status`, nested:{items:[true,null,1,],},}" }))).toBe("rg --files\ngit status");
    expect(literalCommand(event("e3", { name: "Bash", text: "{'command':'rg \\u0066oo', other:'\\x41'}" }))).toBe("rg foo");
    for (const text of ["{cmd:'rg' + ' --files'}", "{cmd:`rg ${target}`}", "{cmd:command}", "{cmd:'rg', ...rest}",
      "{cmd:'rg', cwd:process.cwd()}", "{nested:{cmd:'rg'}}", "{get cmd(){return 'rg'}}", "{['cmd']:'rg'}", "{cmd:'rg', other:'\\q'}"]) {
      expect(literalCommand(event("e4", { name: "exec_command", text })), text).toBeNull();
    }
    expect(literalCommand(event("e5", { name: "exec_command", text: "{cmd:'rg', command:'git', cmd:'npm test'}" }))).toBe("npm test");
  });

  it("preserves literal text and groups only the leading executable, without splitting compound scripts", () => {
    expect(commandName("rg --files; curl example.com")).toBe("rg");
    expect(commandName("git status && git diff")).toBe("git");
    expect(commandName("\n  Get-Content -LiteralPath 'file.txt'")).toBe("Get-Content");
    expect(commandName("& 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' -File test.ps1")).toBe("pwsh");
    expect(commandName('"/usr/local/bin/python3" task.py')).toBe("python3");
    expect(commandName("C:\\tools\\rg.exe --files")).toBe("rg");
    expect(commandName("echo $(date)")).toBe("echo");
    for (const command of ["$tool --files", "$(Get-Command rg) --files", '"${HOME}/rg" --files', "PATH=/bin rg --files", "# comment\nrg --files", ". ./script.sh", "&& rg"]) {
      expect(commandName(command)).toBeNull();
    }
  });

  it("aggregates shell calls once, keeps exact drill-down IDs and bounds command examples", () => {
    const events = [shell("e1", "rg --files"), shell("e2", "rg foo"), shell("e3", "rg bar", { status: "unknown" }),
      shell("e4", "rg baz"), shell("e5", "rg --files"), shell("e6", "git status && git diff"), shell("e7", "$tool x")];
    const summary = getActivitySummary({ events });
    expect(summary.literalCommands).toBe(7);
    expect(summary.commands.map((row) => [row.name, row.count])).toEqual([["rg", 5], ["Unclassified script", 1], ["git", 1]]);
    expect(summary.commands[0]).toMatchObject({ recorded: 4, uncertain: 1, eventIds: ["e1", "e2", "e3", "e4", "e5"],
      examples: ["rg --files", "rg foo", "rg bar"] });
    expect(summary.commands.find((row) => row.name === "git")?.examples).toEqual(["git status && git diff"]);
    expect(getActivitySummary({ events }, ["skill"]).commands).toEqual([]);
  });
});

describe("MCP server attribution", () => {
  it("groups explicit namespaces and preserves drill evidence across compatible name spellings", () => {
    expect(mcpServer("functions.mcp__github__search")).toEqual({ name: "github", query: "mcp__github__" });
    expect(mcpServer("tools.mcp.docs.search")).toEqual({ name: "docs", query: "mcp.docs." });
    expect(mcpServer("mcp__codex_apps__sites__create")).toEqual({ name: "codex_apps", query: "mcp__codex_apps__" });
    const summary = getActivitySummary({ events: [
      event("e1", { kind: "mcp", name: "mcp__docs__search" }), event("e2", { kind: "mcp", name: "mcp.docs.read" }),
      event("e3", { kind: "mcp", name: "mcp_ambiguous_name" }),
    ] });
    expect(summary.counts.mcp).toBe(3);
    expect(summary.servers).toHaveLength(1);
    expect(summary.servers[0]).toMatchObject({ name: "docs", count: 2, eventIds: ["e1", "e2"] });
  });

  it("does not invent servers for ambiguous or incomplete names", () => {
    for (const name of ["mcp_server_tool", "mcp__server", "mcp__server__", "mcp.server", "search", "mcp__bad server__read"]) {
      expect(mcpServer(name)).toBeNull();
    }
  });
});

describe("categorical timelines in full source order", () => {
  it("preserves full-session positions, sparse buckets and gaps in filtered views", () => {
    const events = Array.from({ length: 100 }, (_, index) => event(`e${index + 1}`, {
      kind: index === 1 || index === 98 ? "tool" : "message", name: index === 1 ? "Read" : index === 98 ? "Write" : "assistant",
    }));
    const all = getActivityTimeline({ events });
    const tools = getActivityTimeline({ events }, ["tool"]);
    expect(tools.total).toBe(100);
    expect(tools.selected).toBe(2);
    expect(tools.buckets.map((bucket) => [bucket.firstOrder, bucket.lastOrder, bucket.total]))
      .toEqual(all.buckets.map((bucket) => [bucket.firstOrder, bucket.lastOrder, bucket.total]));
    expect(tools.buckets.filter((bucket) => bucket.selected > 0)).toHaveLength(2);
    expect(tools.buckets[0]).toMatchObject({ firstOrder: 1, lastOrder: 2, total: 2, selected: 1 });
    expect(tools.buckets.at(-1)).toMatchObject({ firstOrder: 99, lastOrder: 100, total: 2, selected: 1 });
    expect(tools.buckets.slice(1, -1).every((bucket) => bucket.selected === 0 && bucket.segments.length === 0)).toBe(true);
    expect(getActivitySummary({ events }, ["tool"]).timeline.flatMap((bucket) => bucket.eventIds)).toHaveLength(100);
  });

  it("uses distinct exact-name categories with consistent color assignments and an explicit Other group", () => {
    const events = Array.from({ length: 12 }, (_, index) => event(`e${index + 1}`, { name: `tool-${String(index).padStart(2, "0")}` }));
    events.push(event("e13", { name: "tool-11" }));
    const timeline = getActivityTimeline({ events }, ["tool"]);
    const named = timeline.categories.filter((category) => !category.other);
    const other = timeline.categories.find((category) => category.other)!;
    expect(named).toHaveLength(8);
    expect(new Set(named.map((category) => category.color)).size).toBe(8);
    expect(named[0]).toMatchObject({ name: "tool-11", count: 2 });
    expect(other).toMatchObject({ name: "Other (4 names)", color: "other", count: 4 });
    expect(timeline.categories.flatMap((category) => category.eventIds).sort()).toEqual(events.map((item) => item.id).sort());
    expect(getActivityTimeline({ events: [...events].reverse() }, ["tool"]).categories).toEqual(timeline.categories);
    const represented = timeline.buckets.flatMap((bucket) => bucket.segments.flatMap((segment) => segment.eventIds));
    expect(represented).toEqual(events.map((item) => item.id));
  });

  it("retains exact category membership for substring collisions and excludes derived result records", () => {
    const events = [event("e1", { kind: "mcp", name: "mcp__docs__read", callId: "one" }),
      event("e2", { kind: "mcp", name: "mcp__docs_extra__read" }),
      event("e3", { kind: "mcp", name: "mcp__docs__read", callId: "one" }),
      event("e4", { kind: "mcp", name: "mcp__docs__read", callId: "one", role: "tool" }),
      event("e5", { kind: "mcp", name: "mcp__docs__read" })];
    const timeline = getActivityTimeline({ events }, ["mcp"]);
    expect(timeline.selected).toBe(3);
    expect(timeline.categories.map((category) => [category.name, category.eventIds])).toEqual([
      ["mcp__docs__read", ["e1", "e5"]], ["mcp__docs_extra__read", ["e2"]],
    ]);
    expect(timeline.categories[0].color).not.toBe(timeline.categories[1].color);
    expect(timeline.buckets[2].segments).toEqual([]);
    expect(timeline.buckets[3].segments).toEqual([]);
  });

  it("keeps overview kind colors and gives Context distinct source and skill names", () => {
    const events = [event("e1", { kind: "context", name: "Developer instructions" }),
      event("e2", { kind: "context", name: "Workspace metadata" }),
      skillRead("e3", "/skills/review/SKILL.md", null), event("e4", { kind: "compaction", name: "Context compaction" })];
    const all = getActivityTimeline({ events });
    expect(all.byName).toBe(false);
    expect(all.categories.map((category) => category.color)).toEqual(["skill", "context", "compaction"]);
    const context = getActivityTimeline({ events }, ["context", "skill", "compaction"]);
    expect(context.byName).toBe(true);
    expect(context.categories).toHaveLength(4);
    expect(new Set(context.categories.map((category) => category.color)).size).toBe(4);
    expect(getActivityTimeline({ events }, []).buckets.every((bucket) => bucket.selected === 0)).toBe(true);
    expect(getActivityTimeline({ events: [] }, ["tool"])).toMatchObject({ total: 0, selected: 0, categories: [], buckets: [] });
  });
});
