import type { ToolDefinition } from "../core/sdk";
import { ocrTool } from "./ocr";

// Register another module here; the core discovers its navigation and surfaces.
export const tools: readonly ToolDefinition[] = [ocrTool];
