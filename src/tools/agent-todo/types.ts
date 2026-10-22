import type { AgentId } from "../../core/sdk";

/** `step`: a plan step still unfinished when a turn ended. `for-you`: something the agent asked the user to do. */
export type ItemKind = "step" | "for-you";

export interface TodoItem {
  id: string;
  agent: AgentId;
  /** The chat's working folder; empty when unknown. */
  project: string;
  chatTitle: string;
  text: string;
  kind: ItemKind;
  foundAt: number;
  sessionId: string;
  removedAt?: number;
}

export interface TodoSource {
  agent: AgentId;
  folder: string;
  found: boolean;
}

export interface TodoSnapshot {
  items: TodoItem[];
  /** Newest removal first. */
  history: TodoItem[];
  /** When the tool was first turned on; older chat activity is ignored. */
  enabledAt: number | null;
  paused: boolean;
  lastScanAt: number | null;
  error?: string | null;
  sources: TodoSource[];
}

export interface RuleFile {
  agent: AgentId;
  path: string;
  /** The agent's own folder exists, so the file may be created. */
  folderFound: boolean;
  exists: boolean;
  present: boolean;
}

export const AGENT_LABELS: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  deepseek: "DSH",
};

/** Keep in step with `LINE` in `src-tauri/src/tools/agent-todo/instructions.rs`. */
export const RULE_LINE = "When you leave a follow-up for the user, write it on its own line as `TODO(user): ...`";
