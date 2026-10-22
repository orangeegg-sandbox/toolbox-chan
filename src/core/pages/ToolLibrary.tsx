import { useToolbox } from "../ToolboxContext";
import { EmptyState } from "../layout";
import { usePaletteShortcut } from "../commands/ShortcutProvider";
import toolboxChan from "../assets/toolbox-chan.png";

export function ToolLibrary() {
  const { tools, openTool } = useToolbox();
  const { shortcutLabel } = usePaletteShortcut();
  return (
    <>
      <div className="library-heading">
        <h1>
          All tools{" "}
          <span className="small-tag">
            {String(tools.length).padStart(2, "0")}
          </span>
        </h1>
        <p className="page-intro">
          Open a tool, or press <kbd>{shortcutLabel}</kbd> to search tools and actions.
        </p>
      </div>
      {tools.length ? (
        <>
          <div className="tool-cards">
            {tools.map((tool) => (
              <button
                className="tool-card"
                key={tool.id}
                onClick={() => openTool(tool.id)}
              >
                <span className="heading-icon">
                  <tool.icon size={18} />
                </span>
                <strong>{tool.name}</strong>
                <span className="tool-card-description">{tool.description}</span>
                <span className="tool-card-meta">{tool.category}</span>
              </button>
            ))}
          </div>
          <img className="idle-mascot" src={toolboxChan} alt="" width="1024" height="1536" />
        </>
      ) : (
        <EmptyState title="No tools installed" mascot>
          Register a tool module in src/tools/index.ts and it appears here.
        </EmptyState>
      )}
    </>
  );
}
