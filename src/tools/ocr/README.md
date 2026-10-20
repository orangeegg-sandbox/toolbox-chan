# Image to text module

`index.ts` exports `ocrTool`, the module manifest consumed by `src/tools/index.ts`. Its workspace, settings, and activity surfaces are loaded lazily. `OcrProvider` owns OCR state and actions; the core shell only sees the common `ToolDefinition` contract.

- `components/OcrWorkspace.tsx` fills the core `ToolPage` slots and composes two panels using `SplitPane`.
- `components/OcrInputPanel.tsx` owns image selection and OCR options.
- `components/OcrOutputPanel.tsx` owns progress, editable results, copy, and export actions.
- `components/ImageWorkspace.tsx` owns zoom, selectable word overlays, and highlighted regions.
- `services/` contains engine, provider, image, and image-clipboard code.
- `storage.ts` retains the original release's local-storage keys for compatibility; those records belong exclusively to OCR.
- `ocr.css` is scoped to `.ocr-tool`; shared controls and page layout come from core.
- `scripts/prepare-assets.mjs` copies installed models/runtime files to `public/tools/ocr/`. The root `prepare-tools` script runs it automatically before dev/build.
- `tests/` holds OCR unit and browser integration tests.

The preview opens at actual size: 100% is one source image pixel per CSS pixel. Fit adapts to the viewport; preset zooms reach 400%. Scroll or enable the hand tool (middle-button dragging also works) to inspect any part of the image. Expand comparison keeps both panels visible and preserves zoom, scroll, and region selection; Escape restores the workspace.

Custom regions have visible reading-order numbers. Select a number in either panel to compare that crop with its editable result. Region edits update the combined text; editing All text removes the per-region text mapping. Copy and export always include the combined text. Regions and selectable overlays stay normalized to the source image, independent of zoom, workspace size, and the app's text-size preference.

Native provider HTTP/cancellation logic is under `src-tauri/src/tools/ocr/online.rs`. Text export is shared infrastructure under `src-tauri/src/platform/` and `src/core/platform/`.

See [the module and layout guide](../../../docs/architecture.md) for the core contract and instructions for adding another tool.
