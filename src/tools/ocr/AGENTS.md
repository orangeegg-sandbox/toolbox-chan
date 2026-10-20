# OCR module

- Own OCR UI, state, engine services, preferences, history, asset preparation, and tests. `index.ts` contributes the tool surfaces; `OcrProvider.tsx` coordinates state and actions.
- Compose the workspace with core `ToolPage` slots and layout primitives. Scope OCR styles to `.ocr-tool`.
- Keep offline recognition local: prepare bundled runtime and language assets through `scripts/prepare-assets.mjs`; avoid runtime CDN dependencies.
- Send images to an online provider only after an explicit recognition action. Keep API keys in memory, outside saved preferences, history, and logs.
- Attach paste and keyboard handlers only while OCR is active. Clean up listeners, object URLs, workers, and pending requests through their lifecycle owners.
- Preserve existing storage keys and record compatibility. Keep OCR behavior tests in this module's `tests/`.
