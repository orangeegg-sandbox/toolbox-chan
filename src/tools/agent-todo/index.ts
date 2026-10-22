import { lazy } from "react";
import { ListTodo } from "lucide-react";
import type { ToolDefinition } from "../../core/sdk";
import { AgentTodoProvider } from "./AgentTodoProvider";
import { TOOL_ID } from "./utils";
import "./agent-todo.css";

export const agentTodoTool = {
  id: TOOL_ID,
  name: "Agent TODO",
  category: "Developer",
  description: "Collect unfinished plan steps and follow-ups from Claude Code, Codex, and DSH chats.",
  subtitle: "What your coding agents left for you.",
  icon: ListTodo,
  keywords: ["todo", "agents", "claude", "codex", "dsh", "deepseek", "follow-up", "reminder", "plan"],
  Provider: AgentTodoProvider,
  Workspace: lazy(() => import("./components/AgentTodoWorkspace")),
} satisfies ToolDefinition;
