import { AGENT_IDS, type AgentId, type PetEvent } from "../../core/sdk";
import type { TodoItem } from "./types";

export const TOOL_ID = "agent-todo";

export type AgentFilter = AgentId | "all";

/** The folder's own name; the full path is shown on hover. */
export function projectName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? "";
}

/** Projects of the given items, by name, for the project filter. */
export function projectOptions(items: readonly TodoItem[]): { path: string; name: string }[] {
  const paths = [...new Set(items.map((item) => item.project).filter(Boolean))];
  return paths
    .map((path) => ({ path, name: projectName(path) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

export function filterItems(items: readonly TodoItem[], agent: AgentFilter, project: string): TodoItem[] {
  return items.filter((item) => (agent === "all" || item.agent === agent) && (!project || item.project === project));
}

export function openCounts(items: readonly TodoItem[]): Record<AgentId, number> {
  const counts = Object.fromEntries(AGENT_IDS.map((agent) => [agent, 0])) as Record<AgentId, number>;
  for (const item of items) counts[item.agent] += 1;
  return counts;
}

/**
 * Badge events that bring the pets up to date: every agent the first time, then
 * only agents whose open-item count changed. Mirrors `badge_events` in the native
 * scanner, which sends them in the desktop app.
 */
export function badgeEvents(previous: Record<AgentId, number> | null, counts: Record<AgentId, number>): PetEvent[] {
  return AGENT_IDS.filter((agent) => !previous || previous[agent] !== counts[agent]).map((agent) => ({
    source: TOOL_ID,
    agent,
    badge: counts[agent] > 0
      ? { count: Math.min(counts[agent], 9999), action: { type: "open-tool", toolId: TOOL_ID } }
      : null,
  }));
}

const sameDay = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const otherDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "medium" });

/** Time only for today, otherwise date and time. */
export function shortTime(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  return date.toDateString() === new Date(now).toDateString() ? sameDay.format(date) : otherDay.format(date);
}

export function fullTime(ms: number): string {
  return full.format(new Date(ms));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
