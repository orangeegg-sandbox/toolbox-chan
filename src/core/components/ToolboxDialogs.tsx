import {
  Keyboard,
  X,
} from "lucide-react";
import { type RefObject } from "react";
import { useToolbox } from "../ToolboxContext";
import type { ToolDefinition } from "../tools/contracts";
import { usePaletteShortcut } from "../commands/ShortcutProvider";

export function ToolboxDialogs({
  help,
  activeTool,
}: {
  help: RefObject<HTMLDialogElement | null>;
  activeTool?: ToolDefinition;
}) {
  const { modifier } = useToolbox();
  const { shortcutLabel } = usePaletteShortcut();
  const shortcuts = [
    ...(activeTool?.shortcuts ?? []),
    { label: "Open command palette", keys: [shortcutLabel] },
    { label: "Open command palette (in app)", keys: ["Mod", "K"] },
    { label: "Close this dialog", keys: ["Esc"] },
  ];
  return (
    <>
      <dialog className="help-dialog" ref={help}>
        <div className="dialog-heading">
          <div>
            <Keyboard size={18} />
            <h2>Keyboard shortcuts</h2>
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
            : "Toolbox shortcuts."}
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
    </>
  );
}
