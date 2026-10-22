import type { ComponentType, PropsWithChildren } from "react";
import type { LucideIcon } from "lucide-react";

export interface ToolSurfaceProps {
  tool: ToolDefinition;
}
export interface ToolShortcut {
  label: string;
  keys: readonly string[];
}

/** A tool contributes surfaces to the core; it never owns the application shell. */
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  subtitle?: string;
  badge?: string;
  icon: LucideIcon;
  Provider?: ComponentType<PropsWithChildren>;
  Workspace: ComponentType<ToolSurfaceProps>;
  Activity?: ComponentType<ToolSurfaceProps>;
  Status?: ComponentType;
  shortcuts?: readonly ToolShortcut[];
  /** Extra names and terms used by the command palette. The tool ID is always searchable. */
  keywords?: readonly string[];
  /** Registers a tool-owned ToolCommandHandler under its retained Provider. */
  Commands?: ComponentType;
}

export type ToolboxRoute =
  | { page: "tool"; toolId: string }
  | { page: "tools" | "history" | "settings" };
