import { describe, expect, it } from "vitest";
import { Box } from "lucide-react";
import { createToolRegistry } from "../tools/registry";
import type { ToolDefinition } from "../tools/contracts";

const tool = (id: string): ToolDefinition => ({
  id,
  name: id,
  description: "A fixture tool",
  category: "Tests",
  icon: Box,
  Workspace: () => null,
});
describe("tool registry", () => {
  it("looks up arbitrary tools and preserves registration order", () => {
    const first = tool("first-tool"),
      second = tool("another-tool");
    const registry = createToolRegistry([first, second]);
    expect(registry.tools).toEqual([first, second]);
    expect(registry.get("another-tool")).toBe(second);
    expect(registry.get("missing")).toBeUndefined();
    expect(createToolRegistry([]).tools).toEqual([]);
  });
  it("rejects duplicate ids, invalid ids, and empty names", () => {
    expect(() => createToolRegistry([tool("same"), tool("same")])).toThrow(
      "Duplicate tool id",
    );
    expect(() => createToolRegistry([tool("Not an id")])).toThrow(
      "Invalid tool id",
    );
    expect(() => createToolRegistry([{ ...tool("valid"), name: " " }])).toThrow(
      "needs a name",
    );
  });
});
