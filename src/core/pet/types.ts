// The pet event API contract. Events say what happened; the pet chooses how to
// move. Keep these rules in step with `src-tauri/src/platform/pet_events.rs`,
// which validates every event in the desktop app.

export const AGENT_IDS = ["claude", "codex", "deepseek"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const PET_STATUSES = ["working", "done", "needs-you", "idle"] as const;
export type PetStatus = (typeof PET_STATUSES)[number];

/** The only direct motion requests; new artwork never breaks callers. */
export const PET_EMOTES = ["happy", "laugh", "surprised", "sleepy"] as const;
export type PetEmote = (typeof PET_EMOTES)[number];

export type PetAction = { type: "open-tool"; toolId: string };

export interface PetBadge {
  count: number;
  /** Run by the core when the badge is clicked; the pet does not know what it opens. */
  action?: PetAction;
}

export interface PetEvent {
  /** Who sent it, such as "hook" or a tool ID. */
  source: string;
  /** Omitted addresses every pet. */
  agent?: AgentId;
  /** Lets the pet count parallel chats of one agent. */
  sessionId?: string;
  status?: PetStatus;
  emote?: PetEmote;
  /** Short text shown when hovering the pet. */
  note?: string;
  /** Replaces this source's badge for the agent; `null` clears it. */
  badge?: PetBadge | null;
}

export interface PetBadgeEntry {
  agent?: AgentId;
  source: string;
  badge: PetBadge;
}

export interface PetDoorStatus {
  url: string;
  listening: boolean;
  error?: string;
}

export interface PetState {
  visible: boolean;
  badges: PetBadgeEntry[];
  door: PetDoorStatus;
}

const LIMITS = { source: 64, sessionId: 200, note: 200, toolId: 64, count: 9999 };
const EVENT_KEYS = new Set(["source", "agent", "sessionId", "status", "emote", "note", "badge"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textError(name: string, value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value.trim()) return `The pet event ${name} must not be empty.`;
  if ([...value].length > max) return `The pet event ${name} must be at most ${max} characters.`;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return `The pet event ${name} must not contain control characters.`;
  return null;
}

/** Returns why a value is not a valid pet event, or null when it is. */
export function petEventError(value: unknown): string | null {
  if (!isRecord(value)) return "A pet event must be an object.";
  const unknown = Object.keys(value).find((key) => !EVENT_KEYS.has(key));
  if (unknown) return `A pet event has no field named “${unknown}”.`;
  const source = textError("source", value.source, LIMITS.source);
  if (source) return source;
  if (value.agent !== undefined && !AGENT_IDS.includes(value.agent as AgentId)) return "The pet event agent is not known.";
  if (value.sessionId !== undefined) {
    const error = textError("sessionId", value.sessionId, LIMITS.sessionId);
    if (error) return error;
  }
  if (value.status !== undefined && !PET_STATUSES.includes(value.status as PetStatus)) return "The pet event status is not known.";
  if (value.emote !== undefined && !PET_EMOTES.includes(value.emote as PetEmote)) return "The pet event emote is not known.";
  if (value.note !== undefined) {
    const error = textError("note", value.note, LIMITS.note);
    if (error) return error;
  }
  if (value.badge !== undefined && value.badge !== null) {
    const badge = value.badge;
    if (!isRecord(badge) || Object.keys(badge).some((key) => key !== "count" && key !== "action")) return "The pet event badge is malformed.";
    if (typeof badge.count !== "number" || !Number.isInteger(badge.count) || badge.count < 0 || badge.count > LIMITS.count)
      return `The pet event badge count must be a whole number from 0 to ${LIMITS.count}.`;
    if (badge.action !== undefined) {
      const action = badge.action;
      if (!isRecord(action) || action.type !== "open-tool" || Object.keys(action).some((key) => key !== "type" && key !== "toolId"))
        return "The pet event badge action is not known.";
      const error = textError("badge action toolId", action.toolId, LIMITS.toolId);
      if (error) return error;
    }
  }
  if (value.status === undefined && value.emote === undefined && value.note === undefined && value.badge === undefined)
    return "A pet event needs a status, emote, note, or badge.";
  return null;
}
