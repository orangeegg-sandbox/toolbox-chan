import {
  codeLabel, describeCharacter, isLineBreak, isNonTextControl, isUnusualHorizontalSpace,
  type CharacterGroup,
} from "./unicode";

export type { CharacterGroup } from "./unicode";

export interface Character {
  index: number;
  start: number;
  end: number;
  value: string;
  codePoint: number;
  code: string;
  name: string;
  marker: string;
  group: CharacterGroup;
  line: number;
  column: number;
  /** True on the final code point of a logical newline (only LF in CRLF). */
  newline: boolean;
}

export interface Finding {
  codePoint: number;
  code: string;
  name: string;
  marker: string;
  group: CharacterGroup;
  occurrences: Character[];
}

export interface ScanResult {
  characters: Character[];
  codePointCount: number;
  newlineCount: number;
  invalidCount: number;
  findings: Finding[];
}

export interface CleanRules {
  removeControls: boolean;
  removeLeadingBom: boolean;
  removeZeroWidthSpace: boolean;
  removeWordJoiner: boolean;
  removeBom: boolean;
  removeSoftHyphen: boolean;
  removeDirection: boolean;
  convertSpaces: boolean;
  lineEndings: "preserve" | "lf" | "crlf";
}

export interface Change {
  /** Nonoverlapping offsets into the original UTF-16 source string. */
  start: number;
  end: number;
  before: string;
  after: string;
  reason: string;
}

export interface Analysis {
  source: ScanResult;
  output: string;
  result: ScanResult;
  changes: Change[];
  /** Source code points removed by a removal rule, excluding newline conversions. */
  removedCount: number;
  /** Changed horizontal spaces and logical newline tokens, each counted once. */
  convertedCount: number;
}

export const MAX_INPUT_UNITS = 100_000;

export const DEFAULT_RULES: Readonly<CleanRules> = Object.freeze({
  removeControls: true,
  removeLeadingBom: true,
  removeZeroWidthSpace: false,
  removeWordJoiner: false,
  removeBom: false,
  removeSoftHyphen: false,
  removeDirection: false,
  convertSpaces: false,
  lineEndings: "preserve",
});

function validateInput(text: string): void {
  if (text.length > MAX_INPUT_UNITS) {
    throw new Error(`Text is too large (${text.length.toLocaleString("en-US")} UTF-16 code units). Paste at most 100,000 UTF-16 code units.`);
  }
}

function scanCharacters(text: string): ScanResult {
  const characters: Character[] = [];
  const findings = new Map<number, Finding>();
  let start = 0;
  let line = 1;
  let column = 1;
  let newlineCount = 0;
  let invalidCount = 0;

  // String iteration preserves lone surrogate units while joining valid pairs.
  for (const value of text) {
    const codePoint = value.codePointAt(0)!;
    const end = start + value.length;
    const description = describeCharacter(codePoint, value);
    const newline = isLineBreak(codePoint) && !(codePoint === 0x000d && text.charCodeAt(end) === 0x000a);
    const character: Character = {
      index: characters.length + 1, start, end, value, codePoint,
      code: codeLabel(codePoint), ...description, line, column, newline,
    };
    characters.push(character);
    if (description.group !== "text") {
      let finding = findings.get(codePoint);
      if (!finding) {
        finding = { codePoint, code: character.code, ...description, occurrences: [] };
        findings.set(codePoint, finding);
      }
      finding.occurrences.push(character);
    }
    if (description.group === "invalid") invalidCount++;
    if (newline) {
      newlineCount++;
      line++;
      column = 1;
    } else {
      column++;
    }
    start = end;
  }

  return { characters, codePointCount: characters.length, newlineCount, invalidCount, findings: [...findings.values()] };
}

export function scan(text: string): ScanResult {
  validateInput(text);
  return scanCharacters(text);
}

function removalReason(character: Character, rules: CleanRules): string | undefined {
  const point = character.codePoint;
  if (rules.removeControls && isNonTextControl(point)) return "Remove non-text control";
  if (rules.removeZeroWidthSpace && point === 0x200b) return "Remove zero-width space";
  if (rules.removeWordJoiner && point === 0x2060) return "Remove word joiner";
  if (rules.removeBom && point === 0xfeff) return "Remove BOM character";
  if (rules.removeSoftHyphen && point === 0x00ad) return "Remove soft hyphen";
  if (rules.removeDirection && character.group === "direction") return "Remove direction control";
  return undefined;
}

export function analyze(text: string, rules: CleanRules): Analysis {
  const source = scan(text);
  const changes: Change[] = [];
  const retained: Character[] = [];
  let removedCount = 0;
  let convertedCount = 0;
  const change = (character: Character, after: string, reason: string) => {
    changes.push({ start: character.start, end: character.end, before: character.value, after, reason });
  };

  for (const character of source.characters) {
    const reason = removalReason(character, rules);
    if (reason) {
      change(character, "", reason);
      removedCount++;
    } else {
      retained.push(character);
    }
  }

  // Removal happens first so BOM/control/BOM prefixes are handled in one pass.
  // A retained space, newline or any other non-BOM ends this prefix permanently.
  let first = 0;
  if (rules.removeLeadingBom) {
    while (retained[first]?.codePoint === 0xfeff) {
      change(retained[first], "", "Remove leading BOM");
      removedCount++;
      first++;
    }
  }

  const outputParts: string[] = [];
  for (let index = first; index < retained.length; index++) {
    const character = retained[index];
    if (rules.convertSpaces && isUnusualHorizontalSpace(character.value)) {
      change(character, " ", "Convert to ordinary space");
      convertedCount++;
      outputParts.push(" ");
    } else if (rules.lineEndings !== "preserve" && isLineBreak(character.codePoint)) {
      const pair = character.codePoint === 0x000d && retained[index + 1]?.codePoint === 0x000a;
      const after = rules.lineEndings === "lf" ? "\n" : "\r\n";
      const before = pair ? "\r\n" : character.value;
      if (before !== after) {
        // For CRLF -> LF, remove only CR. This gives exact, nonoverlapping
        // source edits even if removal reconnected CR and LF across a control.
        change(character, pair ? "" : after, `Convert line ending to ${rules.lineEndings === "lf" ? "LF" : "CRLF"}`);
        convertedCount++;
      }
      outputParts.push(after);
      if (pair) index++;
    } else {
      outputParts.push(character.value);
    }
  }

  const output = outputParts.join("");
  changes.sort((left, right) => left.start - right.start);
  // The cap applies to pasted source. LF -> CRLF can legitimately double the
  // output length, and every output character must still be rescanned.
  return { source, output, result: scanCharacters(output), changes, removedCount, convertedCount };
}
