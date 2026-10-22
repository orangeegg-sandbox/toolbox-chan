import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef,
  useState, type PropsWithChildren,
} from "react";
import type { ToolCommandHandler } from "./ToolCommandHandler";
import type { ToolCommand } from "./types";

export type { ToolCommand } from "./types";

const CommandContext = createContext<{
  commands: readonly ToolCommand[];
  register: (owner: string, commands: readonly ToolCommand[]) => () => void;
} | null>(null);
const ToolScopeContext = createContext<string | null>(null);

/** Core mounts each tool's Commands contribution inside the tool's scope. */
export function ToolCommandScope({ toolId, children }: PropsWithChildren<{ toolId: string }>) {
  return <ToolScopeContext.Provider value={toolId}>{children}</ToolScopeContext.Provider>;
}

/** "<tool id>." keeps tool commands apart from core commands and from other tools. */
export function assertToolCommandIds(toolId: string, ids: readonly string[]) {
  for (const id of ids) {
    if (!id.startsWith(`${toolId}.`) || id.length === toolId.length + 1) {
      throw new Error(`Tool command "${id}" must start with "${toolId}.".`);
    }
  }
}

/** Joins every registered contribution; the palette and native cache need unique IDs. */
export function mergeToolCommands(contributions: readonly (readonly ToolCommand[])[]) {
  const commands = contributions.flat();
  const ids = new Set<string>();
  for (const { id } of commands) {
    if (ids.has(id)) throw new Error(`Duplicate tool command id: "${id}".`);
    ids.add(id);
  }
  return commands;
}

export function CommandProvider({ children }: PropsWithChildren) {
  const [contributions, setContributions] = useState<Record<string, readonly ToolCommand[]>>({});
  const register = useCallback((owner: string, commands: readonly ToolCommand[]) => {
    setContributions((previous) => ({ ...previous, [owner]: commands }));
    return () => setContributions((previous) => {
      const next = { ...previous };
      delete next[owner];
      return next;
    });
  }, []);
  const commands = useMemo(() => mergeToolCommands(Object.values(contributions)), [contributions]);
  const value = useMemo(() => ({ commands, register }), [commands, register]);
  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

export function useCommands() {
  const context = useContext(CommandContext);
  if (!context) throw new Error("Tool commands require CommandProvider.");
  return context;
}

/** Register a tool's handler while dispatching with its latest provider state. */
export function useToolCommands<TState, TAction extends string>(
  handler: ToolCommandHandler<TState, TAction>,
  state: TState,
) {
  const { register } = useCommands();
  const toolId = useContext(ToolScopeContext);
  const owner = useId();
  const latest = useRef({ handler, state });
  latest.current = { handler, state };
  if (!toolId) throw new Error("Register tool commands from the tool's Commands contribution.");
  const commands = handler.getCommands(state);
  assertToolCommandIds(toolId, commands.map(({ id }) => id));
  // Callback changes must not re-register on every provider render. Only
  // visible metadata changes publish a new contribution to the palette.
  const metadata = JSON.stringify(commands.map(({ icon: _icon, ...entry }) => entry));
  const stable = useMemo(() => commands.map((command) => ({
    ...command,
    run: () => latest.current.handler.execute(command.id, latest.current.state),
  })), [metadata, handler]);
  useEffect(() => register(owner, stable), [register, owner, stable]);
}
