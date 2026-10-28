import type { GeneralChatAnalyze, UsageSample } from "./types";

/** Also checked before reading an uploaded file. Paths inside reports are metadata only. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_EVENTS = 50_000;
const MAX_FILES = 100_000;
const MAX_WARNINGS = 1_000;
const MAX_USAGE_SAMPLES = 50_000;
const MAX_SAFE_NUMBER = Number.MAX_SAFE_INTEGER;

function invalid(path: string, reason: string): never {
  throw new Error(`Invalid session report: ${path} ${reason}.`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, max = 8_192, nonempty = false): string {
  if (typeof value !== "string") return invalid(path, "must be a string");
  if (nonempty && value.length === 0) return invalid(path, "must not be empty");
  // JSON Schema measures Unicode code points, rather than UTF-16 code units.
  let length = 0;
  for (const _character of value) {
    if (++length > max) return invalid(path, `must be at most ${max.toLocaleString("en-US")} characters`);
  }
  return value;
}

function nullableString(value: unknown, path: string, max = 8_192): string | null {
  return value === null ? null : string(value, path, max);
}

function number(value: unknown, path: string, integer = true): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return invalid(path, "must be a finite, nonnegative number");
  }
  if (integer && (!Number.isSafeInteger(value) || value > MAX_SAFE_NUMBER)) {
    return invalid(path, "must be a safe integer");
  }
  return value;
}

function nullableNumber(value: unknown, path: string): number | null {
  return value === null ? null : number(value, path);
}

function choice<T extends string>(value: unknown, path: string, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    return invalid(path, `must be one of ${values.join(", ")}`);
  }
  return value as T;
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) return invalid(path, "must be an array");
  if (value.length > max) return invalid(path, `must contain at most ${max.toLocaleString("en-US")} entries`);
  return value;
}

function sampleTimestamp(value: unknown, path: string): string | null {
  if (value === null) return null;
  const timestamp = string(value, path, 128);
  const match = /^(?!0000)(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(timestamp);
  if (match && match[0] === timestamp) {
    const year = Number(match[1]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (Number(match[3]) <= days[Number(match[2]) - 1] && Number.isFinite(Date.parse(timestamp))) return timestamp;
  }
  return invalid(path, "must be null or a valid ISO 8601 date-time with Z or an explicit UTC offset");
}

function usageSamples(value: unknown): UsageSample[] {
  const ids = new Set<string>();
  return array(value, "usageSamples", MAX_USAGE_SAMPLES).map((item, index) => {
    const path = `usageSamples[${index}]`;
    const sample = object(item, path);
    const id = string(sample.id, `${path}.id`, 512, true);
    if (ids.has(id)) invalid(`${path}.id`, `duplicates usage sample ID ${JSON.stringify(id)}`);
    ids.add(id);
    const inputTokens = nullableNumber(sample.inputTokens, `${path}.inputTokens`);
    const cachedInputTokens = nullableNumber(sample.cachedInputTokens, `${path}.cachedInputTokens`);
    const cacheWriteInputTokens = nullableNumber(sample.cacheWriteInputTokens, `${path}.cacheWriteInputTokens`);
    if (inputTokens !== null) {
      if (cachedInputTokens !== null && cachedInputTokens > inputTokens) {
        invalid(`${path}.cachedInputTokens`, "must not exceed inputTokens");
      }
      if (cacheWriteInputTokens !== null && cacheWriteInputTokens > inputTokens) {
        invalid(`${path}.cacheWriteInputTokens`, "must not exceed inputTokens");
      }
      if (cachedInputTokens !== null && cacheWriteInputTokens !== null && cachedInputTokens > inputTokens - cacheWriteInputTokens) {
        invalid(path, "cache-read and cache-write tokens together must not exceed inputTokens");
      }
    }
    return {
      id,
      model: sample.model === null ? null : string(sample.model, `${path}.model`, 512, true),
      timestamp: sampleTimestamp(sample.timestamp, `${path}.timestamp`),
      inputTokens,
      outputTokens: nullableNumber(sample.outputTokens, `${path}.outputTokens`),
      cachedInputTokens,
      cacheWriteInputTokens,
      source: string(sample.source, `${path}.source`),
    };
  });
}

/** Validates and copies known fields; never opens any path or executes transcript content. */
export function parseReport(text: string): GeneralChatAnalyze {
  if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("Session report is too large. Import a JSON file no larger than 20 MiB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Session report is not valid JSON. Select a General Chat Analyze JSON report.");
  }
  const root = object(parsed, "report");
  if (root.schemaVersion !== 1) invalid("schemaVersion", "must be 1");
  const session = object(root.session, "session");
  const usage = object(root.usage, "usage");
  const cost = object(root.cost, "cost");
  if (root.usageSamplesComplete !== undefined && typeof root.usageSamplesComplete !== "boolean") {
    invalid("usageSamplesComplete", "must be a boolean when provided");
  }
  const ids = new Set<string>();
  let previousOrder = -1;
  const events = array(root.events, "events", MAX_EVENTS).map((item, index) => {
    const path = `events[${index}]`;
    const event = object(item, path);
    const id = string(event.id, `${path}.id`, 512, true);
    if (ids.has(id)) invalid(`${path}.id`, `duplicates event ID ${JSON.stringify(id)}`);
    ids.add(id);
    const order = number(event.order, `${path}.order`);
    if (order <= previousOrder) invalid(`${path}.order`, "must increase strictly in array order");
    previousOrder = order;
    return {
      id,
      order,
      timestamp: nullableString(event.timestamp, `${path}.timestamp`, 128),
      kind: choice(event.kind, `${path}.kind`, ["message", "tool", "mcp", "skill", "context", "compaction"] as const),
      name: string(event.name, `${path}.name`, 512),
      role: nullableString(event.role, `${path}.role`, 128),
      text: string(event.text, `${path}.text`, 200_000),
      callId: nullableString(event.callId, `${path}.callId`, 512),
      status: choice(event.status, `${path}.status`, ["observed", "success", "error", "unknown"] as const),
      source: string(event.source, `${path}.source`),
    };
  });
  const files = array(root.files, "files", MAX_FILES).map((item, index) => {
    const path = `files[${index}]`;
    const file = object(item, path);
    const eventId = string(file.eventId, `${path}.eventId`, 512, true);
    if (!ids.has(eventId)) invalid(`${path}.eventId`, "must reference an existing event ID");
    return {
      path: string(file.path, `${path}.path`, 8_192, true),
      operation: choice(file.operation, `${path}.operation`, ["read", "write", "list", "search"] as const),
      eventId,
      evidence: choice(file.evidence, `${path}.evidence`, ["explicit", "inferred"] as const),
    };
  });
  const amount = cost.amount === null ? null : number(cost.amount, "cost.amount", false);
  const basis = choice(cost.basis, "cost.basis", ["reported", "estimated", "unknown"] as const);
  if ((amount === null) !== (basis === "unknown")) {
    invalid("cost", "must use a null amount with unknown basis, or a known amount with reported/estimated basis");
  }
  return {
    schemaVersion: 1,
    session: {
      sourcePath: string(session.sourcePath, "session.sourcePath"),
      id: string(session.id, "session.id", 512, true),
      agent: choice(session.agent, "session.agent", ["codex", "claude", "dsh", "other"] as const),
      title: string(session.title, "session.title", 4_096),
      project: nullableString(session.project, "session.project"),
      modifiedAt: number(session.modifiedAt, "session.modifiedAt"),
      sizeBytes: number(session.sizeBytes, "session.sizeBytes"),
      tower: choice(session.tower, "session.tower", ["yes", "no", "unknown"] as const),
    },
    analyzedAt: string(root.analyzedAt, "analyzedAt", 128),
    events,
    files,
    usage: {
      inputTokens: nullableNumber(usage.inputTokens, "usage.inputTokens"),
      outputTokens: nullableNumber(usage.outputTokens, "usage.outputTokens"),
      cachedInputTokens: nullableNumber(usage.cachedInputTokens, "usage.cachedInputTokens"),
      reasoningTokens: nullableNumber(usage.reasoningTokens, "usage.reasoningTokens"),
      basis: string(usage.basis, "usage.basis"),
    },
    ...(root.usageSamples === undefined ? {} : { usageSamples: usageSamples(root.usageSamples) }),
    ...(root.usageSamplesComplete === undefined ? {} : { usageSamplesComplete: root.usageSamplesComplete as boolean }),
    cost: {
      amount,
      currency: choice(cost.currency, "cost.currency", ["USD"] as const),
      basis,
      detail: string(cost.detail, "cost.detail"),
    },
    warnings: array(root.warnings, "warnings", MAX_WARNINGS).map((warning, index) => string(warning, `warnings[${index}]`)),
  };
}
