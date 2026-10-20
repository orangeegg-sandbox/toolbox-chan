import {
  Box,
  CircleHelp,
  History,
  LayoutGrid,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useToolbox } from "../ToolboxContext";

export function Sidebar({
  onSearch,
  onHelp,
}: {
  onSearch: () => void;
  onHelp: () => void;
}) {
  const { tools, route, navigate, openTool, modifier } = useToolbox();
  return (
    <aside className="sidebar">
      <button
        className="brand"
        onClick={() => navigate({ page: "tools" })}
        aria-label="Little Toolbox home"
      >
        <span className="brand-icon">
          <Box size={23} strokeWidth={1.8} />
        </span>
        <span>
          little<span className="brand-light">toolbox</span>
          <small>Small tools. More possibilities.</small>
        </span>
      </button>
      <button className="search-button" onClick={onSearch}>
        <Search size={16} />
        <span>Find a tool…</span>
        <kbd>{modifier} K</kbd>
      </button>
      <nav aria-label="Main navigation">
        <button
          className={`nav-item ${route.page === "tools" ? "active" : ""}`}
          onClick={() => navigate({ page: "tools" })}
        >
          <LayoutGrid size={18} />
          All tools
          <span className="nav-count">
            {String(tools.length).padStart(2, "0")}
          </span>
        </button>
        <button
          className={`nav-item ${route.page === "history" ? "active" : ""}`}
          onClick={() => navigate({ page: "history" })}
        >
          <History size={18} />
          Recent activity
        </button>
        <div className="nav-label">YOUR TOOLS</div>
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`nav-item tool-nav ${route.page === "tool" && route.toolId === tool.id ? "active" : ""}`}
            onClick={() => openTool(tool.id)}
          >
            <tool.icon size={18} />
            {tool.name}
            <span className="active-dot" />
          </button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="little-note">
        <span className="note-spark">
          <Sparkles size={18} />
        </span>
        <h3>A little less busywork.</h3>
        <p>
          A little more time for
          <br />
          what matters.
        </p>
        <span className="note-line" />
      </div>
      <div className="sidebar-bottom">
        <button
          className={`nav-item ${route.page === "settings" ? "active" : ""}`}
          onClick={() => navigate({ page: "settings" })}
        >
          <Settings2 size={18} />
          Settings
        </button>
        <button className="nav-item" onClick={onHelp}>
          <CircleHelp size={18} />
          Help & shortcuts
        </button>
        <div className="sidebar-version">
          <span className="tiny-logo">
            <Box size={12} />
          </span>
          <span>Made for your everyday.</span>
          <span>v0.1</span>
        </div>
      </div>
    </aside>
  );
}
