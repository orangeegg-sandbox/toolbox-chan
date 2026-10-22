import { describe, expect, it, vi } from "vitest";
import { Calculator } from "lucide-react";
import { ToolCommandHandler, type ToolCommandDefinition } from "../commands/ToolCommandHandler";
import { assertToolCommandIds, mergeToolCommands } from "../commands/CommandProvider";

interface CounterState {
  count: number;
  enabled: boolean;
  increment: () => void;
  save: () => Promise<void>;
}
type CounterAction = "increment" | "save";

class CounterCommandHandler extends ToolCommandHandler<CounterState, CounterAction> {
  protected readonly definitions: readonly ToolCommandDefinition<CounterState, CounterAction>[] = [
    {
      id: "counter.add",
      name: "Add to counter",
      description: (state) => `Current value: ${state.count}`,
      keywords: ["plus", "increment"],
      icon: Calculator,
      action: "increment",
      enabled: (state) => state.enabled,
    },
    { id: "counter.persist", name: "Save counter", description: "Save the current value", action: "save" },
  ];
  protected readonly actions: Record<CounterAction, (state: CounterState) => void | Promise<void>> = {
    increment: (state) => state.increment(),
    save: (state) => state.save(),
  };
}

function createState(overrides: Partial<CounterState> = {}): CounterState {
  return { count: 0, enabled: true, increment: vi.fn(), save: vi.fn().mockResolvedValue(undefined), ...overrides };
}

describe("tool command handlers", () => {
  it("publishes metadata while keeping action names and callbacks inside the tool", () => {
    const commands = new CounterCommandHandler().getCommands(createState({ count: 3 }));
    expect(commands).toEqual([
      {
        id: "counter.add",
        name: "Add to counter",
        description: "Current value: 3",
        keywords: ["plus", "increment"],
        icon: Calculator,
        disabled: false,
      },
      { id: "counter.persist", name: "Save counter", description: "Save the current value", disabled: undefined },
    ]);
    expect(commands.every((command) => !("action" in command) && !("run" in command))).toBe(true);
  });

  it("dispatches command IDs through the named action mapping", () => {
    const state = createState();
    new CounterCommandHandler().execute("counter.add", state);
    expect(state.increment).toHaveBeenCalledOnce();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("returns asynchronous actions so callers can await completion and failures", async () => {
    const handler = new CounterCommandHandler();
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    const state = createState({ save: vi.fn(() => pending) });
    expect(handler.execute("counter.persist", state)).toBe(pending);
    complete();
    await pending;
    const failure = new Error("Save failed");
    await expect(handler.execute("counter.persist", createState({ save: () => Promise.reject(failure) }))).rejects.toBe(failure);
  });

  it("rechecks live eligibility at dispatch even when previously shown as available", () => {
    const handler = new CounterCommandHandler();
    const state = createState();
    expect(handler.getCommands(state)[0].disabled).toBe(false);
    const busyState = { ...state, enabled: false };
    expect(handler.getCommands(busyState)[0].disabled).toBe(true);
    expect(() => handler.execute("counter.add", busyState)).toThrow('Tool command "counter.add" is disabled.');
    expect(state.increment).not.toHaveBeenCalled();
    handler.execute("counter.add", state);
    expect(state.increment).toHaveBeenCalledOnce();
  });

  it("rejects unknown commands without dispatching an action", () => {
    const state = createState();
    expect(() => new CounterCommandHandler().execute("missing", state)).toThrow('Unknown tool command: "missing".');
    expect(state.increment).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("rejects duplicate command IDs before publication or dispatch", () => {
    class InvalidHandler extends CounterCommandHandler {
      protected readonly definitions: readonly ToolCommandDefinition<CounterState, CounterAction>[] = [
        { id: "same", name: "First action", action: "increment" },
        { id: "same", name: "Second action", action: "save" },
      ];
    }
    const handler = new InvalidHandler();
    const state = createState();
    expect(() => handler.getCommands(state)).toThrow('Duplicate tool command id: "same".');
    expect(() => handler.execute("same", state)).toThrow('Duplicate tool command id: "same".');
    expect(state.increment).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("requires command IDs under the owning tool's namespace", () => {
    expect(() => assertToolCommandIds("counter", ["counter.add", "counter.persist"])).not.toThrow();
    for (const id of ["add", "counter", "counter.", "counters.add", "settings", "help", "tool:counter"]) {
      expect(() => assertToolCommandIds("counter", [id])).toThrow(`Tool command "${id}" must start with "counter.".`);
    }
  });

  it("rejects the same command ID from two registrations", () => {
    const command = { id: "counter.add", name: "Add to counter", run: vi.fn() };
    expect(mergeToolCommands([[command], [{ ...command, id: "counter.persist" }]])).toHaveLength(2);
    expect(() => mergeToolCommands([[command], [command]])).toThrow('Duplicate tool command id: "counter.add".');
  });
});
