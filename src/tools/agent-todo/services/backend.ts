import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AGENT_IDS, notifyPet, type AgentId } from "../../../core/sdk";
import type { RuleFile, TodoItem, TodoSnapshot } from "../types";
import { badgeEvents, openCounts } from "../utils";

/**
 * Where the list lives. In the desktop app a native scanner reads agent chats in
 * the background, saves the list, and sends the pets their badges. The browser
 * preview cannot read files; it keeps a list in local storage so the page works.
 */
export interface TodoBackend {
  readonly desktop: boolean;
  state(): Promise<TodoSnapshot>;
  remove(ids: string[]): Promise<TodoSnapshot>;
  restore(ids: string[]): Promise<TodoSnapshot>;
  clearHistory(): Promise<TodoSnapshot>;
  setPaused(paused: boolean): Promise<TodoSnapshot>;
  scanNow(): Promise<TodoSnapshot>;
  rules(): Promise<RuleFile[]>;
  addRule(agent: AgentId): Promise<RuleFile[]>;
  removeRule(agent: AgentId): Promise<RuleFile[]>;
  /** Called when the list or scan status changes outside the page. */
  subscribe(listener: () => void): () => void;
}

export function createBackend(): TodoBackend {
  return isTauri() ? nativeBackend : createPreviewBackend(localStorage);
}

const nativeBackend: TodoBackend = {
  desktop: true,
  state: () => invoke("agent_todo_state"),
  remove: (ids) => invoke("agent_todo_remove", { ids }),
  restore: (ids) => invoke("agent_todo_restore", { ids }),
  clearHistory: () => invoke("agent_todo_clear_history"),
  setPaused: (paused) => invoke("agent_todo_set_paused", { paused }),
  scanNow: () => invoke("agent_todo_scan_now"),
  rules: () => invoke("agent_todo_rules"),
  addRule: (agent) => invoke("agent_todo_add_rule", { agent }),
  removeRule: (agent) => invoke("agent_todo_remove_rule", { agent }),
  subscribe(listener) {
    let disposed = false;
    const subscription = listen("agent-todo-changed", () => {
      if (!disposed) listener();
    });
    void subscription.catch(() => undefined);
    return () => {
      disposed = true;
      void subscription.then((unlisten) => unlisten()).catch(() => undefined);
    };
  },
};

export const PREVIEW_KEY = "toolbox-chan.agent-todo.preview.v1";

interface PreviewData {
  items: TodoItem[];
  history: TodoItem[];
  enabledAt: number;
  paused: boolean;
}

function isItem(value: unknown): value is TodoItem {
  const item = value as TodoItem;
  return typeof item === "object" && item !== null && typeof item.id === "string" && typeof item.text === "string"
    && AGENT_IDS.includes(item.agent) && (item.kind === "step" || item.kind === "for-you")
    && typeof item.project === "string" && typeof item.chatTitle === "string" && Number.isFinite(item.foundAt);
}

function loadPreview(storage: Storage): PreviewData {
  try {
    const value = JSON.parse(storage.getItem(PREVIEW_KEY) ?? "{}");
    return {
      items: Array.isArray(value?.items) ? value.items.filter(isItem) : [],
      history: Array.isArray(value?.history) ? value.history.filter(isItem) : [],
      enabledAt: Number.isFinite(value?.enabledAt) ? value.enabledAt : Date.now(),
      paused: value?.paused === true,
    };
  } catch {
    return { items: [], history: [], enabledAt: Date.now(), paused: false };
  }
}

/** The browser preview's list. It sends badges itself, since there is no native scanner. */
export function createPreviewBackend(storage: Storage): TodoBackend {
  const listeners = new Set<() => void>();
  let published: Record<AgentId, number> | null = null;
  const snapshot = (data: PreviewData): TodoSnapshot => ({
    ...structuredClone(data),
    lastScanAt: null,
    error: null,
    sources: [],
  });
  const read = async () => {
    const data = loadPreview(storage);
    const counts = openCounts(data.items);
    for (const event of badgeEvents(published, counts)) await notifyPet(event);
    published = counts;
    return data;
  };
  const change = async (update: (data: PreviewData) => void) => {
    const data = loadPreview(storage);
    update(data);
    storage.setItem(PREVIEW_KEY, JSON.stringify(data));
    const result = snapshot(await read());
    for (const listener of [...listeners]) listener();
    return result;
  };
  return {
    desktop: false,
    state: async () => snapshot(await read()),
    remove: (ids) => change((data) => {
      const removedAt = Date.now();
      const removed = data.items.filter((item) => ids.includes(item.id)).map((item) => ({ ...item, removedAt }));
      data.items = data.items.filter((item) => !ids.includes(item.id));
      data.history = [...removed.reverse(), ...data.history];
    }),
    restore: (ids) => change((data) => {
      const restored = data.history.filter((item) => ids.includes(item.id)).map(({ removedAt: _, ...item }) => item);
      data.history = data.history.filter((item) => !ids.includes(item.id));
      data.items = [...data.items, ...restored].sort((a, b) => a.foundAt - b.foundAt);
    }),
    clearHistory: () => change((data) => {
      data.history = [];
    }),
    setPaused: (paused) => change((data) => {
      data.paused = paused;
    }),
    scanNow: async () => snapshot(await read()),
    rules: async () => [],
    addRule: async () => {
      throw new Error("Instruction files can be changed in the desktop app only.");
    },
    removeRule: async () => {
      throw new Error("Instruction files can be changed in the desktop app only.");
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
