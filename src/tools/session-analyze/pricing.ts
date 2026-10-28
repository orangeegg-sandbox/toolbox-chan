import type { GeneralChatAnalyze } from "./types";

/** All prices are USD per million tokens. Input buckets are disjoint. */
export interface TokenPrices { input: number; cachedInput: number; cacheWriteInput: number | null; output: number }
export interface PricingSource { url: string; checkedAt: string; notes?: string }
interface PriceWindow { weekdays: number[]; start: number; end: number; prices: TokenPrices }
interface PriceCalendar {
  timeZone: string; coverageFrom: string; coverageUntil: string;
  overrides: { date: string; prices: TokenPrices }[]; source: PricingSource;
}
interface PriceSchedule { timeZone: string; windows: PriceWindow[]; calendar?: PriceCalendar }
export interface PricingRule {
  file: string; id: string; model: string; aliases: string[];
  effectiveFrom: string; effectiveUntil: string | null; from: number; until: number;
  source: PricingSource; prices: TokenPrices; schedule?: PriceSchedule;
}
export interface PricingCatalog { rules: PricingRule[]; errors: string[] }
export interface PricingUsageSample {
  id: string; model: string | null; timestamp: string | null;
  inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null; source: string;
}
export interface PricedUsageSample {
  sampleId: string; model: string; file: string; ruleId: string; amount: number;
  prices: TokenPrices; rateLabel: string; source: PricingSource; calendarSource?: PricingSource;
}
export interface SessionCostEstimate {
  amount: number | null; subtotal: number; pricedSamples: number; totalSamples: number;
  issues: string[]; detail: string; appliedRules: string[]; sampleCosts: PricedUsageSample[];
}
type PricingReport = Pick<GeneralChatAnalyze, "usage"> & { usageSamples?: readonly PricingUsageSample[]; usageSamplesComplete?: boolean };

const MAX_FILES = 32;
const MAX_RULES = 2_000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

function invalid(path: string, reason: string): never { throw new Error(`${path}: ${reason}`); }
function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid(path, "must be an object");
  for (const key of Object.keys(value)) if (!keys.includes(key)) invalid(`${path}.${key}`, "unknown field");
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, max = 512): string {
  if (typeof value !== "string" || !value.length || value.length > max || value.trim() !== value) {
    return invalid(path, `must be a nonempty string of at most ${max} characters, without surrounding whitespace`);
  }
  return value;
}
function array(value: unknown, path: string, max: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length > max || value.length < minimum) return invalid(path, `must contain ${minimum}–${max} items`);
  return value;
}
function date(value: unknown, path: string): string {
  const result = text(value, path, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T00:00:00Z`))
    || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) return invalid(path, "must be a real YYYY-MM-DD date");
  return result;
}
function instant(value: unknown, path: string, utcOnly = false): number {
  if (typeof value !== "string") return invalid(path, "requires a timestamp with an explicit time zone");
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || (utcOnly && match[5] !== "Z")) return invalid(path, utcOnly ? "must be an ISO timestamp ending in Z" : "requires an ISO timestamp with an explicit time zone");
  date(match[1], path);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59
    || (match[5] !== "Z" && (Number(match[5].slice(1, 3)) > 23 || Number(match[5].slice(4)) > 59))) return invalid(path, "contains an invalid time");
  const result = Date.parse(value);
  if (!Number.isFinite(result)) return invalid(path, "contains an invalid timestamp");
  return result;
}
function timeZone(value: unknown, path: string): string {
  const zone = text(value, path, 128);
  // Reject numeric offsets: schedules use a named IANA zone, including UTC.
  if (/^[+-]/.test(zone)) return invalid(path, "must name an IANA time zone");
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(0); }
  catch { return invalid(path, "must name a supported IANA time zone"); }
  return zone;
}
function prices(value: unknown, path: string): TokenPrices {
  const row = object(value, path, ["input", "cachedInput", "cacheWriteInput", "output"]);
  const rate = (key: string) => {
    const value = row[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return invalid(`${path}.${key}`, "must be a finite, nonnegative USD price per million tokens");
    return value;
  };
  return { input: rate("input"), cachedInput: rate("cachedInput"), output: rate("output"),
    cacheWriteInput: row.cacheWriteInput === undefined || row.cacheWriteInput === null ? null : rate("cacheWriteInput") };
}
function source(value: unknown, path: string): PricingSource {
  const row = object(value, path, ["url", "checkedAt", "notes"]);
  const url = text(row.url, `${path}.url`, 2048);
  try { if (!["https:", "http:"].includes(new URL(url).protocol)) invalid(path, "source URL must use HTTP(S)"); }
  catch { return invalid(path, "source URL must use HTTP(S)"); }
  return { url, checkedAt: date(row.checkedAt, `${path}.checkedAt`),
    ...(row.notes === undefined ? {} : { notes: text(row.notes, `${path}.notes`, 8192) }) };
}
function minute(value: unknown, path: string, end = false): number {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return invalid(path, "must use HH:MM");
  if (end && value === "24:00") return 1440;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) return invalid(path, "contains an invalid clock time");
  return hours * 60 + minutes;
}
function schedule(value: unknown, path: string): PriceSchedule {
  const row = object(value, path, ["timeZone", "windows", "calendar"]);
  const windows = array(row.windows, `${path}.windows`, 100).map((entry, index) => {
    const p = `${path}.windows[${index}]`;
    const item = object(entry, p, ["weekdays", "start", "end", "prices"]);
    const weekdays = array(item.weekdays, `${p}.weekdays`, 7, 1).map((day) => {
      if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 7) return invalid(p, "weekdays must be integers from 1 (Monday) through 7 (Sunday)");
      return day;
    });
    if (new Set(weekdays).size !== weekdays.length) invalid(p, "duplicate weekday");
    const start = minute(item.start, `${p}.start`), end = minute(item.end, `${p}.end`, true);
    if (start >= end) invalid(p, "start must precede end; split overnight windows into separate days");
    return { weekdays, start, end, prices: prices(item.prices, `${p}.prices`) };
  });
  for (let i = 0; i < windows.length; i++) for (let j = i + 1; j < windows.length; j++) {
    const a = windows[i], b = windows[j];
    if (a.weekdays.some((day) => b.weekdays.includes(day)) && a.start < b.end && b.start < a.end) invalid(path, `windows ${i} and ${j} overlap`);
  }
  let calendar: PriceCalendar | undefined;
  if (row.calendar !== undefined) {
    const p = `${path}.calendar`;
    const item = object(row.calendar, p, ["timeZone", "coverageFrom", "coverageUntil", "overrides", "source"]);
    const coverageFrom = date(item.coverageFrom, `${p}.coverageFrom`), coverageUntil = date(item.coverageUntil, `${p}.coverageUntil`);
    if (coverageFrom >= coverageUntil) invalid(p, "coverageFrom must precede exclusive coverageUntil");
    const dates = new Set<string>();
    const overrides = array(item.overrides, `${p}.overrides`, 3660).map((entry, index) => {
      const op = `${p}.overrides[${index}]`;
      const override = object(entry, op, ["date", "prices"]);
      const day = date(override.date, `${op}.date`);
      if (dates.has(day)) invalid(op, "duplicate date override");
      if (day < coverageFrom || day >= coverageUntil) invalid(op, "date falls outside calendar coverage");
      dates.add(day);
      return { date: day, prices: prices(override.prices, `${op}.prices`) };
    });
    calendar = { timeZone: timeZone(item.timeZone, `${p}.timeZone`), coverageFrom, coverageUntil, overrides, source: source(item.source, `${p}.source`) };
  }
  return { timeZone: timeZone(row.timeZone, `${path}.timeZone`), windows, ...(calendar ? { calendar } : {}) };
}

/** Validates every file; any error disables the entire catalog, never just one model. */
export function parsePricingDocuments(files: { name: string; json: string }[]): { catalog: PricingCatalog; errors: string[] } {
  const errors: string[] = [], rules: PricingRule[] = [];
  const names = new Set<string>();
  let totalBytes = 0;
  if (files.length > MAX_FILES) errors.push(`Pricing supports at most ${MAX_FILES} JSON files.`);
  for (const file of files.slice(0, MAX_FILES)) {
    try {
      text(file.name, "File name", 512);
      if (names.has(file.name)) invalid(file.name, "duplicate file name");
      names.add(file.name);
      if (typeof file.json !== "string" || file.json.length > MAX_FILE_BYTES) invalid(file.name, "file exceeds 1 MiB");
      const bytes = new TextEncoder().encode(file.json).length;
      if (bytes > MAX_FILE_BYTES) invalid(file.name, "file exceeds 1 MiB");
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES) invalid(file.name, "combined pricing documents exceed 8 MiB");
      let parsed: unknown;
      try { parsed = JSON.parse(file.json); } catch { return invalid(file.name, "invalid JSON"); }
      const doc = object(parsed, file.name, ["schemaVersion", "currency", "rules"]);
      if (doc.schemaVersion !== 1) invalid(file.name, "schemaVersion must be 1");
      if (doc.currency !== "USD") invalid(file.name, "currency must be USD");
      const ids = new Set<string>();
      for (const [index, entry] of array(doc.rules, `${file.name}.rules`, MAX_RULES, 1).entries()) {
        const p = `${file.name}.rules[${index}]`;
        const row = object(entry, p, ["id", "model", "aliases", "effectiveFrom", "effectiveUntil", "source", "prices", "schedule"]);
        const id = text(row.id, `${p}.id`), model = text(row.model, `${p}.model`);
        if (ids.has(id)) invalid(p, "duplicate rule ID");
        ids.add(id);
        const aliases = row.aliases === undefined ? [] : array(row.aliases, `${p}.aliases`, 100).map((alias) => text(alias, `${p}.aliases`));
        if (new Set([model, ...aliases]).size !== aliases.length + 1) invalid(p, "duplicate model or alias");
        const effectiveFrom = text(row.effectiveFrom, `${p}.effectiveFrom`);
        const effectiveUntil = row.effectiveUntil === null ? null : text(row.effectiveUntil, `${p}.effectiveUntil`);
        const from = instant(effectiveFrom, `${p}.effectiveFrom`, true), until = effectiveUntil === null ? Infinity : instant(effectiveUntil, `${p}.effectiveUntil`, true);
        if (from >= until) invalid(p, "effectiveFrom must precede exclusive effectiveUntil");
        rules.push({ file: file.name, id, model, aliases, effectiveFrom, effectiveUntil, from, until,
          source: source(row.source, `${p}.source`), prices: prices(row.prices, `${p}.prices`),
          ...(row.schedule === undefined ? {} : { schedule: schedule(row.schedule, `${p}.schedule`) }) });
        if (rules.length > MAX_RULES) invalid(p, `catalog exceeds ${MAX_RULES} total rules`);
      }
    } catch (cause) { errors.push(cause instanceof Error ? cause.message : String(cause)); }
  }
  const byModel = new Map<string, PricingRule[]>();
  for (const rule of rules) for (const model of [rule.model, ...rule.aliases]) byModel.set(model, [...(byModel.get(model) ?? []), rule]);
  for (const [model, rows] of byModel) {
    rows.sort((a, b) => a.from - b.from);
    for (let i = 1; i < rows.length; i++) if (rows[i].from < rows[i - 1].until) {
      errors.push(`Ambiguous pricing for exact model ${JSON.stringify(model)}: ${rows[i - 1].file}#${rows[i - 1].id} overlaps ${rows[i].file}#${rows[i].id}.`);
      break;
    }
  }
  return { catalog: { rules: errors.length ? [] : rules, errors: [...errors] }, errors };
}

function localClock(timestamp: number, zone: string, formatters: Map<string, Intl.DateTimeFormat>) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { date, weekday: day === 0 ? 7 : day, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
function rateAt(rule: PricingRule, timestamp: number, formatters: Map<string, Intl.DateTimeFormat>): { prices: TokenPrices; label: string } {
  if (!rule.schedule) return { prices: rule.prices, label: "base" };
  const schedule = rule.schedule;
  if (schedule.calendar) {
    const calendar = schedule.calendar;
    const { date } = localClock(timestamp, calendar.timeZone, formatters);
    if (date < calendar.coverageFrom || date >= calendar.coverageUntil) throw new Error(`holiday/date calendar does not cover ${date} in ${calendar.timeZone}`);
    const override = calendar.overrides.find((item) => item.date === date);
    if (override) return { prices: override.prices, label: `date override ${date} (${calendar.timeZone})` };
  }
  const clock = localClock(timestamp, schedule.timeZone, formatters);
  const index = schedule.windows.findIndex((window) => window.weekdays.includes(clock.weekday) && clock.minute >= window.start && clock.minute < window.end);
  return index < 0 ? { prices: rule.prices, label: `base (${schedule.timeZone})` }
    : { prices: schedule.windows[index].prices, label: `window ${index + 1} (${schedule.timeZone})` };
}
const count = (value: number | null | undefined): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** The portable report's cost.detail is limited to 8,192 characters. Keep whole
 * provenance entries and state any omission; the live breakdown remains intact. */
function costDetail(summary: string, appliedRules: string[]): string {
  if (!appliedRules.length) return `${summary} No rule applied.`;
  const prefix = `${summary} Rules: `;
  const full = `${prefix}${appliedRules.join("; ")}.`;
  if (full.length <= 8192) return full;
  const omitted = " Additional provenance omitted; inspect pricing files/usage breakdown.";
  let detail = prefix;
  for (const entry of appliedRules) {
    const addition = `${detail === prefix ? "" : "; "}${entry}`;
    if (detail.length + addition.length + omitted.length > 8192) break;
    detail += addition;
  }
  return detail + omitted;
}

/** Prices only attributable usage. A subtotal is never promoted to complete session cost. */
export function estimateSessionCost(report: PricingReport, catalog: PricingCatalog): SessionCostEstimate {
  const samples = report.usageSamples ?? [];
  const issues: string[] = [], sampleCosts: PricedUsageSample[] = [];
  let issueCount = 0, subtotal = 0;
  const issue = (text: string) => { issueCount++; if (issues.length < 50) issues.push(text); };
  const result = (): SessionCostEstimate => {
    if (issueCount > issues.length) issues.push(`${issueCount - issues.length} additional pricing issues omitted.`);
    const appliedRules = [...new Set(sampleCosts.map((sample) => `${sample.file}#${sample.ruleId} · model ${sample.model} · ${sample.rateLabel} · USD/1M uncached=${sample.prices.input}, cacheRead=${sample.prices.cachedInput}, cacheWrite=${sample.prices.cacheWriteInput ?? "unknown"}, output=${sample.prices.output} · ${sample.source.url} · checked ${sample.source.checkedAt}`))];
    const complete = issueCount === 0 && samples.length > 0 && sampleCosts.length === samples.length;
    return { amount: complete ? subtotal : null, subtotal, pricedSamples: sampleCosts.length, totalSamples: samples.length,
      issues, appliedRules, sampleCosts,
      detail: costDetail(`${complete ? "Estimated API token cost" : "Partial token subtotal only; full session cost is unavailable"}: ${sampleCosts.length}/${samples.length} usage samples priced from explicit JSON model/time rules. Uses the recorded usage-event timestamp; the provider's billing instant may differ, especially at price boundaries. Excludes per-request tools, subscriptions, taxes, credits, and other non-token charges; this is not an invoice.`, appliedRules) };
  };
  if (catalog.errors.length) {
    issue("Automatic pricing is disabled because a pricing document is invalid.");
    catalog.errors.forEach(issue);
    return result();
  }
  if (!catalog.rules.length) { issue("No pricing rules are loaded."); return result(); }
  if (!samples.length) { issue("No per-request usage samples were recorded; aggregate tokens cannot be attributed to models and prices."); return result(); }
  if (samples.length > 100_000) { issue("Too many usage samples to price (maximum 100,000)."); return result(); }
  if (report.usageSamplesComplete !== true) issue("The report does not attest complete usage samples; only a partial subtotal can be shown.");
  const ids = new Map<string, number>();
  for (const sample of samples) ids.set(sample.id, (ids.get(sample.id) ?? 0) + 1);
  const formatters = new Map<string, Intl.DateTimeFormat>();
  const byModel = new Map<string, PricingRule[]>();
  for (const rule of catalog.rules) for (const model of [rule.model, ...rule.aliases]) byModel.set(model, [...(byModel.get(model) ?? []), rule]);
  for (const sample of samples) {
    try {
      if (!sample.id || ids.get(sample.id)! > 1) throw new Error("missing or duplicate sample ID");
      if (!sample.model) throw new Error("model ID was not recorded");
      const timestamp = instant(sample.timestamp, "sample timestamp");
      const matching = (byModel.get(sample.model) ?? []).filter((rule) => timestamp >= rule.from && timestamp < rule.until);
      if (matching.length !== 1) throw new Error(matching.length ? "ambiguous pricing rules" : `no dated pricing rule for exact model ${JSON.stringify(sample.model)}`);
      if (![sample.inputTokens, sample.outputTokens, sample.cachedInputTokens, sample.cacheWriteInputTokens].every(count)) throw new Error("input/output/cache-read/cache-write counts must all be known nonnegative safe integers");
      const input = sample.inputTokens!, output = sample.outputTokens!, read = sample.cachedInputTokens!, write = sample.cacheWriteInputTokens!;
      if (!Number.isSafeInteger(read + write) || read + write > input) throw new Error("cache-read plus cache-write counts exceed total input");
      const rule = matching[0], rate = rateAt(rule, timestamp, formatters);
      if (write > 0 && rate.prices.cacheWriteInput === null) throw new Error("cache-write tokens were recorded but no cache-write price is configured");
      const amount = ((input - read - write) * rate.prices.input + read * rate.prices.cachedInput
        + write * (rate.prices.cacheWriteInput ?? 0) + output * rate.prices.output) / 1_000_000;
      if (!Number.isFinite(amount) || !Number.isFinite(subtotal + amount)) throw new Error("calculated price exceeds finite numeric range");
      subtotal += amount;
      sampleCosts.push({ sampleId: sample.id, model: sample.model, file: rule.file, ruleId: rule.id, amount,
        prices: rate.prices, rateLabel: rate.label, source: rule.source,
        ...(rule.schedule?.calendar ? { calendarSource: rule.schedule.calendar.source } : {}) });
    } catch (cause) { issue(`${sample.id || "Unnamed sample"}: ${cause instanceof Error ? cause.message : String(cause)}.`); }
  }
  for (const field of ["inputTokens", "outputTokens", "cachedInputTokens"] as const) {
    const aggregate = report.usage[field];
    if (!count(aggregate)) { issue(`Session ${field} total is unknown or invalid; full usage cannot be verified.`); continue; }
    let sum = 0, valid = true;
    for (const sample of samples) {
      const value = sample[field];
      if (!count(value) || !Number.isSafeInteger(sum + value)) { valid = false; break; }
      sum += value;
    }
    if (!valid || sum !== aggregate) issue(`Sample ${field} total ${valid ? sum : "is unknown"} does not reconcile with session total ${aggregate}.`);
  }
  return result();
}
