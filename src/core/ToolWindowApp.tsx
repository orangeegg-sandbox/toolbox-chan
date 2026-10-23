import { Suspense, useLayoutEffect, useMemo } from "react";
import type { ToolDefinition } from "./tools/contracts";
import { createToolRegistry } from "./tools/registry";
import type { ToolWindowAddress } from "./windows/toolWindow";
import { ThemeProvider } from "./appearance/ThemeProvider";
import { FontSizeProvider } from "./appearance/FontSizeProvider";
import "./styles.css";
import "./windows/toolWindow.css";

/**
 * Hosts one tool window surface in its own native window. Only the shared
 * appearance providers wrap it: the toolbox shell, tool providers, and other
 * tools' surfaces live in the main window.
 */
export function ToolWindowApp({ tools, toolId, windowId }: { tools: readonly ToolDefinition[] } & ToolWindowAddress) {
  const registry = useMemo(() => createToolRegistry(tools), [tools]);
  const tool = registry.get(toolId);
  const surface = tool?.windows?.find((window) => window.id === windowId);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.surface = "tool-window";
    document.title = tool ? `Toolbox-Chan — ${tool.name}` : "Toolbox-Chan";
    return () => {
      delete root.dataset.surface;
    };
  }, [tool]);
  return (
    <ThemeProvider>
      <FontSizeProvider>
        {tool && surface ? (
          <Suspense>
            <surface.Surface tool={tool} />
          </Suspense>
        ) : (
          <p className="tool-window-missing" role="alert">This window is not available.</p>
        )}
      </FontSizeProvider>
    </ThemeProvider>
  );
}
