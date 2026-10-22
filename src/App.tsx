import { lazy, Suspense } from "react";
import { FloatingCommandPalette } from "./core/components/FloatingCommandPalette";

// Both windows share this entry. Loading the toolbox and its tools lazily keeps
// tool modules out of the floating palette, which only renders core UI.
const Toolbox = lazy(async () => {
  const [{ ToolboxApp }, { tools }] = await Promise.all([import("./core/ToolboxApp"), import("./tools")]);
  return { default: () => <ToolboxApp tools={tools} /> };
});

export default function App() {
  if (window.location.hash === "#command-palette") return <FloatingCommandPalette />;
  return <Suspense><Toolbox /></Suspense>;
}
