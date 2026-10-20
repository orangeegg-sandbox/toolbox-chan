# Third-party OCR assets

The desktop app includes Tesseract.js, Tesseract.js-core (a WebAssembly build of Tesseract), and English, Simplified Chinese, and Traditional Chinese trained data from `@tesseract.js-data/*`. The OCR runtimes and upstream model repository use Apache-2.0. Its license text is included under `tools/ocr/` in the built app. The language npm packages declare MIT for their packaging; their JavaScript wrappers are not included in the desktop bundle.

- Tesseract.js: https://github.com/naptha/tesseract.js
- Tesseract.js-core: https://github.com/naptha/tesseract.js-core
- Language data: https://github.com/naptha/tessdata
- Tesseract OCR: https://github.com/tesseract-ocr/tesseract

The language npm packages do not contain a standalone LICENSE file; the standard Apache-2.0 license distributed with Tesseract.js-core is bundled for each model. Dependency licenses remain in their respective installed packages. The build records SHA-256 hashes and sizes for bundled OCR assets in `tools/ocr/manifest.json`.
