import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleAlert, History, Info, ListTodo, RefreshCw, Settings2, ShieldCheck } from "lucide-react";
import { AGENT_IDS, EmptyState, ToolPage, ToolPanel, type ToolSurfaceProps } from "../../../core/sdk";
import { useAgentTodo } from "../AgentTodoProvider";
import { AGENT_LABELS } from "../types";
import { filterItems, projectOptions, shortTime, type AgentFilter } from "../utils";
import AgentTodoSettings from "./AgentTodoSettings";
import { TodoList } from "./TodoList";

type View = "open" | "history";

export default function AgentTodoWorkspace({ tool }: ToolSurfaceProps) {
  const { desktop, snapshot, scanning, scanNow, remove, restore, clearHistory } = useAgentTodo();
  const [view, setView] = useState<View>("open");
  const [agent, setAgent] = useState<AgentFilter>("all");
  const [project, setProject] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const cancelClear = useRef<HTMLButtonElement>(null);
  const items = snapshot?.items ?? [];
  const history = snapshot?.history ?? [];
  const projects = projectOptions([...items, ...history]);
  const shown = view === "open"
    ? filterItems(items, agent, project).sort((a, b) => b.foundAt - a.foundAt)
    : filterItems(history, agent, project);
  const filtered = agent !== "all" || !!project;

  useEffect(() => {
    if (confirmClear) cancelClear.current?.focus();
  }, [confirmClear]);
  useEffect(() => {
    if (!history.length) setConfirmClear(false);
  }, [history.length]);
  useEffect(() => {
    if (settingsOpen) document.getElementById("todo-settings-panel")?.focus({ preventScroll: true });
  }, [settingsOpen]);

  const closeSettings = () => {
    setSettingsOpen(false);
    settingsButton.current?.focus({ preventScroll: true });
  };
  const changeView = (next: View) => {
    setView(next);
    setConfirmClear(false);
  };

  return (
    <ToolPage
      tool={tool}
      className="agent-todo-tool"
      toolbar={
        <div className="todo-toolbar">
          <div className="todo-tabs" role="tablist" aria-label="List">
            {(["open", "history"] as const).map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={view === name && !settingsOpen}
                className={view === name && !settingsOpen ? "selected" : ""}
                onClick={() => {
                  changeView(name);
                  setSettingsOpen(false);
                }}
              >
                {name === "open" ? <ListTodo size={15} /> : <History size={15} />}
                {name === "open" ? "Open" : "History"}
                <span className="todo-count">{name === "open" ? items.length : history.length}</span>
              </button>
            ))}
          </div>
          <div className="todo-toolbar-actions">
            <div className="todo-filter">
              <span>Agent</span>
              <div className="select-wrap compact">
                <select aria-label="Filter by agent" value={agent} onChange={(event) => setAgent(event.target.value as AgentFilter)}>
                  <option value="all">All agents</option>
                  {AGENT_IDS.map((id) => <option key={id} value={id}>{AGENT_LABELS[id]}</option>)}
                </select>
                <ChevronDown size={13} />
              </div>
            </div>
            <div className="todo-filter">
              <span>Project</span>
              <div className="select-wrap compact">
                <select aria-label="Filter by project" title={project || undefined} value={project} onChange={(event) => setProject(event.target.value)}>
                  <option value="">All projects</option>
                  {projects.map((option) => <option key={option.path} value={option.path} title={option.path}>{option.name}</option>)}
                </select>
                <ChevronDown size={13} />
              </div>
            </div>
            <button
              className="button secondary"
              disabled={!desktop || scanning}
              title={desktop ? "Read new chat activity now" : "Reading chats needs the desktop app"}
              onClick={() => void scanNow()}
            >
              <RefreshCw size={15} className={scanning ? "todo-spin" : undefined} />
              Scan now
            </button>
            <button
              ref={settingsButton}
              className={`button secondary ${settingsOpen ? "selected" : ""}`}
              aria-expanded={settingsOpen}
              aria-controls="todo-settings-panel"
              onClick={() => (settingsOpen ? closeSettings() : setSettingsOpen(true))}
            >
              <Settings2 size={15} />
              TODO settings
            </button>
          </div>
        </div>
      }
      description={
        <p className="todo-description">
          Plan steps your agents left unfinished, and things they asked you to do. Remove an item when it is done.
        </p>
      }
      footer={
        <div className="todo-footer">
          <span>
            <ShieldCheck size={14} />
            Chats are read on this device. Nothing is sent to the agents.
          </span>
          {snapshot?.enabledAt && <span>Watching chats since {shortTime(snapshot.enabledAt)}</span>}
        </div>
      }
    >
      {!desktop && (
        <div className="info-banner">
          <Info size={15} />
          Reading agent chats needs the desktop app. This preview shows a saved list only.
        </div>
      )}
      {desktop && snapshot?.paused && (
        <div className="info-banner">
          <Info size={15} />
          Watching agent chats is paused. Turn it back on in TODO settings.
        </div>
      )}
      {snapshot?.error && (
        <div className="error-banner" role="status">
          <CircleAlert size={15} />
          <span>A chat file could not be read: {snapshot.error}</span>
        </div>
      )}
      {settingsOpen ? (
        <AgentTodoSettings onClose={closeSettings} />
      ) : (
        <ToolPanel
          title={view === "open" ? "Open items" : "History"}
          status={<span className="small-tag">{shown.length}</span>}
          actions={view === "history" && history.length > 0 && !confirmClear && (
            <button className="button secondary" onClick={() => setConfirmClear(true)}>
              Clear history
            </button>
          )}
        >
          {confirmClear && (
            <div
              className="todo-confirm"
              role="alertdialog"
              aria-labelledby="todo-confirm-text"
              onKeyDown={(event) => {
                if (event.key === "Escape") setConfirmClear(false);
              }}
            >
              <p id="todo-confirm-text">
                Clear all {history.length} {history.length === 1 ? "item" : "items"} from History? They cannot be restored.
              </p>
              <div className="todo-confirm-actions">
                <button ref={cancelClear} className="button secondary" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
                <button
                  className="button secondary todo-danger"
                  onClick={() => {
                    setConfirmClear(false);
                    void clearHistory();
                  }}
                >
                  Clear history
                </button>
              </div>
            </div>
          )}
          {!snapshot ? (
            <EmptyState title="Loading the list" icon={ListTodo} />
          ) : shown.length ? (
            <TodoList
              items={shown}
              history={view === "history"}
              onRemove={(id) => void remove([id])}
              onRestore={(id) => void restore([id])}
            />
          ) : filtered ? (
            <EmptyState title="Nothing matches these filters" icon={ListTodo}>
              Choose all agents and all projects to see every item.
            </EmptyState>
          ) : view === "open" ? (
            <EmptyState title="No open items" icon={ListTodo}>
              Unfinished plan steps and follow-ups from new agent chats appear here.
            </EmptyState>
          ) : (
            <EmptyState title="History is empty" icon={History}>
              Removed items appear here and can be restored.
            </EmptyState>
          )}
        </ToolPanel>
      )}
    </ToolPage>
  );
}
