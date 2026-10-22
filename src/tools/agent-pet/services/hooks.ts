import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentId } from "../../../core/sdk";

// The hook installer lives in native code (`src-tauri/src/tools/agent-pet/hooks/`),
// which edits only the agents' own config files and backs each one up first.

export interface HookEvent {
  /** The agent's hook event, such as `Stop`. */
  name: string;
  /** The pet status it reports. */
  status: string;
  installed: boolean;
  /** Installed and pointing at this copy of Toolbox-Chan. */
  current: boolean;
  /** Codex only: whether Codex has a review record for the hook. */
  reviewed?: boolean;
}

export interface AgentHooks {
  agent: AgentId;
  method: "hooks" | "watcher";
  path: string;
  state: "installed" | "outdated" | "partial" | "missing" | "error";
  events: HookEvent[];
  backup?: string;
  error?: string;
}

export interface HooksReport {
  executable: string;
  development: boolean;
  agents: AgentHooks[];
}

export function hooksAvailable() {
  return isTauri();
}

export function readHooks() {
  return invoke<HooksReport>("agent_pet_hooks");
}

export function installHooks(agent: AgentId) {
  return invoke<HooksReport>("agent_pet_install_hooks", { agent });
}

export function removeHooks(agent: AgentId) {
  return invoke<HooksReport>("agent_pet_remove_hooks", { agent });
}
