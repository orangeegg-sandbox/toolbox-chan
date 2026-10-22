import { createContext, useContext } from "react";
import type { ToolDefinition, ToolboxRoute } from "./tools/contracts";

export interface ToolboxServices {
  tools: readonly ToolDefinition[];
  route: ToolboxRoute;
  modifier: string;
  navigate: (route: ToolboxRoute) => void;
  openTool: (id: string) => void;
  /** Opens global app preferences. Tool settings belong inside the tool page. */
  openSettings: () => void;
  notify: (message: string, isError?: boolean) => void;
}

export const ToolboxContext = createContext<ToolboxServices | null>(null);
export function useToolbox() {
  const context = useContext(ToolboxContext);
  if (!context)
    throw new Error("Tool surfaces must be rendered inside ToolboxApp.");
  return context;
}
