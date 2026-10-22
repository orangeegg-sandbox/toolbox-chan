import { Check, Folder, ListChecks, MessageSquare, RotateCcw, UserRound } from "lucide-react";
import { AGENT_LABELS, type TodoItem } from "../types";
import { fullTime, projectName, shortTime } from "../utils";

interface TodoListProps {
  items: readonly TodoItem[];
  history?: boolean;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
}

export function TodoList({ items, history = false, onRemove, onRestore }: TodoListProps) {
  return (
    <ul className="todo-list" aria-label={history ? "Removed items" : "Open items"}>
      {items.map((item) => {
        const time = history ? item.removedAt ?? item.foundAt : item.foundAt;
        return (
          <li key={item.id} className="todo-item">
            <div className="todo-item-main">
              <p className="todo-item-text">{item.text}</p>
              <div className="todo-item-meta">
                <span className="small-tag">{AGENT_LABELS[item.agent]}</span>
                <span className="todo-meta-entry">
                  {item.kind === "step" ? <ListChecks size={12} aria-hidden="true" /> : <UserRound size={12} aria-hidden="true" />}
                  {item.kind === "step" ? "Unfinished step" : "For you"}
                </span>
                <span className="todo-meta-entry" title={item.project || undefined}>
                  <Folder size={12} aria-hidden="true" />
                  {projectName(item.project) || "Unknown folder"}
                </span>
                <span className="todo-meta-entry todo-chat" title={item.chatTitle || undefined}>
                  <MessageSquare size={12} aria-hidden="true" />
                  {item.chatTitle || "Untitled chat"}
                </span>
                <time className="todo-meta-entry" dateTime={new Date(time).toISOString()} title={fullTime(time)}>
                  {history ? "Removed " : "Found "}
                  {shortTime(time)}
                </time>
              </div>
            </div>
            {history ? (
              <button className="button secondary" onClick={() => onRestore(item.id)} aria-label={`Restore: ${item.text}`}>
                <RotateCcw size={14} />
                Restore
              </button>
            ) : (
              <button className="button secondary" onClick={() => onRemove(item.id)} aria-label={`Remove: ${item.text}`}>
                <Check size={14} />
                Remove
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
