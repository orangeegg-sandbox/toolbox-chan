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

/** Things that happened outside any one chat. `limit-reset`: the agent's usage limit started fresh. */
export const PET_NOTICES = ["limit-reset"] as const;
export type PetNotice = (typeof PET_NOTICES)[number];

/** Links an action may open: the agents' own apps. */
export const PET_LINK_SCHEMES = ["claude", "codex"] as const;

export type PetAction =
  | { type: "open-tool"; toolId: string }
  /** Opens a chat in an agent's app, for example `codex://threads/<id>`. */
  | { type: "open-link"; url: string };

/** What the pet says in a chat bubble. Clicking the bubble runs the action. */
export interface PetMessage {
  text: string;
  action?: PetAction;
}

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
  /** Something the pet should say, such as "Add pet is ready". */
  message?: PetMessage;
  notice?: PetNotice;
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

const LIMITS = { source: 64, sessionId: 200, note: 200, message: 200, toolId: 64, url: 300, count: 9999 };
const EVENT_KEYS = new Set(["source", "agent", "sessionId", "status", "emote", "note", "badge", "message", "notice"]);
const LINK = new RegExp(`^(${PET_LINK_SCHEMES.join("|")})://[A-Za-z0-9._~/%?=&#:@+-]*$`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textError(name: string, value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value.trim()) return `The pet event ${name} must not be empty.`;
  if ([...value].length > max) return `The pet event ${name} must be at most ${max} characters.`;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return `The pet event ${name} must not contain control characters.`;
  return null;
}

function actionError(action: unknown, name: string): string | null {
  if (!isRecord(action)) return `The pet event ${name} is not known.`;
  const keys = Object.keys(action);
  if (action.type === "open-tool" && keys.every((key) => key === "type" || key === "toolId"))
    return textError(`${name} toolId`, action.toolId, LIMITS.toolId);
  if (action.type === "open-link" && keys.every((key) => key === "type" || key === "url")) {
    const error = textError(`${name} url`, action.url, LIMITS.url);
    if (error) return error;
    return LINK.test(action.url as string) ? null : `The pet event ${name} url must open an agent's app.`;
  }
  return `The pet event ${name} is not known.`;
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
      const error = actionError(badge.action, "badge action");
      if (error) return error;
    }
  }
  if (value.message !== undefined) {
    const message = value.message;
    if (!isRecord(message) || Object.keys(message).some((key) => key !== "text" && key !== "action")) return "The pet event message is malformed.";
    const error = textError("message text", message.text, LIMITS.message)
      ?? (message.action === undefined ? null : actionError(message.action, "message action"));
    if (error) return error;
  }
  if (value.notice !== undefined && !PET_NOTICES.includes(value.notice as PetNotice)) return "The pet event notice is not known.";
  if ([value.status, value.emote, value.note, value.badge, value.message, value.notice].every((field) => field === undefined))
    return "A pet event needs a status, emote, note, badge, message, or notice.";
  return null;
}
