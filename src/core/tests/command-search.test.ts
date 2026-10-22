import { describe, expect, it } from "vitest";
import { searchCommands, type SearchableCommand } from "../commands/search";

const commands: SearchableCommand[] = [
  { id: "tool:ocr", name: "Image to text", description: "Extract editable words from pictures", keywords: ["scan"], kind: "tool" },
  { id: "ocr.extract", name: "OCR: Extract text", kind: "action" },
  { id: "settings", name: "Settings", description: "Appearance and shortcuts", kind: "navigation" },
];
describe("command search", () => {
  it("ranks an exact tool ID before its actions and matches names, aliases and descriptions", () => {
    expect(searchCommands(commands, "OCR")[0].id).toBe("tool:ocr");
    expect(searchCommands(commands, "scan")[0].id).toBe("tool:ocr");
    expect(searchCommands(commands, "editable pictures")[0].id).toBe("tool:ocr");
    expect(searchCommands(commands, "imtt")[0].id).toBe("tool:ocr");
    expect(searchCommands(commands, "no-such-command")).toEqual([]);
    expect(searchCommands(commands, "counter")).toEqual([]);
  });
  it("supports action-only queries and ignores whitespace", () => {
    expect(searchCommands(commands, "  > OCR ").map((entry) => entry.id)).toEqual(["ocr.extract"]);
    expect(searchCommands(commands, "  ")).toEqual(commands);
    expect(searchCommands([], "")).toEqual([]);
  });
});
