import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import { useToolbox } from "../../../core/sdk";
import { PET_BY_AGENT } from "../pets";
import { installStatusLine, limitsAvailable, readLimits, removeStatusLine, type LimitsReport, type StatusLine } from "../services/limits";

const STATE_TEXT: Record<StatusLine["state"], { text: string; tone: "good" | "warn" | "bad" | "none" }> = {
  installed: { text: "Installed", tone: "good" },
  outdated: { text: "Installed for another copy of Toolbox-Chan", tone: "warn" },
  missing: { text: "Not installed", tone: "none" },
  error: { text: "Cannot read the file", tone: "bad" },
};

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function seen(at?: number) {
  if (!at) return "no usage seen yet";
  return `last usage seen ${new Date(at).toLocaleString()}`;
}

/** Where limit resets come from, and the Claude Code status line wrapper. */
export function LimitSettings() {
  const { notify } = useToolbox();
  const [report, setReport] = useState<LimitsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = limitsAvailable();

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setReport(await readLimits());
      setError(null);
    } catch (reason) {
      setError(`Could not read the limit sources. ${message(reason)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (available) void refresh();
  }, [available, refresh]);

  async function change(install: boolean) {
    setBusy(true);
    try {
      setReport(await (install ? installStatusLine() : removeStatusLine()));
      notify(install ? "The Claude Code status line now reports limits to the pets." : "The Claude Code status line is back to your own.");
    } catch (reason) {
      notify(message(reason), true);
    } finally {
      setBusy(false);
    }
  }

  const statusLine = report?.statusLine;
  const state = statusLine && STATE_TEXT[statusLine.state];
  return (
    <section className="settings-card" aria-labelledby="limits-heading">
      <div className="settings-section-heading">
        <Gauge size={16} aria-hidden="true" />
        <h2 id="limits-heading">Limit resets</h2>
        {available && (
          <button type="button" className="text-button pet-refresh" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={13} aria-hidden="true" /> Refresh
          </button>
        )}
      </div>
      <p className="settings-description">
        Toolbox-Chan reads the usage records the agents already keep, and tells a pet when a 5-hour or weekly limit starts
        fresh. A scheduled reset shows on time; a sudden early reset shows the next time the agent reports its usage.
      </p>
      {!available && (
        <div className="setting-row">
          <p>Limit resets are found by the Toolbox-Chan desktop app.</p>
        </div>
      )}
      {error && (
        <div className="setting-row">
          <p className="pet-hook-error" role="alert">{error}</p>
        </div>
      )}
      {statusLine && state && (
        <div className="setting-row" data-source="status-line">
          <div>
            <strong>Claude Code status line</strong>
            <p className="mono">{statusLine.path}</p>
            <span className="pet-state" data-tone={state.tone}>{state.text}</span>
            <p className="pet-hook-detail">
              Claude Code tells only its status line when its limits reset. Install wraps your status line: Claude Code runs
              Toolbox-Chan, which runs your own command with the same input, shows its text unchanged, and passes the limit
              times to the pets. Remove puts your command back.
            </p>
            {statusLine.wrapped && <p>Your status line: <span className="mono">{statusLine.wrapped}</span></p>}
            {statusLine.error && <p className="pet-hook-error">{statusLine.error}</p>}
            {statusLine.backup && <p>Backup: <span className="mono">{statusLine.backup}</span></p>}
          </div>
          <div className="pet-actions">
            {statusLine.state !== "installed" && statusLine.state !== "error" && (
              <button type="button" className="button secondary" disabled={busy} onClick={() => void change(true)}>
                {statusLine.state === "missing" ? "Install" : "Update"}
              </button>
            )}
            {(statusLine.state === "installed" || statusLine.state === "outdated") && (
              <button type="button" className="button secondary" disabled={busy} onClick={() => void change(false)}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}
      {report?.sources.map((source) => (
        <div className="setting-row" key={`${source.agent}:${source.name}`} data-source={`${source.agent}:${source.name}`}>
          <div>
            <strong>{PET_BY_AGENT[source.agent].agentName}: {source.name}</strong>
            <p className="mono">{source.path}</p>
            <span className="pet-state" data-tone={source.found ? "good" : "none"}>
              {source.found ? `Found, ${seen(source.seenAt)}` : "Not found"}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}
