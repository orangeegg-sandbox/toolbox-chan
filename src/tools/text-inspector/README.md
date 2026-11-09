# Text inspector

Reveal hidden characters and line endings in pasted text, then copy or save a cleaned version. Processing stays on your device. Text is held in memory for the current app session and is not added to history.

## Use

1. Focus **Paste text to inspect** and paste with your normal paste shortcut (`Ctrl+V` on Windows, `⌘V` on macOS). Each paste replaces the current source.
2. Read **Marked text** or switch to **All characters** for the stored code-point order, Unicode values, locations, and proposed actions. Select a marker or finding to inspect it; occurrence buttons locate repeats.
3. Choose cleaning rules and review **Cleaned text**. **Show formatting** reveals the output's remaining hidden characters. Counts cover the entire input, including pages not currently displayed.
4. Use **Copy cleaned text** or **Save .txt** to output plain text without marker labels. **Clear text** removes the session copy. Navigating to another tool retains the session until it is cleared or the app exits.

## Cleaning choices

The mixed-text defaults remove non-text controls and a leading BOM. Tabs, line endings, Chinese, other languages, emoji joiners, accents, variation selectors, and emoji tags are preserved.

Zero-width space, word joiner, interior BOM, soft hyphen, and direction-control removal are separate optional choices. Unusual horizontal spaces can become ordinary spaces. Line endings can stay unchanged or become LF/CRLF. These choices never change the source. Hidden formatting and direction controls can serve legitimate purposes; removing them may change layout or meaning.

No text is trimmed, tab-expanded, normalized to NFC/NFKC, or restricted to ASCII. Settings are session-only. The tool adds no global keyboard shortcuts.

## Limits and exact output

- Up to **100,000 UTF-16 code units** per paste. Larger input is rejected without truncating or replacing previous work. An emoji can use several code points and UTF-16 units.
- Input is captured directly from the paste event before textarea normalization. The clipboard source or operating system may already have changed line endings. Copying or pasting the result may normalize them again; clipboard round trips are not byte-preservation guarantees.
- Export uses the shared UTF-8 text writer without adding a BOM or converting line endings: native `std::fs::write`, or a browser `Blob` download. A BOM deliberately retained in the output remains part of that output. Native Windows clipboard behavior requires validation on the installed host.
- Unpaired surrogates remain inspectable, but copy/save is blocked to prevent silent replacement. A nonempty source that cleans to an empty string can be copied or saved as empty text.
- Readable output preserves emoji sequences and neutralizes direction/non-text controls for display. Marked views may separate the components of an emoji. **All characters** is the authoritative logical-order view.
- Character categories use the host JavaScript runtime's Unicode data. The tool supplies familiar names for common controls and a category/code-point fallback for other characters; it does not bundle a complete Unicode name database.
- A finding identifies a character, not its origin or intent. The tool cannot certify that text is injection-free or detect every visually similar substitution.

## Development

The provider keeps source, rules, and their synchronous analysis together. The scanner/cleaner and Unicode classification stay inside this module; core layout and output helpers come only through `core/sdk`. UI pagination does not limit scanning. Read the [feature specification](../../../docs/specs/text-inspector.md) and [testing guidance](../../../docs/test/README.md) for invariants and verification.
