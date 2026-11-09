# Text inspector

Status: **Implemented** · 2026-11-09. See [usage and limitations](../../src/tools/text-inspector/README.md).

Inspect pasted text, reveal invisible characters and formatting, and copy or save a cleaned version. The initial audience uses mixed text, including Chinese and emoji. A finding identifies a character; it does not establish that somebody injected it.

## Workflow and layout

1. Paste plain text into the tool. Capture an immutable source string and inspect it immediately.
2. Review marked text and findings. Select a finding to locate its occurrences and see the proposed cleaning action.
3. Adjust cleaning rules and review the derived output and change counts.
4. **Copy cleaned text** or **Save .txt**. Clear explicitly when finished; a new paste replaces the current source.

The workspace uses `ToolPage` with `SplitPane` and `ToolPanel`: source/inspection on the left, cleaning/output on the right. Panels stack in narrow windows. Source has **Marked text** and **All characters** views; output offers **Show formatting**. Grouped findings follow the previews. Copy is the single primary action; save and clear are secondary actions. Paste uses a focused, read-only capture field without requesting clipboard-read permissions.

The source is not a general-purpose editor in the MVP. It remains unchanged by rule changes and cleaning. Empty state: “Paste text to inspect its characters.” Show source/output code-point counts, newline counts and exact change counts; distinguish occurrences from unique character types.

## What inspection reveals

| Group | Examples | Initial treatment |
| --- | --- | --- |
| Ordinary formatting | ASCII space, TAB, LF, CR, CRLF | Show markers; preserve. CRLF is one line break and two code points. |
| Unusual whitespace | NBSP, narrow NBSP, thin/em spaces, NEL, line/paragraph separators | Show names and code points; preserve unless conversion is selected. |
| Hidden formatting | ZWSP, word joiner, BOM, soft hyphen | Review findings; only leading BOM removal is initially enabled. |
| Direction controls | LRM/RLM/ALM, bidi embeddings, overrides, isolates and terminators | Prominent review findings; preserve unless removal is selected. |
| Non-text controls | NUL, backspace, ESC, DEL, other C0/C1 controls | Reveal and remove under the initial preset, with the exceptions below. |
| Language/emoji modifiers | ZWJ, ZWNJ, combining marks, variation selectors, emoji tags | Explain and preserve; these can be essential to writing and emoji. |
| Other noteworthy characters | Hangul fillers, combining grapheme joiner, private-use characters, replacement characters, unpaired surrogates | Identify accurately; do not infer maliciousness. |
| Other characters | Chinese and other letters, punctuation, symbols, emoji | Available in All characters; non-ASCII alone is not a finding. |

Use Unicode properties and explicit special cases. A `Cf`-only detector misses invisible characters in other categories. Document the Unicode data/runtime version used; do not infer character properties from whether a font draws a glyph. Use known names where available and a truthful category plus `U+XXXX` fallback elsewhere.

Marked text uses distinguishable tokens such as `[TAB]`, `[LF]`, `[CRLF]`, `[ZWSP]` and `[NBSP]`; ordinary spaces use a visible marker. Tokens have accessible names and selectable details. Literal text resembling a token remains visually distinct from generated markers. The actual newline still starts the next displayed line. Soft wrapping does not count as a newline. A CRLF across a preview page boundary is shown as separate `[CR]` and `[LF]` entries.

All characters is a paginated logical-order table: index, displayed character or marker, code point, name/category, line/column and cleaning action. It exposes every code point, including punctuation and symbols that the marked view renders normally. Findings group occurrences by character type with counts and expandable locations; filters change only presentation, never analysis or cleaning.

User-facing indices and line/column positions are one-based and count code points, not UTF-16 units or grapheme clusters. CRLF occupies two code-point entries but advances the line once, after LF. Keep zero-based UTF-16 source offsets internally for exact highlighting. Explain that one displayed emoji can contain multiple code points. Malformed surrogate units get explicit diagnostic entries rather than fabricated scalar values.

## Cleaning rules

The initial **Mixed text** preset is deliberately narrow. Its selected rules produce a live output preview; they never modify the source. Show the selected rule and exact action for every changed occurrence.

| Rule | Initial value | Behavior |
| --- | --- | --- |
| Remove non-text controls | On | Remove C0/C1 controls and DEL, except TAB, LF, CR and NEL. |
| Remove leading BOM | On | Remove the full leading `U+FEFF` run in the retained stream, as defined below. |
| Remove zero-width space | Off | Remove `U+200B` only. |
| Remove word joiner | Off | Remove `U+2060` only. |
| Remove other BOM characters | Off | Remove remaining `U+FEFF` occurrences. |
| Remove soft hyphen | Off | Remove `U+00AD` only. |
| Remove direction controls | Off | Remove characters with the Unicode `Bidi_Control` property. |
| Convert unusual horizontal spaces | Off | Convert Unicode `Zs` characters other than ordinary `U+0020` to one ASCII space each; preserve TAB. |
| Line endings | Preserve | Choose Preserve, LF or CRLF; conversion recognizes CRLF, CR, LF, NEL, line separator and paragraph separator. |

Always preserve ordinary Unicode letters/symbols, ZWJ/ZWNJ, combining marks, variation selectors and emoji tags in this MVP. Removing hidden formatting or direction controls can change language, layout or meaning; show that explanation beside the relevant rule. Space conversion does not collapse runs, and no rule trims text or expands tabs.

### Deterministic processing order

1. Scan the complete captured source without decoding escapes, HTML entities or markup. Maintain source spans for findings and changes.
2. Apply the selected character-removal rules, except leading-BOM removal, in one pass. Each removed source occurrence is counted once.
3. If enabled, strip all consecutive `U+FEFF` characters at the start of the retained stream. Selected removals can expose this run: `BOM + NUL + BOM + A` becomes `A` under Mixed text. Stop at the first retained non-BOM character; do not skip whitespace.
4. Apply the selected horizontal-space conversion. It replaces characters without deleting them.
5. Apply the line-ending choice. Match CRLF as a single newline token before matching single-character endings. Preserve leaves the retained sequence unchanged; LF/CRLF maps each recognized token to the chosen sequence.
6. Rescan the complete output and publish it with its changes and remaining findings for the same source/rule revision.

This order must be idempotent: cleaning the result again with the same rules changes nothing. No later conversion may expose new removable prefix characters. Preserve source positions through transformations, including two-unit CRLF conversions. The literal six-character sequence `\u200B` is ordinary text, never an instruction to create a hidden character.

Do not label the result “safe” or “injection-free.” Prefer “3 controls removed; 2 formatting characters remain.” No findings means no characters in the implemented finding categories were found, not that the text is trustworthy.

## Clipboard, output and privacy

- Capture `text/plain` from the paste event before assigning it to a textarea. Analyze that captured string, not a textarea value: textareas normalize CR/CRLF to LF. Prevent the normal editable-textarea path from replacing the authoritative source. Clipboard-button/native reads must preserve the string their API supplies and be verified on the actual host.
- Preserve what the clipboard API delivers. Applications, operating systems or clipboard APIs may already have normalized line endings; the tool cannot recover the original bytes or rich-text content.
- Copy sends the plain derived output, never inspection markers. The clipboard or receiving application may normalize line endings again, so copy is not a byte-preservation guarantee.
- Save writes UTF-8 text with no added BOM and no implicit newline conversion. Reject unpaired surrogates before copy/export rather than silently replacing them. Keep malformed source available for inspection and explain why output is blocked. Verify the existing export helper's exact encoding behavior before promising it in the production UI.
- Processing is entirely local. No AI, backend or network is needed. Do not log, persist, add to activity history or transmit source, output or text-bearing diagnostics. Keep data in session memory only; navigation may retain it through the module provider, and explicit Clear or app exit removes the session copy.
- Read the clipboard only following a paste/read action. Copy and save occur only when requested; Clear does not alter the system clipboard or already saved files.

## Limits, correctness and accessibility

- Initial limit: **100,000 UTF-16 code units** per paste. Reject larger input visibly without truncation and retain the previous source/output. Explain the measured unit at the limit. Inspect the entire accepted input; paginate displayed findings and code-point rows without silently scanning only a prefix.
- Keep source and rule revisions together. On a new paste or rule change, invalidate the prior result immediately; copy/save is disabled until the matching complete output is available. Ignore stale asynchronous results. A scan/clean failure must not publish a partial result.
- Clipboard/export failures show an actionable error and retain the source and rules. Save cancellation is not reported as success. Empty input disables copy/save; a nonempty source that cleans to an empty string remains a valid result and is clearly identified.
- Render source as escaped text, never HTML. Replace direction controls with neutral tokens in inspection so they cannot reorder findings or interface labels. Keep the logical-order table authoritative; isolate character samples from trusted UI labels. Readable output may legitimately use RTL layout.
- Use app semantic color, typography, spacing and radius tokens, with styles scoped to the module. Markers must use labels/shapes as well as color. Support keyboard navigation, visible focus, screen-reader names, paginated table controls and an announced result summary without announcing every character on each update.
- Preserve readability in light/dark themes, narrow windows and enlarged text. Use ordinary paste shortcuts; do not capture unrelated global shortcuts. Finding selection must move focus predictably and expose the matching source location.

## Implementation ownership

`src/tools/text-inspector/` owns the manifest, workspace, scoped styles, pure scanner/cleaner, tests and user-facing README. `src/tools/index.ts` registers the tool. The workspace uses `ToolPage`, `SplitPane`, `ToolPanel`, `copyText` and `exportText` through `src/core/sdk.ts`. Its retained provider holds source, rules and synchronous analysis together across navigation; it never persists source. Copy/save temporarily lock source/rule changes until the output operation finishes.

Keep Unicode classification, rule policy, source mapping and inspection rendering inside the module. Use existing native export/clipboard capabilities where they satisfy the behavior above; verify their handling before adding any native change. No shared-core refactor, sibling-tool import or new backend is inherent in this design.

## Acceptance checks

| Case | Required result |
| --- | --- |
| `hello\u200Bworld`, with an actual ZWSP | Revealed and preserved initially; removed only with its rule enabled. |
| `a\r\nb\nc\rd` | All newline kinds distinguished; exact retained sequence under Preserve; deterministic LF/CRLF conversion. |
| NBSP, narrow NBSP, tabs and repeated spaces | Accurate markers; optional `Zs` conversion keeps multiplicity and tabs. |
| Chinese, Persian ZWNJ text and an emoji ZWJ sequence | Preserved under Mixed text, with constituent code points inspectable. |
| Decomposed `e` + combining acute and composed `é` | Remain distinct; no implicit normalization. |
| Bidi override/isolate controls around a filename | Visible logical positions; no reordering of trusted finding labels; selected removal rescans output. |
| Literal `\u200B`, HTML-like input and marker-like input | Remain literal text; no escape decoding, HTML execution or marker ambiguity. |
| NUL, ESC, DEL, NEL, TAB and all recognized line endings | Default removes only specified non-text controls and preserves the exceptions. |
| Multiple leading BOMs, BOM/control/BOM prefix, interior BOM | Prefix definition and rule ordering hold; second cleaning is unchanged. |
| Empty input, all-removable input and unpaired surrogates | Distinct states; no crash, false success or lossy output. |
| Exactly 100,000 units and one unit over | Full scan at the boundary; visible rejection above it, with previous work retained. |
| New paste/rule change during analysis, paginated findings | No stale copy/export; full counts and output independent of visible page. |
| Clipboard denial, save cancellation and export failure | Clear feedback; source and selected rules remain available. |
| Native Windows paste/copy/save with mixed line endings | Establish actual API normalization behavior; exported UTF-8 bytes match the derived valid output. |
| Keyboard, screen reader, light/dark and enlarged text | Accessible marker details and navigation without reliance on color. |

Read [testing guidance](../test/README.md) before implementation checks. Add focused scanner/cleaner tests and browser interaction coverage; run relevant repository checks after implementation. Native checks apply if native code changes.

### Verification on 2026-11-09

- `npm run check`: 324 tests passed, including 23 scanner/cleaner tests with all 768 rule combinations checked for idempotence and replayable source edits.
- Browser checks: 38 passed (7 Text inspector flows and 31 core integration checks). Covered captured CRLF, multilingual copy, exact UTF-8 download bytes, source retention, limits, invalid surrogates, literal markup, direction controls, clipboard failure, occurrence navigation and non-text paste rejection.
- `npm run build` passed. Light at 100% and dark at 175% were visually inspected, including the stacked layout with no tool overflow.
- Native code is unchanged. Native Windows clipboard round trips, native save-dialog interaction and screen-reader testing remain unverified; the existing Rust writer was inspected and writes the supplied UTF-8 bytes directly.

## MVP boundaries

This tool reveals characters and applies chosen text transformations. It does not establish origin/intent, detect every confusable or homograph, judge natural-language instructions, or certify absence of injection. File import, rich-text inspection, history, bulk processing, general editing, ASCII-only conversion, NFC/NFKC normalization and automatic language-aware rewriting are outside the MVP.
