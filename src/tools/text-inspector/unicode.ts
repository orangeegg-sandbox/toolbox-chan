export type CharacterGroup = "text" | "formatting" | "space" | "hidden" | "direction" | "language" | "control" | "other" | "invalid";

interface Description {
  name: string;
  marker: string;
  group: CharacterGroup;
}

// Property membership follows the host JavaScript engine's Unicode data. The
// small name table is deliberately not presented as a complete Unicode database.
const direction = /\p{Bidi_Control}/u;
const horizontalSpace = /\p{Zs}/u;
const mark = /\p{M}/u;
const variationSelector = /\p{Variation_Selector}/u;
const defaultIgnorable = /\p{Default_Ignorable_Code_Point}/u;
const format = /\p{Cf}/u;
const noncharacter = /\p{Noncharacter_Code_Point}/u;
const privateUse = /\p{Co}/u;
const unassigned = /\p{Cn}/u;
const letter = /\p{L}/u;
const number = /\p{N}/u;
const punctuation = /\p{P}/u;
const symbol = /\p{S}/u;

type NamedCharacter = readonly [name: string, marker: string, group: CharacterGroup];

const names: Readonly<Record<number, NamedCharacter>> = {
  0x0000: ["Null", "NUL", "control"],
  0x0008: ["Backspace", "BS", "control"],
  0x0009: ["Character tabulation", "TAB", "formatting"],
  0x000a: ["Line feed", "LF", "formatting"],
  0x000b: ["Line tabulation", "VT", "control"],
  0x000c: ["Form feed", "FF", "control"],
  0x000d: ["Carriage return", "CR", "formatting"],
  0x001b: ["Escape", "ESC", "control"],
  0x0020: ["Space", "SPACE", "formatting"],
  0x007f: ["Delete", "DEL", "control"],
  0x0085: ["Next line", "NEL", "formatting"],
  0x00a0: ["No-break space", "NBSP", "space"],
  0x00ad: ["Soft hyphen", "SHY", "hidden"],
  0x034f: ["Combining grapheme joiner", "CGJ", "language"],
  0x061c: ["Arabic letter mark", "ALM", "direction"],
  0x115f: ["Hangul choseong filler", "HANGUL FILLER", "other"],
  0x1160: ["Hangul jungseong filler", "HANGUL FILLER", "other"],
  0x1680: ["Ogham space mark", "OGHAM SPACE", "space"],
  0x180e: ["Mongolian vowel separator", "MVS", "hidden"],
  0x2000: ["En quad", "EN QUAD", "space"],
  0x2001: ["Em quad", "EM QUAD", "space"],
  0x2002: ["En space", "EN SPACE", "space"],
  0x2003: ["Em space", "EM SPACE", "space"],
  0x2004: ["Three-per-em space", "3-PER-EM SPACE", "space"],
  0x2005: ["Four-per-em space", "4-PER-EM SPACE", "space"],
  0x2006: ["Six-per-em space", "6-PER-EM SPACE", "space"],
  0x2007: ["Figure space", "FIGURE SPACE", "space"],
  0x2008: ["Punctuation space", "PUNCTUATION SPACE", "space"],
  0x2009: ["Thin space", "THIN SPACE", "space"],
  0x200a: ["Hair space", "HAIR SPACE", "space"],
  0x200b: ["Zero width space", "ZWSP", "hidden"],
  0x200c: ["Zero width non-joiner", "ZWNJ", "language"],
  0x200d: ["Zero width joiner", "ZWJ", "language"],
  0x200e: ["Left-to-right mark", "LRM", "direction"],
  0x200f: ["Right-to-left mark", "RLM", "direction"],
  0x2028: ["Line separator", "LS", "formatting"],
  0x2029: ["Paragraph separator", "PS", "formatting"],
  0x202a: ["Left-to-right embedding", "LRE", "direction"],
  0x202b: ["Right-to-left embedding", "RLE", "direction"],
  0x202c: ["Pop directional formatting", "PDF", "direction"],
  0x202d: ["Left-to-right override", "LRO", "direction"],
  0x202e: ["Right-to-left override", "RLO", "direction"],
  0x202f: ["Narrow no-break space", "NNBSP", "space"],
  0x205f: ["Medium mathematical space", "MEDIUM SPACE", "space"],
  0x2060: ["Word joiner", "WJ", "hidden"],
  0x2066: ["Left-to-right isolate", "LRI", "direction"],
  0x2067: ["Right-to-left isolate", "RLI", "direction"],
  0x2068: ["First strong isolate", "FSI", "direction"],
  0x2069: ["Pop directional isolate", "PDI", "direction"],
  0x2800: ["Braille pattern blank", "BRAILLE BLANK", "other"],
  0x3000: ["Ideographic space", "IDEOGRAPHIC SPACE", "space"],
  0x3164: ["Hangul filler", "HANGUL FILLER", "other"],
  0xfeff: ["Byte order mark / zero width no-break space", "BOM", "hidden"],
  0xffa0: ["Halfwidth Hangul filler", "HANGUL FILLER", "other"],
  0xfffd: ["Replacement character", "REPLACEMENT", "other"],
  0xe007f: ["Cancel tag", "CANCEL TAG", "language"],
};

export function codeLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function isLineBreak(codePoint: number): boolean {
  return codePoint === 0x000a || codePoint === 0x000d || codePoint === 0x0085 || codePoint === 0x2028 || codePoint === 0x2029;
}

export function isNonTextControl(codePoint: number): boolean {
  return (codePoint <= 0x001f || (codePoint >= 0x007f && codePoint <= 0x009f))
    && codePoint !== 0x0009 && !isLineBreak(codePoint);
}

export function isUnusualHorizontalSpace(value: string): boolean {
  return value !== " " && horizontalSpace.test(value);
}

export function describeCharacter(codePoint: number, value: string): Description {
  const code = codeLabel(codePoint);
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    return { name: `Unpaired ${codePoint <= 0xdbff ? "high" : "low"} surrogate`, marker: `[INVALID ${code}]`, group: "invalid" };
  }
  const known = names[codePoint];
  if (known) return { name: known[0], marker: `[${known[1]}]`, group: known[2] };
  if (isNonTextControl(codePoint)) return { name: `Control character ${code}`, marker: `[${code}]`, group: "control" };
  if (direction.test(value)) return { name: `Direction control ${code}`, marker: `[${code}]`, group: "direction" };
  if (horizontalSpace.test(value)) return { name: `Space separator ${code}`, marker: `[${code}]`, group: "space" };
  if (variationSelector.test(value)) {
    const selector = codePoint >= 0xe0100 ? codePoint - 0xe0100 + 17 : codePoint - 0xfe00 + 1;
    // Mongolian variation selectors are named separately from the numbered VS range.
    const name = codePoint >= 0x180b && codePoint <= 0x180d || codePoint === 0x180f
      ? `Mongolian free variation selector ${code}` : `Variation selector-${selector}`;
    return { name, marker: `[VS ${code}]`, group: "language" };
  }
  if (mark.test(value)) return { name: `Combining mark ${code}`, marker: `[MARK ${code}]`, group: "language" };
  if (codePoint >= 0xe0020 && codePoint <= 0xe007e) {
    return { name: `Unicode tag character ${code}`, marker: `[TAG ${code}]`, group: "language" };
  }
  if (defaultIgnorable.test(value)) return { name: `Default-ignorable character ${code}`, marker: `[${code}]`, group: "hidden" };
  if (format.test(value)) return { name: `Format character ${code}`, marker: `[${code}]`, group: "hidden" };
  if (noncharacter.test(value)) return { name: `Unicode noncharacter ${code}`, marker: `[${code}]`, group: "other" };
  if (privateUse.test(value)) return { name: `Private-use character ${code}`, marker: `[${code}]`, group: "other" };
  if (unassigned.test(value)) return { name: `Unassigned code point ${code}`, marker: `[${code}]`, group: "other" };
  const category = letter.test(value) ? "Letter" : number.test(value) ? "Number"
    : punctuation.test(value) ? "Punctuation" : symbol.test(value) ? "Symbol" : "Character";
  return { name: `${category} ${code}`, marker: value, group: "text" };
}
