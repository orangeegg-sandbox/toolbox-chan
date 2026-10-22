import type { LucideIcon } from "lucide-react";

/** A provider-aware action contributed by a tool. Keep action logic in the tool. */
export interface ToolCommand {
  id: string;
  name: string;
  description?: string;
  keywords?: readonly string[];
  icon?: LucideIcon;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

export type ToolCommandMetadata = Omit<ToolCommand, "run">;

export type PaletteCommandKind = "tool" | "navigation" | "action";
export interface PaletteCommand extends ToolCommand {
  kind: PaletteCommandKind;
}

/** Only serializable display metadata crosses the native window boundary. */
export interface PaletteCommandMetadata {
  id: string;
  name: string;
  description?: string;
  keywords?: readonly string[];
  kind: PaletteCommandKind;
  disabled?: boolean;
}

export interface PaletteSnapshot {
  commands: PaletteCommandMetadata[];
  shortcutLabel: string;
}
