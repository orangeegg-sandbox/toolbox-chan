import {
  AGENT_IDS, type AgentId, type PetBadgeEntry, type PetEmote, type PetEvent,
} from "../../../core/sdk";

// What the pets know, built only from pet events. Events say what happened;
// `petView` turns that into what one pet should show. Pure functions, so the
// rules are tested without a window.

export interface SessionState {
  /** The chat is running a turn. */
  working: boolean;
  /** The chat finished; stays until the pet is clicked. */
  done: boolean;
  /** The chat asked a question; clears on its next status or a click. */
  needsYou: boolean;
  updatedAt: number;
}

export interface AgentState {
  /** Keyed by session ID; events without one share the "" session. */
  sessions: Record<string, SessionState>;
  /** The latest note from any event addressed to this pet. */
  note?: string;
  /** Increases with every emote request, so the window plays each one once. */
  emote?: { name: PetEmote; serial: number };
  /** The last time anything happened to this pet, for waking it up. */
  activeAt: number;
}

export interface PetBook {
  agents: Record<AgentId, AgentState>;
  /** Latest badge per agent and source; an entry without an agent shows on every pet. */
  badges: PetBadgeEntry[];
}

/** A working chat that sends nothing for this long is assumed to have stopped without saying so. */
export const STALE_WORKING_MS = 90 * 60_000;
/** Quiet sessions with nothing to show are forgotten after this long. */
export const FORGET_MS = 10 * 60_000;

export type Mood = "done" | "needs-you" | "working" | "idle";

export interface PetView {
  mood: Mood;
  done: boolean;
  needsYou: boolean;
  /** Chats of this agent running at once (working or waiting for you). */
  count: number;
  note?: string;
  badges: PetBadgeEntry[];
}

export function createBook(now: number, badges: PetBadgeEntry[] = []): PetBook {
  return {
    agents: Object.fromEntries(AGENT_IDS.map((agent) => [agent, { sessions: {}, activeAt: now }])) as Record<AgentId, AgentState>,
    badges: badges.map((entry) => structuredClone(entry)),
  };
}

function applyToAgent(state: AgentState, event: PetEvent, now: number): AgentState {
  const next: AgentState = { ...state, sessions: { ...state.sessions }, activeAt: now };
  if (event.status) {
    const key = event.sessionId ?? "";
    const previous = next.sessions[key] ?? { working: false, done: false, needsYou: false, updatedAt: now };
    // Any new status from a chat answers its earlier question.
    const session: SessionState = { ...previous, needsYou: false, updatedAt: now };
    if (event.status === "working") session.working = true;
    if (event.status === "done") Object.assign(session, { working: false, done: true });
    if (event.status === "needs-you") session.needsYou = true;
    if (event.status === "idle") session.working = false;
    next.sessions[key] = session;
  }
  if (event.note) next.note = event.note;
  if (event.emote) next.emote = { name: event.emote, serial: (state.emote?.serial ?? 0) + 1 };
  return next;
}

function badgeKey(entry: { agent?: AgentId; source: string }) {
  return `${entry.agent ?? "*"}\u0000${entry.source}`;
}

/** Applies one event. An event without an agent reaches every pet. */
export function applyPetEvent(book: PetBook, event: PetEvent, now: number): PetBook {
  const agents = { ...book.agents };
  for (const agent of event.agent ? [event.agent] : AGENT_IDS) agents[agent] = applyToAgent(agents[agent], event, now);
  let badges = book.badges;
  if (event.badge !== undefined) {
    const key = badgeKey(event);
    badges = badges.filter((entry) => badgeKey(entry) !== key);
    if (event.badge) badges = [...badges, { ...(event.agent && { agent: event.agent }), source: event.source, badge: event.badge }];
  }
  return { agents, badges };
}

/** A click clears the pet's done and needs-you notices. `cleared` is false for a calm pet. */
export function clickPet(book: PetBook, agent: AgentId, now: number): { book: PetBook; cleared: boolean } {
  const state = book.agents[agent];
  const noticed = Object.values(state.sessions).some((session) => session.done || session.needsYou);
  const sessions = Object.fromEntries(Object.entries(state.sessions).map(([key, session]) => [
    key, noticed ? { ...session, done: false, needsYou: false } : session,
  ]));
  return {
    book: { ...book, agents: { ...book.agents, [agent]: { ...state, sessions, activeAt: now } } },
    cleared: noticed,
  };
}

/** Ends working chats that went silent and forgets quiet ones. Returns the same book when nothing changed. */
export function expireSessions(book: PetBook, now: number): PetBook {
  let changed = false;
  const agents = { ...book.agents };
  for (const agent of AGENT_IDS) {
    const sessions: Record<string, SessionState> = {};
    for (const [key, session] of Object.entries(agents[agent].sessions)) {
      const age = now - session.updatedAt;
      if (session.working && age >= STALE_WORKING_MS) {
        sessions[key] = { ...session, working: false };
        changed = true;
      } else if (!session.working && !session.done && !session.needsYou && age >= FORGET_MS) {
        changed = true;
      } else {
        sessions[key] = session;
      }
    }
    agents[agent] = { ...agents[agent], sessions };
  }
  return changed ? { ...book, agents } : book;
}

export function petView(book: PetBook, agent: AgentId): PetView {
  const state = book.agents[agent];
  const sessions = Object.values(state.sessions);
  const done = sessions.some((session) => session.done);
  const needsYou = sessions.some((session) => session.needsYou);
  const working = sessions.some((session) => session.working);
  return {
    // Done wins over working; a question shows as a bubble whatever the mood.
    mood: done ? "done" : needsYou ? "needs-you" : working ? "working" : "idle",
    done,
    needsYou,
    count: sessions.filter((session) => session.working || session.needsYou).length,
    note: state.note,
    badges: book.badges.filter((entry) => (entry.agent === undefined || entry.agent === agent) && entry.badge.count > 0),
  };
}
