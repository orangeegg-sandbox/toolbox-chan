import type { ToolDefinition } from "./contracts";

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function createToolRegistry(definitions: readonly ToolDefinition[]) {
  const byId = new Map<string, ToolDefinition>();
  for (const tool of definitions) {
    if (!ID_PATTERN.test(tool.id))
      throw new Error(`Invalid tool id: ${tool.id}`);
    if (byId.has(tool.id)) throw new Error(`Duplicate tool id: ${tool.id}`);
    if (!tool.name.trim()) throw new Error(`Tool ${tool.id} needs a name.`);
    const windows = new Set<string>();
    for (const window of tool.windows ?? []) {
      if (!ID_PATTERN.test(window.id))
        throw new Error(`Invalid window id in ${tool.id}: ${window.id}`);
      if (windows.has(window.id))
        throw new Error(`Duplicate window id in ${tool.id}: ${window.id}`);
      windows.add(window.id);
    }
    byId.set(tool.id, tool);
  }
  return { tools: [...definitions], get: (id: string) => byId.get(id) };
}
