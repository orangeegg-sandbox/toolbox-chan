import { ClipboardPaste, Copy, Download, ImagePlus, ScanLine, Settings2, Square } from "lucide-react";
import { ToolCommandHandler, type ToolCommandDefinition } from "../../core/sdk";
import type { useOcr } from "./OcrProvider";

type OcrAction = "open" | "paste" | "extract" | "copy" | "export" | "cancel" | "settings";

export type OcrCommandState = Pick<ReturnType<typeof useOcr>,
  "busy" | "loadingImage" | "source" | "engine" | "text" | "openTool" |
  "pasteImage" | "extract" | "copy" | "download" | "cancel" |
  "openOcrSettings" | "setSettingsOpen"
> & { openImage: () => void };

const ready = (state: OcrCommandState) => !state.busy && !state.loadingImage;
const hasText = (state: OcrCommandState) => !!state.text.trim() && !state.busy;

/** OCR owns its command vocabulary, availability rules, and action mapping. */
export class OcrCommandHandler extends ToolCommandHandler<OcrCommandState, OcrAction> {
  protected readonly definitions: readonly ToolCommandDefinition<OcrCommandState, OcrAction>[] = [
    {
      id: "ocr.open", name: "OCR: Open an image", action: "open", icon: ImagePlus,
      description: (state) => ready(state) ? "Choose an image to extract text from" : "Wait for the current image to finish",
      keywords: ["image", "file", "browse"], enabled: ready,
    },
    {
      id: "ocr.paste", name: "OCR: Paste an image", action: "paste", icon: ClipboardPaste,
      description: "Read an image from your clipboard", keywords: ["clipboard"], enabled: ready,
    },
    {
      id: "ocr.extract", name: "OCR: Extract text", action: "extract", icon: ScanLine,
      description: (state) => !state.source ? "Open or paste an image first"
        : state.engine === "online" ? "Send your image to your configured online provider"
          : "Recognize the current image on your device",
      keywords: ["recognize", "scan", "run"], enabled: (state) => ready(state) && !!state.source,
    },
    {
      id: "ocr.copy", name: "OCR: Copy extracted text", action: "copy", icon: Copy,
      description: (state) => state.text.trim() ? "Copy your text to the clipboard" : "Extract or enter some text first",
      keywords: ["clipboard", "result"], enabled: hasText,
    },
    {
      id: "ocr.export", name: "OCR: Export text", action: "export", icon: Download,
      description: (state) => state.text.trim() ? "Save your text to a file" : "Extract or enter some text first",
      keywords: ["save", "download"], enabled: hasText,
    },
    {
      id: "ocr.cancel", name: "OCR: Cancel recognition", action: "cancel", icon: Square,
      description: (state) => state.busy ? "Stop the current recognition" : "No recognition is running",
      keywords: ["stop"], enabled: (state) => state.busy,
    },
    {
      id: "ocr.settings", name: "OCR: Open settings", action: "settings", icon: Settings2,
      description: "Recognition, online provider, and privacy preferences on the OCR page",
      keywords: ["configure", "language", "layout", "provider", "ocr settings"],
    },
  ];

  protected readonly actions: Record<OcrAction, (state: OcrCommandState) => void | Promise<void>> = {
    open: (state) => state.openImage(),
    paste: (state) => state.pasteImage(),
    extract: (state) => {
      state.setSettingsOpen(false);
      state.openTool("ocr");
      return state.extract();
    },
    copy: (state) => state.copy(),
    export: (state) => state.download(),
    cancel: (state) => state.cancel(),
    settings: (state) => state.openOcrSettings(),
  };
}
