import {
  ArrowRight,
  History,
  Keyboard,
  LayoutGrid,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { useState, type RefObject } from "react";
import { useToolbox } from "../ToolboxContext";
import type { ToolDefinition, ToolboxRoute } from "../tools/contracts";

export function ToolboxDialogs({
  help,
  palette,
  activeTool,
}: {
  help: RefObject<HTMLDialogElement | null>;
  palette: RefObject<HTMLDialogElement | null>;
  activeTool?: ToolDefinition;
}) {
  const { tools, navigate, modifier } = useToolbox();
  const [search, setSearch] = useState("");
  const commands = [
    ...tools.map((tool) => ({
      id: `tool:${tool.id}`,
      name: tool.name,
      icon: tool.icon,
      route: { page: "tool", toolId: tool.id } as ToolboxRoute,
    })),
    {
      id: "tools",
      name: "All tools",
      icon: LayoutGrid,
      route: { page: "tools" } as ToolboxRoute,
    },
    {
      id: "history",
      name: "Recent activity",
      icon: History,
      route: { page: "history" } as ToolboxRoute,
    },
    {
      id: "settings",
      name: "Settings",
      icon: Settings2,
      route: { page: "settings" } as ToolboxRoute,
    },
  ].filter((command) =>
    command.name.toLowerCase().includes(search.toLowerCase()),
  );
  const shortcuts = [
    ...(activeTool?.shortcuts ?? []),
    { label: "Find a tool", keys: ["Mod", "K"] },
    { label: "Close this dialog", keys: ["Esc"] },
  ];
  return (
    <>
      <dialog className="help-dialog" ref={help}>
        <div className="dialog-heading">
          <div>
            <Keyboard size={21} />
            <h2>A few handy shortcuts</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close help"
            onClick={() => help.current?.close()}
          >
            <X size={19} />
          </button>
        </div>
        <p>
          {activeTool
            ? `${activeTool.name} and toolbox shortcuts.`
            : "Small shortcuts for your everyday workflow."}
        </p>
        <div className="shortcut-list">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.label}>
              <span>{shortcut.label}</span>
              <kbd>
                {shortcut.keys
                  .map((key) => (key === "Mod" ? modifier : key))
                  .join(" ")}
              </kbd>
            </div>
          ))}
        </div>
      </dialog>
      <dialog
        className="command-dialog"
        ref={palette}
        onClose={() => setSearch("")}
      >
        <div className="command-input">
          <Search size={19} />
          <input
            aria-label="Find a tool"
            placeholder="Find a tool or go somewhere…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoFocus
          />
          <button
            className="icon-button"
            aria-label="Close search"
            onClick={() => palette.current?.close()}
          >
            <X size={17} />
          </button>
        </div>
        <div className="command-results">
          {commands.map((command) => (
            <button
              key={command.id}
              onClick={() => {
                navigate(command.route);
                palette.current?.close();
              }}
            >
              <command.icon size={18} />
              <span>{command.name}</span>
              <ArrowRight size={15} />
            </button>
          ))}
          {!commands.length && <p>No tools found. Try another name.</p>}
        </div>
      </dialog>
    </>
  );
}
