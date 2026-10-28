import type { GeneralChatAnalyze, SessionEvent } from "./types";

export type EventKind = SessionEvent["kind"];
export const EVENT_KINDS: readonly EventKind[] = ["message", "tool", "mcp", "skill", "context", "compaction"];
export const EVENT_LABELS: Record<EventKind, string> = {
  message: "Messages", tool: "Tools", mcp: "MCP", skill: "Skills", context: "Context", compaction: "Compactions",
};

export interface ActivityFrequency {
  name: string;
  count: number;
  recorded: number;
  uncertain: number;
  eventIds: string[];
}
export interface EventFrequency extends ActivityFrequency { kind: EventKind }
export interface ServerFrequency extends ActivityFrequency { query: string }
export interface CommandFrequency extends ActivityFrequency { query: string; examples: string[] }
export interface ActivityBucket {
  firstOrder: number;
  lastOrder: number;
  count: number;
  counts: Record<EventKind, number>;
  errors: number;
  eventIds: string[];
}
export interface ActivityCategory {
  id: string;
  name: string;
  kind: EventKind;
  color: string;
  count: number;
  eventIds: string[];
  other?: boolean;
}
export interface SourceActivityBucket {
  firstOrder: number;
  lastOrder: number;
  /** All source records in this interval, including records outside the selected view. */
  total: number;
  selected: number;
  eventIds: string[];
  segments: { categoryId: string; eventIds: string[] }[];
}
export interface SourceActivityTimeline {
  categories: ActivityCategory[];
  buckets: SourceActivityBucket[];
  total: number;
  selected: number;
  byName: boolean;
}
export interface ActivitySummaryData {
  /** Raw records in the selected kinds, including duplicate/derived/result records. */
  eventCount: number;
  /** Canonical evidence IDs; excludes result rows and duplicate calls, but retains derived skill reads. */
  eventIds: string[];
  counts: Record<EventKind, number>;
  recordedCalls: number;
  uncertainCalls: number;
  skillReads: number;
  /** Outcomes for primary call events only, excluding derived skill reads. */
  statuses: Record<SessionEvent["status"], number>;
  frequencies: EventFrequency[];
  servers: ServerFrequency[];
  commands: CommandFrequency[];
  literalCommands: number;
  /** Full-source buckets, preserving positions even when kinds are selected. */
  timeline: ActivityBucket[];
  excludedResults: number;
  duplicateEvents: number;
}

const emptyCounts = (): Record<EventKind, number> => ({ message: 0, tool: 0, mcp: 0, skill: 0, context: 0, compaction: 0 });
const callKinds = new Set<EventKind>(["tool", "mcp", "skill"]);
const shellTools = new Set(["bash", "shell", "exec_command", "run_command", "terminal", "execute", "powershell", "pwsh"]);

/** This is the native parser's derived annotation, not a second tool invocation. */
export function isSkillRead(event: SessionEvent): boolean {
  return event.kind === "skill" && /^Read .*[\\/]?SKILL\.md$/i.test(event.name)
    && event.text.startsWith("A tool requested this SKILL.md file.");
}

function isResult(event: SessionEvent): boolean {
  return callKinds.has(event.kind) && (["tool", "function"].includes(event.role?.toLowerCase() ?? "")
    || event.name === "Unmatched tool result");
}

/** Only names with an explicit server/tool separator establish a server group. */
export function mcpServer(name: string): { name: string; query: string } | null {
  const normalized = name.replace(/^(?:functions\.|tools\.)/, "");
  const double = /^mcp__([^\s]+?)__(\S+)$/.exec(normalized);
  if (double) return { name: double[1], query: `mcp__${double[1]}__` };
  const dotted = /^mcp\.([^\s.]+)\.(\S+)$/.exec(normalized);
  return dotted ? { name: dotted[1], query: `mcp.${dotted[1]}.` } : null;
}

/** Accept a JSON-equivalent object literal only. No expressions, identifiers as values, or interpolation. */
function literalArguments(text: string): unknown {
  let index = 0;
  const fail = (): never => { throw new Error("Non-literal arguments"); };
  const whitespace = () => { while (/\s/.test(text[index] ?? "") && index < text.length) index += 1; };
  const string = (): string => {
    const quote = text[index++];
    let value = "";
    while (index < text.length) {
      const char = text[index++];
      if (char === quote) return value;
      if ((char === "\n" || char === "\r") && quote !== "`") fail();
      if (quote === "`" && char === "$" && text[index] === "{") fail();
      if (char !== "\\") { value += char; continue; }
      const escape = text[index++];
      const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0", "\\": "\\", "'": "'", '"': '"', "`": "`", "/": "/", $: "$" };
      if (escape === "u" || escape === "x") {
        const length = escape === "u" ? 4 : 2;
        const hex = text.slice(index, index + length);
        if (hex.length !== length || !/^[a-fA-F0-9]+$/.test(hex)) fail();
        value += String.fromCharCode(parseInt(hex, 16));
        index += length;
      } else if (escape in escapes) {
        if (escape === "0" && /\d/.test(text[index] ?? "")) fail();
        value += escapes[escape];
      } else fail();
    }
    return fail();
  };
  const read = (depth: number): unknown => {
    if (depth > 16) fail();
    whitespace();
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") return string();
    if (char === "{" || char === "[") {
      const object = char === "{";
      const close = object ? "}" : "]";
      const values: unknown[] = [];
      const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      index += 1;
      whitespace();
      while (text[index] !== close) {
        if (object) {
          const quoted = text[index] === '"' || text[index] === "'";
          const key = quoted ? string() : /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(index))?.[0];
          if (key === undefined) fail();
          if (!quoted) index += key!.length;
          whitespace();
          if (text[index++] !== ":") fail();
          fields[key!] = read(depth + 1);
        } else values.push(read(depth + 1));
        whitespace();
        if (text[index] === close) break;
        if (text[index++] !== ",") fail();
        whitespace();
      }
      index += 1;
      return object ? fields : values;
    }
    const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index))?.[0];
    if (primitive === undefined) return fail();
    index += primitive.length;
    return JSON.parse(primitive) as unknown;
  };
  const value = read(0);
  whitespace();
  if (index !== text.length) fail();
  return value;
}

/** Read only literal arguments before the parser's appended output. Never inspect result text. */
export function literalCommand(event: SessionEvent): string | null {
  if (event.kind !== "tool" || isResult(event)
    || !shellTools.has(event.name.toLowerCase().replace(/^(?:functions\.|tools\.)/, ""))) return null;
  const boundary = event.text.search(/\n\nResult \(parsed record \d+\):\n/);
  const argumentText = boundary < 0 ? event.text : event.text.slice(0, boundary);
  try {
    let value: unknown;
    try { value = JSON.parse(argumentText) as unknown; }
    catch { value = literalArguments(argumentText); }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const args = value as Record<string, unknown>;
    for (const key of ["cmd", "command", "script"]) {
      if (typeof args[key] === "string" && args[key].trim()) return args[key];
    }
  } catch { /* Raw scripts and truncated arguments remain unclassified. */ }
  return null;
}

/** The first literal executable only. Compound commands are not split or evaluated. */
export function commandName(command: string): string | null {
  const start = command.trimStart().replace(/^&\s+/, "");
  const quoted = /^'([^'\r\n]+)'(?=\s|$)/.exec(start) ?? /^"([^"\r\n]+)"(?=\s|$)/.exec(start);
  const bare = /^([A-Za-z_./\\][A-Za-z0-9_.:/\\-]*)(?=\s|$)/.exec(start);
  const token = quoted?.[1] ?? bare?.[1];
  if (!token || /[$`{}]/.test(token)) return null;
  const name = token.replace(/\\/g, "/").split("/").at(-1)?.replace(/\.(?:exe|cmd|bat)$/i, "");
  return name && name !== "." && name !== ".." ? name : null;
}

function increment(row: ActivityFrequency, event: SessionEvent): void {
  row.count += 1;
  row[event.status === "unknown" ? "uncertain" : "recorded"] += 1;
  row.eventIds.push(event.id);
}

function compareRows(a: ActivityFrequency, b: ActivityFrequency): number {
  return b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function bucketEvents(events: SessionEvent[]): ActivityBucket[] {
  if (!events.length) return [];
  const width = Math.ceil(events.length / 32);
  const buckets: ActivityBucket[] = [];
  for (let index = 0; index < events.length; index += width) {
    const slice = events.slice(index, index + width);
    const counts = emptyCounts();
    for (const event of slice) counts[event.kind] += 1;
    buckets.push({ firstOrder: slice[0].order, lastOrder: slice.at(-1)!.order, count: slice.length,
      counts, errors: slice.filter((event) => event.status === "error").length, eventIds: slice.map((event) => event.id) });
  }
  return buckets;
}

function canonicalEvents(ordered: SessionEvent[], selected: (event: SessionEvent) => boolean) {
  const seenIds = new Set<string>();
  const seenCalls = new Set<string>();
  const events: SessionEvent[] = [];
  let excludedResults = 0;
  let duplicateEvents = 0;
  for (const event of ordered) {
    if (isResult(event)) { if (selected(event)) excludedResults += 1; continue; }
    const callKey = event.callId && callKinds.has(event.kind)
      ? isSkillRead(event) ? JSON.stringify(["skill-read", event.callId, event.name]) : JSON.stringify(["call", event.callId])
      : null;
    if (seenIds.has(event.id) || (callKey && seenCalls.has(callKey))) {
      if (selected(event)) duplicateEvents += 1;
      continue;
    }
    seenIds.add(event.id);
    if (callKey) seenCalls.add(callKey);
    if (selected(event)) events.push(event);
  }
  return { events, excludedResults, duplicateEvents };
}

/** Full-source positions with named categories for focused views and kind categories for Overview/Flow. */
export function getActivityTimeline(report: Pick<GeneralChatAnalyze, "events">, kinds?: readonly EventKind[]): SourceActivityTimeline {
  const ordered = [...report.events].sort((a, b) => a.order - b.order);
  const byName = kinds !== undefined;
  const selected = byName ? canonicalEvents(ordered, (event) => kinds.includes(event.kind)).events : ordered;
  const groups = new Map<string, ActivityCategory>();
  for (const event of selected) {
    const id = byName ? JSON.stringify([event.kind, event.name]) : event.kind;
    let category = groups.get(id);
    if (!category) {
      category = { id, kind: event.kind, name: byName ? event.name || "Unnamed activity" : EVENT_LABELS[event.kind], color: event.kind, count: 0, eventIds: [] };
      groups.set(id, category);
    }
    category.count += 1;
    category.eventIds.push(event.id);
  }
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const categories = byName ? ranked.slice(0, 8) : EVENT_KINDS.flatMap((kind) => groups.get(kind) ?? []);
  if (byName) {
    // Palette positions depend on the complete view, never its search or hover state.
    const colorOrder = categories.map((category) => category.id).sort();
    for (const category of categories) category.color = `series-${colorOrder.indexOf(category.id)}`;
    if (ranked.length > 8) {
      const rest = ranked.slice(8);
      categories.push({ id: "other", name: `Other (${rest.length} names)`, kind: kinds.includes("context") ? "context" : kinds[0] ?? "tool",
        color: "other", count: rest.reduce((sum, category) => sum + category.count, 0), eventIds: rest.flatMap((category) => category.eventIds), other: true });
    }
  }
  const categoryByEvent = new Map(categories.flatMap((category) => category.eventIds.map((id) => [id, category.id] as const)));
  const width = Math.max(1, Math.ceil(ordered.length / 64));
  const buckets: SourceActivityBucket[] = [];
  for (let index = 0; index < ordered.length; index += width) {
    const slice = ordered.slice(index, index + width);
    const segments = new Map<string, string[]>();
    for (const event of slice) {
      const category = categoryByEvent.get(event.id);
      if (category !== undefined) {
        const ids = segments.get(category) ?? [];
        ids.push(event.id);
        segments.set(category, ids);
      }
    }
    buckets.push({ firstOrder: slice[0].order, lastOrder: slice.at(-1)!.order, total: slice.length,
      selected: [...segments.values()].reduce((sum, ids) => sum + ids.length, 0), eventIds: slice.map((event) => event.id),
      segments: [...segments].map(([categoryId, eventIds]) => ({ categoryId, eventIds })) });
  }
  return { categories, buckets, total: ordered.length, selected: selected.length, byName };
}

/** Shared chart and tab accounting. Dedupe globally so each filtered view agrees with the overview. */
export function getActivitySummary(report: Pick<GeneralChatAnalyze, "events">, kinds?: readonly EventKind[]): ActivitySummaryData {
  const selected = (event: SessionEvent) => kinds === undefined || kinds.includes(event.kind);
  const ordered = [...report.events].sort((a, b) => a.order - b.order);
  const raw = ordered.filter(selected);
  const { events, excludedResults, duplicateEvents } = canonicalEvents(ordered, selected);

  const counts = emptyCounts();
  const statuses = { success: 0, error: 0, observed: 0, unknown: 0 };
  const frequencies = new Map<string, EventFrequency>();
  const servers = new Map<string, ServerFrequency>();
  const commands = new Map<string, CommandFrequency>();
  let skillReads = 0;
  let literalCommands = 0;
  for (const event of events) {
    counts[event.kind] += 1;
    const frequencyKey = JSON.stringify([event.kind, event.name]);
    let frequency = frequencies.get(frequencyKey);
    if (!frequency) {
      frequency = { kind: event.kind, name: event.name, count: 0, recorded: 0, uncertain: 0, eventIds: [] };
      frequencies.set(frequencyKey, frequency);
    }
    increment(frequency, event);
    if (isSkillRead(event)) { skillReads += 1; continue; }
    if (!callKinds.has(event.kind)) continue;
    statuses[event.status] += 1;
    const server = event.kind === "mcp" ? mcpServer(event.name) : null;
    if (server) {
      let row = servers.get(server.name);
      if (!row) {
        row = { ...server, count: 0, recorded: 0, uncertain: 0, eventIds: [] };
        servers.set(server.name, row);
      }
      increment(row, event);
    }
    const command = literalCommand(event);
    if (command !== null) {
      literalCommands += 1;
      const name = commandName(command) ?? "Unclassified script";
      let row = commands.get(name);
      if (!row) {
        row = { name, query: event.name, count: 0, recorded: 0, uncertain: 0, eventIds: [], examples: [] };
        commands.set(name, row);
      }
      increment(row, event);
      if (row.examples.length < 3 && !row.examples.includes(command)) row.examples.push(command);
    }
  }
  return { eventCount: raw.length, eventIds: events.map((event) => event.id), counts,
    recordedCalls: statuses.success + statuses.error + statuses.observed, uncertainCalls: statuses.unknown, skillReads,
    statuses, frequencies: [...frequencies.values()].sort(compareRows), servers: [...servers.values()].sort(compareRows),
    commands: [...commands.values()].sort(compareRows), literalCommands, timeline: bucketEvents(ordered), excludedResults, duplicateEvents };
}
