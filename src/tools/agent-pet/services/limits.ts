import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentId } from "../../../core/sdk";

// Limit resets are found by native code (`src-tauri/src/tools/agent-pet/limits/`),
// which reads the agents' own usage records and sends `notice: "limit-reset"`
// pet events. Claude Code gives its reset times only to its status line, so
// Toolbox-Chan can wrap the status line the user already has.

export interface StatusLine {
  path: string;
  /** `installed`, `outdated` (points at another copy), `missing`, or `error`. */
  state: "installed" | "outdated" | "missing" | "error";
  /** The user's own status line command that Toolbox-Chan runs inside its wrapper. */
  wrapped?: string;
  backup?: string;
  error?: string;
}

export interface LimitSource {
  agent: AgentId;
  /** What is read, such as "Codex session files". */
  name: string;
  path: string;
  found: boolean;
  /** When the source last reported usage, in Unix milliseconds. */
  seenAt?: number;
}

export interface LimitsReport {
  statusLine: StatusLine;
  sources: LimitSource[];
}

export function limitsAvailable() {
  return isTauri();
}

export function readLimits() {
  return invoke<LimitsReport>("agent_pet_limits");
}

export function installStatusLine() {
  return invoke<LimitsReport>("agent_pet_install_status_line");
}

export function removeStatusLine() {
  return invoke<LimitsReport>("agent_pet_remove_status_line");
}
