import { describe, expect, it } from "vitest";
import { analyze, DEFAULT_RULES, MAX_INPUT_UNITS, scan, type Analysis, type CleanRules } from "../engine";

const preserve: CleanRules = { ...DEFAULT_RULES, removeControls: false, removeLeadingBom: false };

function replay(source: string, analysis: Analysis): string {
  let cursor = 0;
  const output: string[] = [];
  for (const change of analysis.changes) {
    expect(change.start).toBeGreaterThanOrEqual(cursor);
    expect(change.end).toBeGreaterThan(change.start);
    expect(source.slice(change.start, change.end)).toBe(change.before);
    expect(change.reason).not.toBe("");
    output.push(source.slice(cursor, change.start), change.after);
    cursor = change.end;
  }
  output.push(source.slice(cursor));
  return output.join("");
}

describe("text inspector scanning", () => {
  it("tracks code-point positions independently of UTF-16 offsets and CRLF line breaks", () => {
    const result = scan("A😀\t中\r\nB\rC\nD\u0085E\u2028F\u2029");
    expect(result.newlineCount).toBe(6);
    expect(result.invalidCount).toBe(0);
    expect(result.characters.slice(0, 7).map(({ index, start, end, line, column, newline }) => ({ index, start, end, line, column, newline }))).toEqual([
      { index: 1, start: 0, end: 1, line: 1, column: 1, newline: false },
      { index: 2, start: 1, end: 3, line: 1, column: 2, newline: false },
      { index: 3, start: 3, end: 4, line: 1, column: 3, newline: false },
      { index: 4, start: 4, end: 5, line: 1, column: 4, newline: false },
      { index: 5, start: 5, end: 6, line: 1, column: 5, newline: false },
      { index: 6, start: 6, end: 7, line: 1, column: 6, newline: true },
      { index: 7, start: 7, end: 8, line: 2, column: 1, newline: false },
    ]);
    expect(result.characters[1]).toMatchObject({ code: "U+1F600", group: "text", value: "😀" });
    expect(result.characters[3]).toMatchObject({ code: "U+4E2D", name: "Letter U+4E2D", group: "text" });
  });

  it("reveals default-ignorables outside the format category and preserves language distinctions", () => {
    const result = scan("\u200B\u200C\u200D\u034F\u0301\u115F\u3164\uFE0F\u{E0100}\u{E0067}\u{E007F}\u{E0001}\u2062");
    expect(result.characters.map(({ group }) => group)).toEqual([
      "hidden", "language", "language", "language", "language", "other", "other",
      "language", "language", "language", "language", "hidden", "hidden",
    ]);
    expect(result.findings).toHaveLength(13);
    expect(result.characters[8]).toMatchObject({ code: "U+E0100", name: "Variation selector-17" });
    expect(result.characters[12].marker).toBe("[U+2062]");
    expect(scan("\u180B").characters[0].name).toBe("Mongolian free variation selector U+180B");
  });

  it("marks every bidi control without letting the actual control enter its label", () => {
    const points = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
    const result = scan(String.fromCodePoint(...points));
    expect(result.characters.every(({ group }) => group === "direction")).toBe(true);
    expect(result.findings).toHaveLength(12);
    for (const character of result.characters) {
      expect(character.marker).not.toContain(character.value);
      expect(character.name).not.toContain(character.value);
    }
  });

  it("groups repeated findings while keeping every occurrence and ordinary formatting", () => {
    const result = scan("a\u200Ba\u200B ");
    expect(result.codePointCount).toBe(5);
    expect(result.findings.map(({ code, occurrences }) => [code, occurrences.map(({ index }) => index)])).toEqual([
      ["U+200B", [2, 4]], ["U+0020", [5]],
    ]);
  });

  it("keeps literal escape and markup text literal", () => {
    const text = String.raw`\u200B[LF]<script>&#8203;`;
    const result = analyze(text, DEFAULT_RULES);
    expect(result.output).toBe(text);
    expect(result.source.findings).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("reports lone surrogates and private, unassigned and blank characters truthfully", () => {
    const malformed = analyze("\uD800X\uDC00😀", DEFAULT_RULES);
    expect(malformed.source.invalidCount).toBe(2);
    expect(malformed.result.invalidCount).toBe(2);
    expect(malformed.output).toBe("\uD800X\uDC00😀");
    expect(malformed.source.characters.map(({ group }) => group)).toEqual(["invalid", "text", "invalid", "text"]);
    expect(malformed.source.characters[0]).toMatchObject({ code: "U+D800", name: "Unpaired high surrogate", start: 0, end: 1 });
    expect(malformed.source.characters[2]).toMatchObject({ code: "U+DC00", name: "Unpaired low surrogate", start: 2, end: 3 });
    expect(scan("\uE000\u0378\uFFFF\u2800\uFFFD").characters.map(({ group }) => group)).toEqual(["other", "other", "other", "other", "other"]);
  });
});

describe("text inspector cleaning", () => {
  it("keeps Chinese, emoji sequences and intentional language formatting under Mixed text", () => {
    const retained = "中文 👩‍👩‍👧‍👦 \u200C e\u0301 é \uFE0F \u{E0067}\u200B\u2060\u00AD\u202E\t\r\n\u0085\u2028\u2029\uFEFF";
    const source = "\uFEFF\uFEFF\0" + retained;
    const result = analyze(source, DEFAULT_RULES);
    expect(result.output).toBe(retained);
    expect(result.removedCount).toBe(3);
    expect(result.convertedCount).toBe(0);
    expect(result.result.newlineCount).toBe(4);
    expect(result.source.characters.map(({ value }) => value).join("")).toBe(source);
    expect(replay(source, result)).toBe(retained);
  });

  it("removes the complete C0/C1/DEL set except TAB, LF, CR and NEL", () => {
    const controls = String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index), ...Array.from({ length: 33 }, (_, index) => index + 0x7f));
    const result = analyze(controls, DEFAULT_RULES);
    expect(result.output).toBe("\t\n\r\u0085");
    expect(result.removedCount).toBe(61);
    expect(result.convertedCount).toBe(0);
    expect(result.result.findings.every(({ group }) => group === "formatting")).toBe(true);
  });

  it.each([
    ["\uFEFF\0\uFEFFA", "A"],
    ["\0\uFEFF", ""],
    ["\uFEFF \uFEFF", " \uFEFF"],
    ["\n\uFEFF", "\n\uFEFF"],
    ["\u200B\uFEFF", "\u200B\uFEFF"],
  ])("removes only the retained leading BOM run (%j)", (source, expected) => {
    expect(analyze(source, DEFAULT_RULES).output).toBe(expected);
  });

  it("makes all optional removals independent and retains joiners and modifiers", () => {
    const source = "\u200B\u2060\uFEFF\u00AD\u202E\u200C\u200D\u0301\uFE0F";
    const cases: [keyof CleanRules, string][] = [
      ["removeZeroWidthSpace", "\u2060\uFEFF\u00AD\u202E\u200C\u200D\u0301\uFE0F"],
      ["removeWordJoiner", "\u200B\uFEFF\u00AD\u202E\u200C\u200D\u0301\uFE0F"],
      ["removeBom", "\u200B\u2060\u00AD\u202E\u200C\u200D\u0301\uFE0F"],
      ["removeSoftHyphen", "\u200B\u2060\uFEFF\u202E\u200C\u200D\u0301\uFE0F"],
      ["removeDirection", "\u200B\u2060\uFEFF\u00AD\u200C\u200D\u0301\uFE0F"],
    ];
    for (const [rule, expected] of cases) {
      const result = analyze(source, { ...preserve, [rule]: true });
      expect(result.output).toBe(expected);
      expect(result.removedCount).toBe(1);
      expect(replay(source, result)).toBe(expected);
    }
    expect(analyze(source, preserve).output).toBe(source);
    expect(analyze("\u200B\uFEFF", { ...DEFAULT_RULES, removeZeroWidthSpace: true }).output).toBe("");
  });

  it("converts horizontal spaces without trimming, collapsing runs or changing tabs/newlines", () => {
    const result = analyze(" \u00A0\u202F\u3000\u2009\t\n ", { ...DEFAULT_RULES, convertSpaces: true });
    expect(result.output).toBe("     \t\n ");
    expect(result.removedCount).toBe(0);
    expect(result.convertedCount).toBe(4);
  });

  it.each(["lf", "crlf"] as const)("normalizes every supported newline to %s", (lineEndings) => {
    const source = "a\r\nb\rc\nd\u0085e\u2028f\u2029g";
    const result = analyze(source, { ...DEFAULT_RULES, lineEndings });
    expect(result.output).toBe(["a", "b", "c", "d", "e", "f", "g"].join(lineEndings === "lf" ? "\n" : "\r\n"));
    expect(result.source.newlineCount).toBe(6);
    expect(result.result.newlineCount).toBe(6);
    expect(result.convertedCount).toBe(5);
    expect(result.removedCount).toBe(0);
    expect(replay(source, result)).toBe(result.output);
    expect(analyze(source, DEFAULT_RULES).output).toBe(source);
  });

  it("recognizes CRLF reconnected by removal and keeps source edits exact", () => {
    const source = "\r\0\n";
    const result = analyze(source, { ...DEFAULT_RULES, lineEndings: "lf" });
    expect(result.output).toBe("\n");
    expect(result.source.newlineCount).toBe(2);
    expect(result.result.newlineCount).toBe(1);
    expect(result.removedCount).toBe(1);
    expect(result.convertedCount).toBe(1);
    expect(result.changes).toEqual([
      { start: 0, end: 1, before: "\r", after: "", reason: "Convert line ending to LF" },
      { start: 1, end: 2, before: "\0", after: "", reason: "Remove non-text control" },
    ]);
    expect(replay(source, result)).toBe(result.output);
  });

  it("maps deletions and conversions after an astral character to original UTF-16 spans", () => {
    const source = "😀\u200B\u00A0\r\nX";
    const result = analyze(source, { ...DEFAULT_RULES, removeZeroWidthSpace: true, convertSpaces: true, lineEndings: "lf" });
    expect(result.output).toBe("😀 \nX");
    expect(result.changes.map(({ start, end, before, after }) => ({ start, end, before, after }))).toEqual([
      { start: 2, end: 3, before: "\u200B", after: "" },
      { start: 3, end: 4, before: "\u00A0", after: " " },
      { start: 4, end: 5, before: "\r", after: "" },
    ]);
    expect(replay(source, result)).toBe(result.output);
  });

  it("handles empty and hidden-only inputs without inventing content", () => {
    expect(analyze("", DEFAULT_RULES)).toMatchObject({ output: "", changes: [], removedCount: 0, convertedCount: 0 });
    const result = analyze("\uFEFF\0\u001B", DEFAULT_RULES);
    expect(result.output).toBe("");
    expect(result.removedCount).toBe(3);
    expect(result.result).toEqual({ characters: [], codePointCount: 0, newlineCount: 0, invalidCount: 0, findings: [] });
  });

  it("is idempotent and produces replayable changes across all rule combinations", () => {
    const keys = ["removeControls", "removeLeadingBom", "removeZeroWidthSpace", "removeWordJoiner", "removeBom", "removeSoftHyphen", "removeDirection", "convertSpaces"] as const;
    const source = "\uFEFF\0\uFEFF\u200B\u2060\uFEFF\r\0\n\u00A0\u202E\u00AD\u202C\u0085\u2028\u2029\t中😀\u200C\u200D\u0301\uFE0F\u{E0067} \uFEFF";
    for (let combination = 0; combination < 256; combination++) {
      for (const lineEndings of ["preserve", "lf", "crlf"] as const) {
        const rules: CleanRules = { ...DEFAULT_RULES, lineEndings };
        keys.forEach((key, bit) => { rules[key] = Boolean(combination & (1 << bit)); });
        const first = analyze(source, rules);
        const second = analyze(first.output, rules);
        expect(second.output).toBe(first.output);
        expect(second.changes).toEqual([]);
        expect(replay(source, first)).toBe(first.output);
      }
    }
  });
});

describe("text inspector input limit", () => {
  it("accepts the exact UTF-16 limit and rejects excess input rather than truncating", () => {
    const result = scan("😀".repeat(MAX_INPUT_UNITS / 2));
    expect(result.codePointCount).toBe(50_000);
    expect(result.characters.at(-1)?.end).toBe(MAX_INPUT_UNITS);
    const tooLong = "a".repeat(MAX_INPUT_UNITS + 1);
    expect(() => scan(tooLong)).toThrow("Paste at most 100,000 UTF-16 code units");
    expect(() => analyze(tooLong, DEFAULT_RULES)).toThrow("100,001 UTF-16 code units");
  });

  it("fully rescans valid output that expands beyond the input-only limit", () => {
    const result = analyze("\n".repeat(MAX_INPUT_UNITS), { ...DEFAULT_RULES, lineEndings: "crlf" });
    expect(result.output.length).toBe(200_000);
    expect(result.result.codePointCount).toBe(200_000);
    expect(result.result.newlineCount).toBe(100_000);
    expect(result.convertedCount).toBe(100_000);
    expect(result.result.characters.at(-1)?.end).toBe(200_000);
  });
});
