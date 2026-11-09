import { lazy } from "react";
import { ScanText } from "lucide-react";
import type { ToolDefinition } from "../../core/sdk";
import { TextInspectorProvider } from "./TextInspectorProvider";
import "./text-inspector.css";

export const textInspectorTool = {
  id: "text-inspector",
  name: "Text inspector",
  category: "Text",
  description: "Reveal hidden characters, inspect line endings, and clean pasted text locally.",
  subtitle: "See every character before you copy clean text.",
  icon: ScanText,
  keywords: ["unicode", "hidden", "invisible", "newline", "zero-width", "bidi", "clean", "text"],
  Provider: TextInspectorProvider,
  Workspace: lazy(() => import("./TextInspectorWorkspace")),
} satisfies ToolDefinition;
