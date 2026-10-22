import { lazy, Suspense } from "react";
import { FloatingCommandPalette } from "./core/components/FloatingCommandPalette";
import { parseToolWindowHash, type ToolWindowAddress } from "./core/windows/toolWindow";

// Every window shares this entry. Loading the toolbox and its tools lazily keeps
// tool modules out of the floating palette, which only renders core UI.
const Toolbox = lazy(async () => {
  const [{ ToolboxApp }, { tools }] = await Promise.all([import("./core/ToolboxApp"), import("./tools")]);
  return { default: () => <ToolboxApp tools={tools} /> };
});

// A tool's own window renders only that tool's window surface.
const ToolWindow = lazy(async () => {
  const [{ ToolWindowApp }, { tools }] = await Promise.all([import("./core/ToolWindowApp"), import("./tools")]);
  return { default: (address: ToolWindowAddress) => <ToolWindowApp tools={tools} {...address} /> };
});

export default function App() {
  if (window.location.hash === "#command-palette") return <FloatingCommandPalette />;
  const toolWindow = parseToolWindowHash(window.location.hash);
  if (toolWindow) return <Suspense><ToolWindow {...toolWindow} /></Suspense>;
  return <Suspense><Toolbox /></Suspense>;
}
