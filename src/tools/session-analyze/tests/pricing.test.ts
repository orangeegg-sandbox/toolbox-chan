import { describe, expect, it } from "vitest";
import seed from "../pricing/deepseek.json";
import { estimateSessionCost, parsePricingDocuments, type PricingUsageSample } from "../pricing";
import { parseReport } from "../import";

const basePrices = { input: 2, cachedInput: 0.2, cacheWriteInput: 3, output: 8 };
const peakPrices = { input: 4, cachedInput: 0.4, cacheWriteInput: 6, output: 16 };
const provenance = { url: "https://example.com/verified-prices", checkedAt: "2026-10-27" };
function rule(overrides: Record<string, unknown> = {}) {
  return { id: "example-2026", model: "example-model", aliases: ["explicit-alias"],
    effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: "2027-01-01T00:00:00Z",
    source: provenance, prices: basePrices, ...overrides };
}
function doc(rules: unknown[] = [rule()]) { return { schemaVersion: 1, currency: "USD", rules }; }
function file(value: unknown, name = "example.json") { return { name, json: JSON.stringify(value) }; }
function catalog(rules: unknown[] = [rule()]) {
  const parsed = parsePricingDocuments([file(doc(rules))]);
  expect(parsed.errors).toEqual([]);
  return parsed.catalog;
}
function sample(overrides: Partial<PricingUsageSample> = {}): PricingUsageSample {
  return { id: "request-1", model: "example-model", timestamp: "2026-10-27T02:00:00Z",
    inputTokens: 1000, cachedInputTokens: 100, cacheWriteInputTokens: 50, outputTokens: 200,
    source: "record 1", ...overrides };
}
function report(samples = [sample()]) {
  const sum = (field: "inputTokens" | "outputTokens" | "cachedInputTokens") => samples.reduce((sum, item) => sum + (item[field] ?? 0), 0);
  return { usageSamples: samples, usageSamplesComplete: true,
    usage: { inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), cachedInputTokens: sum("cachedInputTokens"), reasoningTokens: null, basis: "Synthetic complete usage." } };
}
function schedule(overrides: Record<string, unknown> = {}) {
  return { timeZone: "UTC", windows: [{ weekdays: [1, 2, 3, 4, 5], start: "01:00", end: "04:00", prices: peakPrices }], ...overrides };
}
function calendar(overrides: Record<string, unknown> = {}) {
  return { timeZone: "Asia/Shanghai", coverageFrom: "2026-01-01", coverageUntil: "2027-01-01", source: provenance, overrides: [], ...overrides };
}
const price = (timestamp: string, rules = [rule({ schedule: schedule() })]) => estimateSessionCost(report([sample({ timestamp })]), catalog(rules));

describe("exact model pricing and accounting", () => {
  it("charges disjoint cache buckets and retains rule and rate provenance", () => {
    const result = estimateSessionCost(report(), catalog());
    expect(result.amount).toBeCloseTo(0.00347, 10);
    expect(result.subtotal).toBe(result.amount);
    expect(result.pricedSamples).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.sampleCosts[0]).toMatchObject({ sampleId: "request-1", ruleId: "example-2026", file: "example.json", prices: basePrices, source: provenance });
    expect(result.appliedRules[0]).toContain("example.json#example-2026");
    expect(result.detail).toContain(provenance.url);
    expect(result.detail).toContain("billing instant may differ");
    expect(result.detail).toContain("not an invoice");
  });

  it("keeps applied base and peak bucket prices distinct in the saved cost detail", () => {
    const samples = [sample(), sample({ id: "request-2", timestamp: "2026-10-27T05:00:00Z" })];
    const result = estimateSessionCost(report(samples), catalog([rule({ schedule: schedule() })]));
    expect(result.appliedRules).toHaveLength(2);
    expect(result.appliedRules[0]).toContain("window 1 (UTC)");
    expect(result.appliedRules[0]).toContain("USD/1M uncached=4, cacheRead=0.4, cacheWrite=6, output=16");
    expect(result.appliedRules[1]).toContain("base (UTC)");
    expect(result.appliedRules[1]).toContain("USD/1M uncached=2, cacheRead=0.2, cacheWrite=3, output=8");
    for (const applied of result.appliedRules) expect(result.detail).toContain(applied);
    expect(result.detail).not.toContain("provenance omitted");
  });

  it("bounds long saved provenance without changing the amount or live breakdown, preserving importability", () => {
    const rules = Array.from({ length: 4 }, (_, index) => rule({
      id: `${index}-${"rule".repeat(120)}`, model: `model-${index}`, aliases: [],
      source: { ...provenance, url: `https://example.com/${"p".repeat(1950)}` },
    }));
    const samples = rules.map((_, index) => sample({ id: `request-${index}`, model: `model-${index}` }));
    const usageReport = report(samples);
    const result = estimateSessionCost(usageReport, catalog(rules));
    expect(result.amount).toBeCloseTo(0.00347 * 4, 10);
    expect(result.issues).toEqual([]);
    expect(result.detail.length).toBeLessThanOrEqual(8192);
    expect(result.detail).toContain("Additional provenance omitted; inspect pricing files/usage breakdown.");
    expect(result.appliedRules).toHaveLength(4);
    expect(result.sampleCosts).toHaveLength(4);
    const portable = {
      schemaVersion: 1,
      session: { sourcePath: "fixture", id: "provenance-test", agent: "other", title: "Pricing provenance", project: null, modifiedAt: 0, sizeBytes: 0, tower: "unknown" },
      analyzedAt: "2026-10-27T00:00:00Z", events: [], files: [], warnings: [], ...usageReport,
      cost: { amount: result.amount, currency: "USD", basis: "estimated", detail: result.detail },
    };
    expect(parseReport(JSON.stringify(portable)).cost.detail).toBe(result.detail);
  });

  it("requires exact model IDs or explicitly listed aliases", () => {
    expect(estimateSessionCost(report([sample({ model: "explicit-alias" })]), catalog()).amount).toBeCloseTo(0.00347, 10);
    for (const model of ["EXAMPLE-MODEL", "example-model-latest", "example", null]) {
      const result = estimateSessionCost(report([sample({ model })]), catalog());
      expect(result.amount).toBeNull();
      expect(result.pricedSamples).toBe(0);
    }
  });

  it("does not treat an absent cache-write price as free positive cache writes", () => {
    for (const prices of [{ input: 2, cachedInput: 0.2, output: 8 }, { ...basePrices, cacheWriteInput: null }]) {
      const rules = catalog([rule({ prices })]);
      expect(estimateSessionCost(report(), rules).amount).toBeNull();
      const result = estimateSessionCost(report([sample({ cacheWriteInputTokens: 0 })]), rules);
      expect(result.amount).toBeCloseTo(0.00342, 10);
    }
  });

  it("accepts verified zero rates and zero usage without guessing missing buckets", () => {
    const free = catalog([rule({ prices: { input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0 } })]);
    expect(estimateSessionCost(report(), free).amount).toBe(0);
    const empty = sample({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0 });
    expect(estimateSessionCost(report([empty]), catalog()).amount).toBe(0);
    for (const field of ["inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteInputTokens"] as const) {
      expect(estimateSessionCost(report([sample({ [field]: null })]), free).amount).toBeNull();
    }
  });

  it("rejects invalid counts, overlapping cache subsets, and numeric overflow", () => {
    for (const inputTokens of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      expect(estimateSessionCost(report([sample({ inputTokens })]), catalog()).amount).toBeNull();
    }
    expect(estimateSessionCost(report([sample({ cachedInputTokens: 990, cacheWriteInputTokens: 50 })]), catalog()).amount).toBeNull();
    expect(estimateSessionCost(report(), catalog([rule({ prices: { ...basePrices, output: 1e308 } })])).amount).toBeNull();
  });

  it("selects historical intervals at their exact included/excluded endpoints", () => {
    const rules = catalog([
      rule({ id: "old", effectiveUntil: "2026-10-27T02:00:00Z" }),
      rule({ id: "new", effectiveFrom: "2026-10-27T02:00:00Z", prices: peakPrices }),
    ]);
    const samples = [sample({ timestamp: "2026-10-27T01:59:59.999Z" }), sample({ id: "request-2", timestamp: "2026-10-27T02:00:00Z" })];
    const result = estimateSessionCost(report(samples), rules);
    expect(result.amount).toBeCloseTo(0.00347 * 3, 10);
    expect(result.sampleCosts.map((item) => item.ruleId)).toEqual(["old", "new"]);
    expect(estimateSessionCost(report([sample({ timestamp: "2025-12-31T23:59:59Z" })]), rules).amount).toBeNull();
    expect(estimateSessionCost(report([sample({ timestamp: "2027-01-01T00:00:00Z" })]), rules).amount).toBeNull();
  });

  it("requires real, timezone-qualified sample timestamps even for flat rates", () => {
    for (const timestamp of [null, "2026-10-27", "2026-10-27T02:00:00", "2026-02-30T02:00:00Z", "2026-10-27T24:00:00Z"]) {
      expect(estimateSessionCost(report([sample({ timestamp })]), catalog()).amount).toBeNull();
    }
    expect(estimateSessionCost(report([sample({ timestamp: "2026-10-27T10:00:00+08:00" })]), catalog()).amount).toBeCloseTo(0.00347, 10);
  });
});

describe("time schedules and calendar coverage", () => {
  it.each([
    ["2026-10-27T00:59:59Z", 1], ["2026-10-27T01:00:00Z", 2],
    ["2026-10-27T03:59:59Z", 2], ["2026-10-27T04:00:00Z", 1],
    ["2026-10-31T02:00:00Z", 1], ["2026-11-01T02:00:00Z", 1],
  ])("applies weekday half-open windows at %s", (timestamp, multiplier) => {
    expect(price(timestamp).amount).toBeCloseTo(0.00347 * multiplier, 10);
  });

  it("uses IANA timezone daylight-saving rules for each actual instant", () => {
    const rules = [rule({ schedule: schedule({ timeZone: "America/New_York", windows: [{ weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "10:00", prices: peakPrices }] }) })];
    expect(price("2026-06-01T13:00:00Z", rules).amount).toBeCloseTo(0.00694, 10);
    expect(price("2026-01-05T14:00:00Z", rules).amount).toBeCloseTo(0.00694, 10);
    expect(price("2026-01-05T13:00:00Z", rules).amount).toBeCloseTo(0.00347, 10);
  });

  it("applies full-day date overrides in their calendar zone before weekly windows", () => {
    const overrides = [{ date: "2026-10-28", prices: { input: 0, cachedInput: 0, cacheWriteInput: 0, output: 0 } }];
    const rules = [rule({ schedule: schedule({ calendar: calendar({ overrides }) }) })];
    expect(price("2026-10-27T02:00:00Z", rules).amount).toBeCloseTo(0.00694, 10);
    expect(price("2026-10-27T16:00:00Z", rules).amount).toBe(0);
    const holiday = price("2026-10-28T02:00:00Z", rules);
    expect(holiday.amount).toBe(0);
    expect(holiday.sampleCosts[0].rateLabel).toContain("date override 2026-10-28");
    expect(holiday.sampleCosts[0].calendarSource).toEqual(provenance);
    expect(price("2026-10-28T16:00:00Z", rules).amount).toBeCloseTo(0.00347, 10);
  });

  it("fails closed beyond verified calendar coverage, including off-peak hours", () => {
    const rules = [rule({ schedule: schedule({ calendar: calendar({ coverageFrom: "2026-10-27", coverageUntil: "2026-10-28" }) }) })];
    expect(price("2026-10-27T02:00:00Z", rules).amount).not.toBeNull();
    for (const timestamp of ["2026-10-26T02:00:00Z", "2026-10-27T16:00:00Z", "2026-10-28T02:00:00Z"]) {
      const result = price(timestamp, rules);
      expect(result.amount).toBeNull();
      expect(result.issues.join(" ")).toContain("calendar does not cover");
    }
  });

  it("supports explicit windows ending at midnight", () => {
    const rules = [rule({ schedule: schedule({ windows: [{ weekdays: [2], start: "23:00", end: "24:00", prices: peakPrices }] }) })];
    expect(price("2026-10-27T23:59:59Z", rules).amount).toBeCloseTo(0.00694, 10);
    expect(price("2026-10-28T00:00:00Z", rules).amount).toBeCloseTo(0.00347, 10);
  });
});

describe("strict pricing document validation", () => {
  it("rejects invalid JSON without retaining a usable partial catalog", () => {
    const parsed = parsePricingDocuments([file(doc()), { name: "bad.json", json: "{invalid" }]);
    expect(parsed.errors.join(" ")).toContain("bad.json");
    expect(parsed.catalog.rules).toEqual([]);
    const result = estimateSessionCost(report(), parsed.catalog);
    expect(result.amount).toBeNull();
    expect(result.subtotal).toBe(0);
    expect(result.issues.join(" ")).toContain("disabled");
  });

  it.each([
    ["schema version", { ...doc(), schemaVersion: 2 }],
    ["currency", { ...doc(), currency: "HKD" }],
    ["unknown document field", { ...doc(), fallback: "example-model" }],
    ["unknown rate field", doc([rule({ prices: { ...basePrices, cached: 1 } })])],
    ["negative rate", doc([rule({ prices: { ...basePrices, input: -1 } })])],
    ["string rate", doc([rule({ prices: { ...basePrices, output: "8" } })])],
    ["missing required rate", doc([rule({ prices: { input: 2, output: 8 } })])],
    ["invalid checked date", doc([rule({ source: { ...provenance, checkedAt: "2026-02-30" } })])],
    ["non-URL source", doc([rule({ source: { ...provenance, url: "file:///prices.json" } })])],
    ["non-UTC effective interval", doc([rule({ effectiveFrom: "2026-01-01T08:00:00+08:00" })])],
    ["inverted effective interval", doc([rule({ effectiveUntil: "2025-01-01T00:00:00Z" })])],
    ["duplicate alias", doc([rule({ aliases: ["example-model"] })])],
    ["unknown timezone", doc([rule({ schedule: schedule({ timeZone: "Invalid/Zone" }) })])],
    ["overnight window", doc([rule({ schedule: schedule({ windows: [{ weekdays: [1], start: "22:00", end: "02:00", prices: peakPrices }] }) })])],
    ["duplicate weekday", doc([rule({ schedule: schedule({ windows: [{ weekdays: [1, 1], start: "01:00", end: "04:00", prices: peakPrices }] }) })])],
    ["calendar date outside coverage", doc([rule({ schedule: schedule({ calendar: calendar({ overrides: [{ date: "2027-01-01", prices: basePrices }] }) }) })])],
  ])("rejects %s", (_name, value) => {
    const parsed = parsePricingDocuments([file(value)]);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.catalog.rules).toEqual([]);
  });

  it("rejects overlapping model/alias histories across files and duplicate file names", () => {
    const parsed = parsePricingDocuments([file(doc()), file(doc([rule({ id: "other", model: "different", aliases: ["explicit-alias"] })]), "second.json")]);
    expect(parsed.errors.join(" ")).toContain("overlaps");
    expect(parsed.catalog.rules).toEqual([]);
    expect(parsePricingDocuments([file(doc()), file(doc())]).errors.join(" ")).toContain("duplicate file name");
  });

  it("rejects overlapping weekday windows and duplicate date overrides", () => {
    const windows = [
      { weekdays: [1, 2], start: "01:00", end: "04:00", prices: basePrices },
      { weekdays: [2, 3], start: "03:00", end: "05:00", prices: peakPrices },
    ];
    expect(parsePricingDocuments([file(doc([rule({ schedule: schedule({ windows }) })]))]).errors.join(" ")).toContain("overlap");
    const overrides = [{ date: "2026-10-27", prices: basePrices }, { date: "2026-10-27", prices: peakPrices }];
    expect(parsePricingDocuments([file(doc([rule({ schedule: schedule({ calendar: calendar({ overrides }) }) })]))]).errors.join(" ")).toContain("duplicate date");
  });

  it("enforces config bounds and rejects non-finite JSON numbers", () => {
    expect(parsePricingDocuments(Array.from({ length: 33 }, (_, i) => file(doc(), `${i}.json`))).errors.join(" ")).toContain("32 JSON files");
    expect(parsePricingDocuments([{ name: "large.json", json: " ".repeat(1024 * 1024 + 1) }]).errors.join(" ")).toContain("1 MiB");
    const padded = Array.from({ length: 9 }, (_, i) => ({ name: `${i}.json`, json: JSON.stringify(doc([rule({ model: `model-${i}`, aliases: [] })])).padEnd(1024 * 1024, " ") }));
    expect(parsePricingDocuments(padded).errors.join(" ")).toContain("8 MiB");
    expect(parsePricingDocuments([{ name: "infinite.json", json: JSON.stringify(doc()).replace('"input":2', '"input":1e999') }]).errors.join(" ")).toContain("finite");
  });
});

describe("incomplete usage is never a full session cost", () => {
  it("returns a labeled partial subtotal for mixed known and unknown models", () => {
    const result = estimateSessionCost(report([sample(), sample({ id: "request-2", model: "unpriced-model" })]), catalog());
    expect(result.amount).toBeNull();
    expect(result.subtotal).toBeCloseTo(0.00347, 10);
    expect(result.pricedSamples).toBe(1);
    expect(result.totalSamples).toBe(2);
    expect(result.detail).toContain("Partial token subtotal only");
  });

  it("requires complete attestation and reconciles all aggregate buckets", () => {
    for (const usageSamplesComplete of [false, undefined]) {
      const result = estimateSessionCost({ ...report(), usageSamplesComplete }, catalog());
      expect(result.amount).toBeNull();
      expect(result.subtotal).toBeCloseTo(0.00347, 10);
    }
    for (const field of ["inputTokens", "outputTokens", "cachedInputTokens"] as const) {
      for (const value of [null, report().usage[field] + 1]) {
        const result = estimateSessionCost({ ...report(), usage: { ...report().usage, [field]: value } }, catalog());
        expect(result.amount).toBeNull();
        expect(result.issues.join(" ")).toContain(field);
      }
    }
  });

  it("does not double charge duplicate IDs or fabricate samples from aggregates", () => {
    const duplicates = estimateSessionCost(report([sample(), sample()]), catalog());
    expect(duplicates.amount).toBeNull();
    expect(duplicates.subtotal).toBe(0);
    expect(duplicates.pricedSamples).toBe(0);
    expect(estimateSessionCost({ usage: report().usage }, catalog()).amount).toBeNull();
    expect(estimateSessionCost(report(), parsePricingDocuments([]).catalog).amount).toBeNull();
  });
});

describe("verified DeepSeek seed", () => {
  const parsed = parsePricingDocuments([file(seed, "deepseek.json")]);
  const seedSample = (model: string, timestamp: string) => sample({ model, timestamp, inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteInputTokens: 0 });

  it("loads only the verified exact IDs and documented aliases", () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.catalog.rules.map((entry) => entry.model)).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    for (const model of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
      expect(estimateSessionCost(report([seedSample(model, "2026-10-27T02:00:00Z")]), parsed.catalog).amount).toBeCloseTo(1.5, 10);
      expect(estimateSessionCost(report([seedSample(model, "2026-10-27T05:00:00Z")]), parsed.catalog).amount).toBeCloseTo(0.75, 10);
    }
    expect(estimateSessionCost(report([seedSample("deepseek-v4-pro", "2026-10-27T06:00:00Z")]), parsed.catalog).amount).toBeCloseTo(5.28, 10);
    expect(estimateSessionCost(report([seedSample("deepseek-v4-pro", "2026-10-27T10:00:00Z")]), parsed.catalog).amount).toBeCloseTo(2.64, 10);
  });

  it("keeps historical prices and unverified future holiday calendars unknown", () => {
    expect(estimateSessionCost(report([seedSample("deepseek-flash", "2026-10-26T23:59:59Z")]), parsed.catalog).amount).toBeNull();
    const future = estimateSessionCost(report([seedSample("deepseek-flash", "2026-12-31T16:00:00Z")]), parsed.catalog);
    expect(future.amount).toBeNull();
    expect(future.issues.join(" ")).toContain("calendar does not cover");
    expect(estimateSessionCost(report([seedSample("deepseek-chat", "2026-10-27T02:00:00Z")]), parsed.catalog).amount).toBeNull();
  });
});
