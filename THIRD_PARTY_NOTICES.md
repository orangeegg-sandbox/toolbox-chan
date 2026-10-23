# Third-party OCR assets

The desktop app includes Tesseract.js, Tesseract.js-core (a WebAssembly build of Tesseract), and English, Simplified Chinese, and Traditional Chinese trained data from `@tesseract.js-data/*`. The OCR runtimes and upstream model repository use Apache-2.0. Its license text is included under `tools/ocr/` in the built app. The language npm packages declare MIT for their packaging; their JavaScript wrappers are not included in the desktop bundle.

- Tesseract.js: https://github.com/naptha/tesseract.js
- Tesseract.js-core: https://github.com/naptha/tesseract.js-core
- Language data: https://github.com/naptha/tessdata
- Tesseract OCR: https://github.com/tesseract-ocr/tesseract

The language npm packages do not contain a standalone LICENSE file; the standard Apache-2.0 license distributed with Tesseract.js-core is bundled for each model. Dependency licenses remain in their respective installed packages. The build records SHA-256 hashes and sizes for bundled OCR assets in `tools/ocr/manifest.json`.

# Agent pet character art

The desktop pets in `src/tools/agent-pet/` are chibi versions of fan character art, used with credit for a personal, non-commercial project. **Non-commercial use only:** the character designs belong to their artists. Do not sell, redistribute for profit, or use these characters or the derived pet sprites in any commercial product. Ask the artists directly for any other use. The derived sprites carry the same restriction.

| Pet | Agent | Original artist |
| --- | --- | --- |
| Claude-Chan | Claude Code | Ninon |
| Codex-Chan | OpenAI GPT / Codex | ZipZipPipe |
| DeepSeek-Chan | DeepSeek Harness (DSH) | ZipZipPipe (the reference sheet also carries the watermark @amemily2050) |

The reference sheets and full credits are in `docs/design/agent-pets/`.
