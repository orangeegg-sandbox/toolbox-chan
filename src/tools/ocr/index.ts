import { lazy } from "react";
import { ScanLine } from "lucide-react";
import type { ToolDefinition } from "../../core/tools/contracts";
import { OcrProvider } from "./OcrProvider";
import { OcrStatus } from "./components/OcrStatus";
import "./ocr.css";

export const ocrTool = {
  id: "ocr",
  name: "Image to text",
  category: "Images & documents",
  description:
    "Extract, edit, and copy text from any image. All on your device.",
  subtitle: "Goodbye retyping. Hello, editable text.",
  badge: "OCR",
  icon: ScanLine,
  Provider: OcrProvider,
  Workspace: lazy(() => import("./components/OcrWorkspace")),
  Settings: lazy(() => import("./components/OcrSettings")),
  Activity: lazy(() => import("./components/OcrActivity")),
  Status: OcrStatus,
  shortcuts: [
    { label: "Open an image", keys: ["Mod", "O"] },
    { label: "Paste an image", keys: ["Mod", "V"] },
    { label: "Extract text", keys: ["Mod", "Enter"] },
    { label: "Copy extracted text", keys: ["Mod", "Shift", "C"] },
  ],
} satisfies ToolDefinition;
