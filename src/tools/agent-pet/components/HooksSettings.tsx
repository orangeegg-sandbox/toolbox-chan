import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Webhook } from "lucide-react";
import { useToolbox, type AgentId } from "../../../core/sdk";
import { PET_BY_AGENT } from "../pets";
import { hooksAvailable, installHooks, readHooks, removeHooks, type AgentHooks, type HooksReport } from "../services/hooks";

const STATE_TEXT: Record<AgentHooks["state"], { text: string; tone: "good" | "warn" | "bad" | "none" }> = {
  installed: { text: "Installed", tone: "good" },
  outdated: { text: "Installed for another copy of Toolbox-Chan", tone: "warn" },
  partial: { text: "Partly installed", tone: "warn" },
  missing: { text: "Not installed", tone: "none" },
  error: { text: "Cannot read the file", tone: "bad" },
};

const NOTES: Record<AgentId, string> = {
  claude: "Start a new Claude Code chat after installing; open chats keep the hooks they started with.",
  codex: "Codex asks you to review new hooks before they run. Its notify line is never changed.",
  deepseek: "DSH has no hooks, so Toolbox-Chan watches its session folder instead. A chat counts as done after 45 seconds without changes, so a long-running step can look finished.",
};

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function HooksSettings() {
  const { notify } = useToolbox();
  const [report, setReport] = useState<HooksReport | null>(null);
  const [busy, setBusy] = useState<AgentId | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = hooksAvailable();

  const refresh = useCallback(async () => {
    setBusy("all");
    try {
      setReport(await readHooks());
      setError(null);
    } catch (reason) {
      setError(`Could not read the agent settings. ${message(reason)}`);
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (available) void refresh();
  }, [available, refresh]);

  async function change(agent: AgentId, install: boolean) {
    setBusy(agent);
    try {
      setReport(await (install ? installHooks(agent) : removeHooks(agent)));
      setError(null);
      const name = PET_BY_AGENT[agent].agentName;
      notify(agent === "deepseek"
        ? install ? "Watching DSH sessions." : "Stopped watching DSH sessions."
        : install ? `Hooks installed for ${name}.` : `Hooks removed from ${name}.`);
    } catch (reason) {
      notify(message(reason), true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="settings-card" aria-labelledby="hooks-heading">
      <div className="settings-section-heading">
        <Webhook size={16} aria-hidden="true" />
        <h2 id="hooks-heading">Agent hooks</h2>
        {available && (
          <button type="button" className="text-button pet-refresh" disabled={busy !== null} onClick={() => void refresh()}>
            <RefreshCw size={13} aria-hidden="true" /> Refresh
          </button>
        )}
      </div>
      <p className="settings-description">
        Hooks let each agent tell its pet when a chat starts working, finishes, or needs you. Install adds Toolbox-Chan's
        hooks next to your existing ones and backs up the file once before the first change. Remove takes out only
        Toolbox-Chan's hooks.
      </p>
      {!available && (
        <div className="setting-row">
          <p>Hooks can be installed from the Toolbox-Chan desktop app.</p>
        </div>
      )}
      {error && (
        <div className="setting-row">
          <p className="pet-hook-error" role="alert">{error}</p>
        </div>
      )}
      {report?.development && (
        <p className="settings-note">
          This is a development build. Hooks installed from it run <span className="mono">{report.executable}</span>. Install
          them from the installed app instead.
        </p>
      )}
      {report?.agents.map((entry) => {
        const pet = PET_BY_AGENT[entry.agent];
        const state = STATE_TEXT[entry.state];
        const watcher = entry.method === "watcher";
        const installed = entry.state !== "missing" && entry.state !== "error";
        const needsReview = entry.events.some((event) => event.installed && event.reviewed === false);
        const add = watcher
          ? installed ? null : "Turn on"
          : entry.state === "missing" ? "Install" : entry.state === "outdated" || entry.state === "partial" ? "Update" : null;
        return (
          <div className="setting-row" key={entry.agent} data-agent={entry.agent}>
            <div>
              <strong>{pet.agentName}</strong>
              <p className="mono">{entry.path}</p>
              <span className="pet-state" data-tone={state.tone}>
                {watcher ? (installed ? "Watching sessions" : "Not watching") : state.text}
                {needsReview && " · waiting for review in Codex"}
              </span>
              {entry.events.length > 0 && (
                <div className="pet-events">
                  {entry.events.map((event) => (
                    <span key={event.name} className="small-tag" data-installed={String(event.installed)} title={`Reports “${event.status}”`}>
                      {event.name} → {event.status}
                    </span>
                  ))}
                </div>
              )}
              <p className="pet-hook-detail">{NOTES[entry.agent]}</p>
              {entry.error && <p className="pet-hook-error">{entry.error}</p>}
              {entry.backup && <p>Backup: <span className="mono">{entry.backup}</span></p>}
            </div>
            <div className="pet-actions">
              {add && (
                <button type="button" className="button secondary" disabled={busy !== null} onClick={() => void change(entry.agent, true)}>
                  {add}
                </button>
              )}
              {installed && (
                <button type="button" className="button secondary" disabled={busy !== null} onClick={() => void change(entry.agent, false)}>
                  {watcher ? "Turn off" : "Remove"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
