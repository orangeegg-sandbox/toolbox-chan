import { useMemo } from "react";
import { History, Keyboard, LayoutGrid, Settings2 } from "lucide-react";
import { useToolbox } from "../ToolboxContext";
import { useCommands } from "./CommandProvider";
import type { PaletteCommand } from "./types";

export function usePaletteCommands(onHelp: () => void): PaletteCommand[] {
  const { tools, navigate } = useToolbox();
  const { commands: contributed } = useCommands();
  return useMemo(() => [
    ...tools.map((tool) => ({
      id: `tool:${tool.id}`, name: tool.name, description: tool.description,
      keywords: [tool.id, tool.category, tool.badge ?? "", ...(tool.keywords ?? [])],
      icon: tool.icon, kind: "tool" as const,
      run: () => navigate({ page: "tool", toolId: tool.id }),
    })),
    { id: "tools", name: "All tools", description: "Browse your toolbox", keywords: ["home", "library"], icon: LayoutGrid, kind: "navigation" as const, run: () => navigate({ page: "tools" }) },
    { id: "history", name: "Recent activity", description: "Pick up where you left off", keywords: ["history", "recent"], icon: History, kind: "navigation" as const, run: () => navigate({ page: "history" }) },
    { id: "settings", name: "Settings", description: "Appearance, shortcuts, and global preferences", keywords: ["preferences", "shortcut", "keyboard", "global"], icon: Settings2, kind: "navigation" as const, run: () => navigate({ page: "settings" }) },
    { id: "help", name: "Help & shortcuts", description: "See your keyboard shortcuts", keywords: ["help", "keyboard"], icon: Keyboard, kind: "action" as const, run: onHelp },
    ...contributed.map((command) => ({ ...command, kind: "action" as const })),
  ], [tools, navigate, contributed, onHelp]);
}
