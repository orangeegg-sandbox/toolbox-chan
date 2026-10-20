import { FileText, Highlighter, MousePointer2 } from "lucide-react";
export const modes = [
  {
    id: "simple",
    name: "Simple",
    icon: FileText,
    description: "Read the whole image",
  },
  {
    id: "overlay",
    name: "Overlay",
    icon: MousePointer2,
    description: "Select text on the image",
  },
  {
    id: "custom",
    name: "Custom",
    icon: Highlighter,
    description: "Highlight areas to read",
  },
] as const;
