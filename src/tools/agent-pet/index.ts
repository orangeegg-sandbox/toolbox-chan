import { lazy } from "react";
import { PawPrint } from "lucide-react";
import type { ToolDefinition } from "../../core/sdk";
import "./agent-pet.css";

export const agentPetTool = {
  id: "agent-pet",
  name: "Agent pets",
  category: "Agents",
  description: "Desktop pets that show when Claude Code, Codex, or DSH is working, done, or needs you.",
  subtitle: "Pets on your taskbar that follow your coding agents.",
  icon: PawPrint,
  keywords: ["pet", "desktop pet", "claude", "codex", "deepseek", "dsh", "hooks", "agents", "notifications"],
  Workspace: lazy(() => import("./components/AgentPetWorkspace")),
  // The pets live in their own transparent window, opened by the native side.
  windows: [{ id: "pets", Surface: lazy(() => import("./window/PetWindow")) }],
} satisfies ToolDefinition;
