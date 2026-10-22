import type { ToolCommandMetadata } from "./types";

/** A tool maps searchable commands to its own named actions and live state. */
export interface ToolCommandDefinition<TState, TAction extends string = string>
  extends Omit<ToolCommandMetadata, "description" | "disabled"> {
  description?: string | ((state: TState) => string);
  action: TAction;
  enabled?: (state: TState) => boolean;
}

/** Shared dispatch contract; subclasses own command definitions and action logic. */
export abstract class ToolCommandHandler<TState, TAction extends string = string> {
  protected abstract readonly definitions: readonly ToolCommandDefinition<TState, TAction>[];
  protected abstract readonly actions: Record<TAction, (state: TState) => void | Promise<void>>;

  getCommands(state: TState): readonly ToolCommandMetadata[] {
    return [...this.indexDefinitions().values()].map((definition) => {
      const { action: _action, enabled, description, ...metadata } = definition;
      return {
        ...metadata,
        description: typeof description === "function" ? description(state) : description,
        disabled: enabled ? !enabled(state) : undefined,
      };
    });
  }

  execute(commandId: string, state: TState): void | Promise<void> {
    const definition = this.indexDefinitions().get(commandId);
    if (!definition) throw new Error(`Unknown tool command: "${commandId}".`);
    if (definition.enabled && !definition.enabled(state)) {
      throw new Error(`Tool command "${commandId}" is disabled.`);
    }
    return this.actions[definition.action](state);
  }

  private indexDefinitions(): Map<string, ToolCommandDefinition<TState, TAction>> {
    const commands = new Map<string, ToolCommandDefinition<TState, TAction>>();
    for (const definition of this.definitions) {
      if (commands.has(definition.id)) {
        throw new Error(`Duplicate tool command id: "${definition.id}".`);
      }
      commands.set(definition.id, definition);
    }
    return commands;
  }
}
