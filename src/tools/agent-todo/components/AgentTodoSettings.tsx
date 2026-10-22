import { useEffect } from "react";
import { ArrowLeft, FileText, Info, Radar, Settings2, ShieldCheck } from "lucide-react";
import { useAgentTodo } from "../AgentTodoProvider";
import { AGENT_LABELS, RULE_LINE, type RuleFile } from "../types";
import { fullTime } from "../utils";

function ruleState(rule: RuleFile): string {
  if (rule.present) return "Line added";
  if (!rule.folderFound) return "Agent not found";
  return rule.exists ? "Not added" : "No file yet; Add creates it";
}

export default function AgentTodoSettings({ onClose }: { onClose: () => void }) {
  const { desktop, snapshot, setPaused, rules, ruleBusy, loadRules, addRule, removeRule } = useAgentTodo();
  useEffect(() => {
    if (desktop) void loadRules();
  }, [desktop, loadRules]);
  return (
    <section id="todo-settings-panel" className="todo-settings" aria-labelledby="todo-settings-heading" tabIndex={-1}>
      <div className="todo-settings-heading">
        <div className="todo-settings-title">
          <Settings2 size={19} />
          <h2 id="todo-settings-heading">Agent TODO settings</h2>
        </div>
        <button className="button secondary" onClick={onClose}>
          <ArrowLeft size={15} />
          Back to list
        </button>
      </div>

      <section className="settings-card">
        <div className="settings-section-heading">
          <Radar size={18} />
          <h2>Watching chats</h2>
        </div>
        <div className="setting-row">
          <div>
            <label htmlFor="todo-watch">Watch agent chats</label>
            <p>Check for new chat activity every few seconds, also while the window is closed to the tray.</p>
          </div>
          <input
            id="todo-watch"
            className="toggle"
            role="switch"
            type="checkbox"
            disabled={!desktop || !snapshot}
            checked={!!snapshot && !snapshot.paused}
            onChange={(event) => void setPaused(!event.target.checked)}
          />
        </div>
        {snapshot?.sources.map((source) => (
          <div className="setting-row" key={source.agent}>
            <div>
              <strong>{AGENT_LABELS[source.agent]}</strong>
              <p className="todo-path" title={source.folder}>{source.folder}</p>
            </div>
            <span className="todo-status">
              {source.found && <span className="green-dot" aria-hidden="true" />}
              {source.found ? "Chats found" : "Not found"}
            </span>
          </div>
        ))}
        <div className="settings-note">
          <Info size={14} />
          {snapshot?.enabledAt
            ? `Only chats active after ${fullTime(snapshot.enabledAt)} are read. Older chats are ignored.`
            : "Only chats active after the tool is first turned on are read."}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-section-heading">
          <FileText size={18} />
          <h2>Fixed-format rule</h2>
        </div>
        <p className="settings-description">
          Adds one line to an agent's global instructions, so it writes follow-ups in a format this list catches exactly:
        </p>
        <pre className="todo-rule-line"><code>{RULE_LINE}</code></pre>
        {!desktop && (
          <div className="setting-row">
            <p>Instruction files can be changed in the desktop app only.</p>
          </div>
        )}
        {rules?.map((rule) => (
          <div className="setting-row" key={rule.agent}>
            <div>
              <strong>{AGENT_LABELS[rule.agent]}</strong>
              <p className="todo-path" title={rule.path}>{rule.path}</p>
            </div>
            <span className="todo-status">
              {rule.present && <span className="green-dot" aria-hidden="true" />}
              {ruleState(rule)}
            </span>
            <button
              className="button secondary"
              disabled={!rule.folderFound || ruleBusy !== null}
              aria-label={`${rule.present ? "Remove the line from" : "Add the line to"} ${AGENT_LABELS[rule.agent]}'s instructions`}
              onClick={() => void (rule.present ? removeRule(rule.agent) : addRule(rule.agent))}
            >
              {rule.present ? "Remove line" : "Add line"}
            </button>
          </div>
        ))}
        <div className="settings-note">
          <ShieldCheck size={14} />
          Before each change, the file is copied to a .agent-todo.bak file next to it. Nothing else in the file changes.
        </div>
      </section>
    </section>
  );
}
