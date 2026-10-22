import { ArrowDown, ArrowRight, ArrowUp, CornerDownLeft, LoaderCircle, Search, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToolbox } from "../ToolboxContext";
import { searchCommands } from "../commands/search";
import { usePaletteShortcut } from "../commands/ShortcutProvider";
import type { PaletteCommand } from "../commands/types";
import { usePaletteCommands } from "../commands/usePaletteCommands";
import toolboxChanPeek from "../assets/toolbox-chan-peek-top.png";

// Warm the cache so the peek is ready the first time the palette opens.
if (typeof Image !== "undefined") new Image().src = toolboxChanPeek;

export function CommandPalette({ onClose, onHelp }: { onClose: () => void; onHelp: () => void }) {
  const { notify } = useToolbox();
  const commands = usePaletteCommands(onHelp);
  const { shortcutLabel } = usePaletteShortcut();

  function run(command: PaletteCommand) {
    onClose();
    try {
      Promise.resolve(command.run()).catch(() => notify(`Could not run “${command.name}”. Please try again.`, true));
    } catch {
      notify(`Could not run “${command.name}”. Please try again.`, true);
    }
  }

  return <CommandPaletteView commands={commands} shortcutLabel={shortcutLabel} onRun={run} onClose={onClose} />;
}

interface CommandPaletteViewProps {
  commands: readonly PaletteCommand[];
  shortcutLabel: string;
  onRun: (command: PaletteCommand) => void | Promise<void>;
  onClose: () => void;
  floating?: boolean;
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

/** Shared presentation; floating windows receive metadata, never tool providers. */
export function CommandPaletteView({
  commands, shortcutLabel, onRun, onClose, floating = false,
  loading = false, busy = false, error, onRetry,
}: CommandPaletteViewProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const results = useMemo(() => loading ? [] : searchCommands(commands, query), [commands, query, loading]);
  const index = Math.min(selected, Math.max(0, results.length - 1));
  const current = results[index];

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    const element = dialog.current;
    document.body.style.overflow = "hidden";
    element?.showModal();
    input.current?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
      element?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index, query]);

  function run(command: PaletteCommand | undefined) {
    if (!command || command.disabled || loading || busy) return;
    if (!floating) dialog.current?.close();
    void onRun(command);
  }

  return (
    <dialog
      ref={dialog}
      className={`command-dialog${floating ? " command-dialog-floating" : ""}`}
      aria-label="Command palette"
      aria-busy={loading || busy || undefined}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      {!floating && (
        <span className="command-peek" aria-hidden="true">
          <img src={toolboxChanPeek} alt="" />
        </span>
      )}
      <div className="command-heading">
        <span><Terminal size={13} /> {floating ? "Toolbox-Chan" : "Command palette"}</span>
        <kbd>{shortcutLabel}</kbd>
      </div>
      <div className="command-input">
        <Search size={21} aria-hidden="true" />
        <input
          ref={input}
          role="combobox"
          aria-label="Find a tool"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={current && !busy ? `palette-option-${index}` : undefined}
          aria-describedby="palette-hint"
          placeholder="Search tools and actions…"
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") { event.preventDefault(); run(current); }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              if (!results.length) return;
              setSelected(event.key === "Home" ? 0 : event.key === "End" ? results.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
            }
          }}
        />
        <button className="icon-button" aria-label="Close search" onClick={onClose}><X size={17} /></button>
      </div>
      {error && <div className="command-error" role="alert"><span>{error}</span>{onRetry && <button type="button" onClick={onRetry}>Try again</button>}</div>}
      <div className="command-section-label" aria-hidden="true">
        <span>{query.trim().startsWith(">") ? "Actions" : query.trim() ? "Search results" : "Tools and commands"}</span>
        <span>{loading ? "Connecting…" : busy ? "Opening…" : `${results.length} ${results.length === 1 ? "result" : "results"}`}</span>
      </div>
      <div id="palette-results" className="command-results" role="listbox" aria-label="Commands">
        {results.map((command, resultIndex) => {
          const Icon = command.icon ?? Terminal;
          return (
            <button
              key={command.id}
              id={`palette-option-${resultIndex}`}
              role="option"
              aria-label={command.name}
              aria-describedby={`palette-description-${resultIndex}`}
              aria-selected={index === resultIndex}
              aria-disabled={command.disabled || busy || undefined}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => { if (index !== resultIndex) setSelected(resultIndex); }}
              onClick={() => run(command)}
            >
              <span className={`command-icon command-icon-${command.kind}`}><Icon size={19} /></span>
              <span className="command-copy">
                <strong>{command.name}</strong>
                <small id={`palette-description-${resultIndex}`}>{command.description}</small>
              </span>
              <span className="command-kind">{command.disabled ? "Unavailable" : command.kind === "tool" ? "Tool" : command.kind === "navigation" ? "Go to" : "Action"}</span>
              <ArrowRight className="command-go" size={15} aria-hidden="true" />
            </button>
          );
        })}
        {loading ? <div className="command-empty" role="status"><LoaderCircle className="spin" size={25} /><strong>Loading your toolbox…</strong><p>Your tools and actions will appear here.</p></div> : !results.length && <div className="command-empty"><Search size={25} /><strong>{error && !commands.length ? "Commands unavailable" : "No matching commands"}</strong><p>{error && !commands.length ? "Try connecting to your toolbox again." : "Try a tool name, an action, or a keyword."}</p></div>}
      </div>
      <div className="sr-only" role="status" aria-live="polite">{loading ? "Loading commands" : busy ? "Opening command" : `${results.length} ${results.length === 1 ? "command" : "commands"} available`}</div>
      <footer className="command-footer">
        <span id="palette-hint">Type <kbd>&gt;</kbd> for actions</span>
        <span><kbd><ArrowUp size={11} /><ArrowDown size={11} /></kbd> navigate</span>
        <span><kbd><CornerDownLeft size={12} /></kbd> run</span>
        <span><kbd>esc</kbd> close</span>
      </footer>
    </dialog>
  );
}
