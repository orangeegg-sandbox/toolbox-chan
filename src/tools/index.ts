import type { ToolDefinition } from "../core/sdk";
import { agentPetTool } from "./agent-pet";
import { agentTodoTool } from "./agent-todo";
import { ocrTool } from "./ocr";

// Register another module here; the core discovers its navigation and surfaces.
export const tools: readonly ToolDefinition[] = [ocrTool, agentTodoTool, agentPetTool];
