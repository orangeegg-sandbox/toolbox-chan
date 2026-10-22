import { lazy } from "react";
import { ScanLine } from "lucide-react";
import type { ToolDefinition } from "../../core/sdk";
import { OcrProvider } from "./OcrProvider";
import { OcrStatus } from "./components/OcrStatus";
import { OcrCommands } from "./OcrCommands";
import "./ocr.css";

export const ocrTool = {
  id: "ocr",
  name: "Image to text",
  category: "Images & documents",
  description:
    "Extract, edit, and copy text from images. Runs offline by default.",
  subtitle: "Turn images into editable text.",
  badge: "OCR",
  icon: ScanLine,
  keywords: ["ocr", "recognize", "scan", "image", "extract text"],
  Commands: OcrCommands,
  Provider: OcrProvider,
  Workspace: lazy(() => import("./components/OcrWorkspace")),
  Activity: lazy(() => import("./components/OcrActivity")),
  Status: OcrStatus,
  shortcuts: [
    { label: "Open an image", keys: ["Mod", "O"] },
    { label: "Paste an image", keys: ["Mod", "V"] },
    { label: "Extract text", keys: ["Mod", "Enter"] },
    { label: "Copy extracted text", keys: ["Mod", "Shift", "C"] },
  ],
} satisfies ToolDefinition;
