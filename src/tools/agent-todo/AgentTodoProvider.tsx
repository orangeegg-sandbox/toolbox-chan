import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useToolbox, type AgentId } from "../../core/sdk";
import { createBackend, type TodoBackend } from "./services/backend";
import type { RuleFile, TodoSnapshot } from "./types";
import { errorMessage } from "./utils";

function useAgentTodoController(backend: TodoBackend) {
  const { notify } = useToolbox();
  const [snapshot, setSnapshot] = useState<TodoSnapshot | null>(null);
  const [rules, setRules] = useState<RuleFile[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [ruleBusy, setRuleBusy] = useState<AgentId | null>(null);

  const run = useCallback(async (action: () => Promise<TodoSnapshot>) => {
    try {
      setSnapshot(await action());
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }, [notify]);

  useEffect(() => {
    void run(() => backend.state());
    return backend.subscribe(() => void run(() => backend.state()));
  }, [backend, run]);

  const remove = useCallback((ids: string[]) => run(() => backend.remove(ids)), [backend, run]);
  const restore = useCallback((ids: string[]) => run(() => backend.restore(ids)), [backend, run]);
  const clearHistory = useCallback(() => run(() => backend.clearHistory()), [backend, run]);
  const setPaused = useCallback((paused: boolean) => run(() => backend.setPaused(paused)), [backend, run]);
  const scanNow = useCallback(async () => {
    setScanning(true);
    await run(() => backend.scanNow());
    setScanning(false);
  }, [backend, run]);

  const changeRule = useCallback(async (agent: AgentId | null, change: () => Promise<RuleFile[]>) => {
    setRuleBusy(agent);
    try {
      setRules(await change());
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setRuleBusy(null);
    }
  }, [notify]);
  const loadRules = useCallback(() => changeRule(null, () => backend.rules()), [backend, changeRule]);
  const addRule = useCallback((agent: AgentId) => changeRule(agent, () => backend.addRule(agent)), [backend, changeRule]);
  const removeRule = useCallback((agent: AgentId) => changeRule(agent, () => backend.removeRule(agent)), [backend, changeRule]);

  return {
    desktop: backend.desktop, snapshot, scanning, rules, ruleBusy,
    remove, restore, clearHistory, setPaused, scanNow, loadRules, addRule, removeRule,
  };
}

type AgentTodoState = ReturnType<typeof useAgentTodoController>;
const AgentTodoContext = createContext<AgentTodoState | null>(null);

/** Stays mounted for the app's life, so the list is ready when the tool opens. */
export function AgentTodoProvider({ children }: PropsWithChildren) {
  const backend = useMemo(createBackend, []);
  const state = useAgentTodoController(backend);
  return <AgentTodoContext.Provider value={state}>{children}</AgentTodoContext.Provider>;
}

export function useAgentTodo() {
  const context = useContext(AgentTodoContext);
  if (!context) throw new Error("Agent TODO surfaces must be rendered inside AgentTodoProvider.");
  return context;
}
