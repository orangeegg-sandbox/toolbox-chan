import {
  CircleHelp,
  History,
  LayoutGrid,
  Search,
  Settings2,
} from "lucide-react";
import { useToolbox } from "../ToolboxContext";
import { usePaletteShortcut } from "../commands/ShortcutProvider";
import toolboxChanHead from "../assets/toolbox-chan-head.png";
import toolboxChanPeek from "../assets/toolbox-chan-peek-side.png";

export function Sidebar({
  onSearch,
  onHelp,
}: {
  onSearch: () => void;
  onHelp: () => void;
}) {
  const { tools, route, navigate, openTool } = useToolbox();
  const { shortcutLabel } = usePaletteShortcut();
  return (
    <aside className="sidebar">
      <button
        className="brand"
        onClick={() => navigate({ page: "tools" })}
        aria-label="Toolbox-Chan home"
      >
        <span className="brand-icon">
          <img src={toolboxChanHead} alt="" width="32" height="32" />
        </span>
        <span>Toolbox-Chan</span>
      </button>
      <button className="search-button" onClick={onSearch} title={`Command palette · ${shortcutLabel}`}>
        <Search size={15} />
        <span>Search…</span>
        <kbd>{shortcutLabel}</kbd>
      </button>
      <nav aria-label="Main navigation">
        <button
          className={`nav-item ${route.page === "tools" ? "active" : ""}`}
          onClick={() => navigate({ page: "tools" })}
        >
          <LayoutGrid size={16} />
          All tools
          <span className="nav-count">
            {String(tools.length).padStart(2, "0")}
          </span>
        </button>
        <button
          className={`nav-item ${route.page === "history" ? "active" : ""}`}
          onClick={() => navigate({ page: "history" })}
        >
          <History size={16} />
          Recent activity
        </button>
        <div className="nav-label">Tools</div>
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`nav-item tool-nav ${route.page === "tool" && route.toolId === tool.id ? "active" : ""}`}
            onClick={() => openTool(tool.id)}
          >
            <tool.icon size={16} />
            {tool.name}
          </button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-bottom">
        <button
          className={`nav-item ${route.page === "settings" ? "active" : ""}`}
          onClick={() => navigate({ page: "settings" })}
        >
          <Settings2 size={16} />
          Settings
        </button>
        <button className="nav-item" onClick={onHelp}>
          <CircleHelp size={16} />
          Help & shortcuts
        </button>
        <div className="sidebar-version">
          <img className="sidebar-peek" src={toolboxChanPeek} alt="" />
          v0.1
        </div>
      </div>
    </aside>
  );
}
