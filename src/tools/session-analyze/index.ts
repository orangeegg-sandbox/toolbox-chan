import { lazy } from "react";
import { ScanSearch } from "lucide-react";
import type { ToolDefinition } from "../../core/sdk";
import { SessionAnalyzeProvider } from "./SessionAnalyzeProvider";
import "./session-analyze.css";

export const sessionAnalyzeTool = {
  id: "session-analyze",
  name: "Session analyze",
  category: "Developer",
  description: "Inspect agent sessions, cost, skills, tool calls, and project file coverage locally.",
  subtitle: "See the evidence behind your agent's work.",
  icon: ScanSearch,
  keywords: ["session", "analyze", "context", "pollution", "cost", "skills", "mcp", "codex", "claude", "dsh", "tower"],
  Provider: SessionAnalyzeProvider,
  Workspace: lazy(() => import("./SessionAnalyzeWorkspace")),
} satisfies ToolDefinition;
