# Image to text (OCR)

[← Toolbox-Chan](../../../README.md)

Extract editable English and Chinese text from images. Recognition runs offline by default, with an optional online vision provider you configure yourself.

## Read an image

1. Choose, drop, or paste an image. Supported formats are PNG, JPEG, WebP, BMP, and GIF; GIFs are treated as a single image. Inputs can be up to 25 MB and 32 megapixels.
2. Select **English**, **English + Traditional Chinese**, **English + Simplified Chinese**, or all three languages.
3. Choose a mode and press **Extract text**.
4. Review and edit the result, then copy it or export it as UTF-8 text.

| Mode | How to use it |
| --- | --- |
| **Simple** | Recognize the entire image. |
| **Overlay** | Recognize the image, then drag across words on the image and copy the selection. Word positions are approximate. This mode uses the offline engine. |
| **Custom** | Draw up to 12 rectangular regions. They are recognized in selection order. **Undo** removes the last highlight; **Select all** creates a keyboard-accessible whole-image region. |

Rotation turns the image clockwise and clears selections and results. The original file is never modified.

## Compare the image and text

Images open at their actual pixel size: **100%** means one source-image pixel per CSS pixel. Use **Fit image**, **Actual size (100%)**, or the 10–400% zoom selector to adjust the view. Scroll, enable **Pan image**, or drag with the middle mouse button to inspect a larger image. Switch to **Draw regions** when adding Custom regions.

**Expand comparison** gives both panels more room while preserving zoom, scroll, and selection. Press Escape or **Restore** to return to the normal workspace.

Custom regions show their reading-order numbers. Select a number in either panel to compare that image area with its editable extracted text. Editing a region updates the combined result. Editing **All text** removes the per-region text mapping; copy and export always use the combined text.

Toolbox **Settings** also provides appearance and font-size preferences. Increasing text size preserves the image's pixel scale and region coordinates.

## Settings and recognition quality

Open **OCR settings** on the Image to text page for recognition language, text layout, automatic copying, the online provider, and local history. **Back to workspace** returns to your image and result without losing edits or zoom. Global Toolbox **Settings** contains appearance, text size, and palette preferences only.

Choose the languages that match the image. For difficult documents, crop to the text and try **Scattered text** or **Single text block** in **OCR settings**. Printed text works best; handwriting, columns, tables, and unusual typography can require correction.

Images longer than 3400 pixels on their longest side are downscaled for recognition, and small images are upscaled. The preview still lets you inspect the source image. Check the extracted text against the image before using it.

## Optional online OCR

In **OCR settings** on the Image to text page, enter an OpenAI-compatible **Chat Completions** API base URL (for example, `https://api.openai.com/v1`), a vision model ID supported by your provider, and your own API key. Local providers can use `http://localhost:PORT/v1` without a key if they support it. Then select **Online · Vision API** in the OCR tool. The **Configure** link opens these same local settings.

The action becomes **Upload & extract text**. An image is sent only when you trigger recognition:

- **Simple** sends the prepared image.
- **Custom** sends only the selected crops, with one request per region.
- **Overlay** uses offline OCR because online responses do not provide reliable word positions.

Provider fees and data policies apply. The provider is instructed to transcribe the image in its original language rather than translate it. Check for omissions or invented text, as with any vision model.

The endpoint, model, and API key live only in application memory and must be entered again after restarting. They are never written to saved preferences or history. Remote endpoints must use HTTPS; the native client rejects redirects. The desktop app sends requests through its native host to avoid browser CORS restrictions; browser preview requires a provider that permits CORS. Cancellation aborts the app's request, but a provider may already have started processing it.

## Privacy and history

Offline OCR includes its worker, WebAssembly engines, and language models inside the app. It needs no first-run downloads, external fonts, analytics, account, or OCR service. The operating system's webview is a platform prerequisite; a Windows installer may install WebView2 if it is missing.

History stores the last 20 original OCR text results and filenames in local application storage. Images and API credentials are never saved. Result-editor changes apply to the current session. Turn off **Keep recent activity** to clear saved history and stop saving new results.

Clearing history removes the app's local records; exports you saved separately remain on disk. Browser preview and the desktop app have separate local storage.

## Shortcuts

Use Ctrl on Windows/Linux and Command on macOS.

| Action | Shortcut |
| --- | --- |
| Open image | Ctrl/Command + O |
| Paste image | Ctrl/Command + V |
| Extract text | Ctrl/Command + Enter |
| Copy the entire result | Ctrl/Command + Shift + C |
| Restore expanded comparison | Escape |
| Command palette | Ctrl + Shift twice, or Ctrl/Command + K in app |

Open the command palette and type **ocr**, then press **Enter** to open Image to text. Search **OCR:** to find actions for opening or pasting an image, extracting text, copying, exporting, canceling recognition, and opening OCR settings. **OCR: Open settings** goes directly to OCR's own settings view. Unavailable actions explain what is needed. Extracting with the online engine sends your image to your configured provider, just like the workspace button. Change the palette shortcut in global **Settings → Command palette**; see the [command palette guide](../../../docs/usage/README.md#command-palette) for platform support.

## Development notes

See the [development guide](../../../docs/development.md) for setup, builds, and checks, and the [architecture and module guide](../../../docs/architecture.md) for the core contract and layout rules.

- `index.ts` exports `ocrTool`, the manifest registered in `src/tools/index.ts`. Workspace and activity surfaces load lazily; `OcrProvider.tsx` owns OCR state, actions, and the local settings view state. `OcrWorkspace` owns the settings UI.
- `OcrCommandHandler.ts` extends the reusable `ToolCommandHandler` class and maps command IDs to named OCR actions with live availability. `OcrCommands.tsx` registers this handler against the current OCR controller and owns its image chooser. Core contains no OCR action mapping.
- `components/OcrWorkspace.tsx` fills core `ToolPage` slots using `SplitPane`. Input, output, and image interaction live in `OcrInputPanel.tsx`, `OcrOutputPanel.tsx`, and `ImageWorkspace.tsx`.
- `services/` owns engine, provider, image, and image-clipboard code. `storage.ts` preserves the original release's local-storage keys. OCR styles are scoped to `.ocr-tool` in `ocr.css`.
- Regions and selectable overlays use normalized source-image coordinates, independent of zoom, workspace size, and font size. Copy/export use the combined text even when a region is selected.
- `scripts/prepare-assets.mjs` copies installed models and runtime files into `public/tools/ocr/`. The root preparation hook runs it before development/build. A worker stays warm between actions and releases its memory after 60 seconds of inactivity. See [third-party notices](../../../THIRD_PARTY_NOTICES.md).
- OCR imports core only through `src/core/sdk.ts`, and its palette command IDs start with `ocr.`.
- Native provider requests and cancellation live in [online.rs](../../../src-tauri/src/tools/ocr/online.rs); their window permissions, with clipboard image read, are in [ocr.json](../../../src-tauri/capabilities/ocr.json). Text export is shared infrastructure under `src-tauri/src/platform/` and `src/core/platform/`.
- `tests/` contains OCR unit and browser integration tests, including its palette commands and behavior under appearance changes.
