// Tool window addresses. Kept free of React and tool imports so the app entry
// can route on them without loading the toolbox or any tool module.

const PREFIX = "#tool-window/";
const ID = /^[a-z][a-z0-9-]*$/;

export interface ToolWindowAddress {
  toolId: string;
  windowId: string;
}

/** The hash a tool's native code loads for one of its window surfaces. */
export function toolWindowHash({ toolId, windowId }: ToolWindowAddress): string {
  if (!ID.test(toolId) || !ID.test(windowId)) throw new Error("Tool and window IDs must be lowercase IDs.");
  return `${PREFIX}${toolId}/${windowId}`;
}

/** Returns the tool window a page hash names, or null for every other page. */
export function parseToolWindowHash(hash: string): ToolWindowAddress | null {
  if (!hash.startsWith(PREFIX)) return null;
  const parts = hash.slice(PREFIX.length).split("/");
  if (parts.length !== 2 || !ID.test(parts[0]) || !ID.test(parts[1])) return null;
  return { toolId: parts[0], windowId: parts[1] };
}
