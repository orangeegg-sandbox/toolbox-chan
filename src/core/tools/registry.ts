import type { ToolDefinition } from "./contracts";

export function createToolRegistry(definitions: readonly ToolDefinition[]) {
  const byId = new Map<string, ToolDefinition>();
  for (const tool of definitions) {
    if (!/^[a-z][a-z0-9-]*$/.test(tool.id))
      throw new Error(`Invalid tool id: ${tool.id}`);
    if (byId.has(tool.id)) throw new Error(`Duplicate tool id: ${tool.id}`);
    if (!tool.name.trim()) throw new Error(`Tool ${tool.id} needs a name.`);
    byId.set(tool.id, tool);
  }
  return { tools: [...definitions], get: (id: string) => byId.get(id) };
}
