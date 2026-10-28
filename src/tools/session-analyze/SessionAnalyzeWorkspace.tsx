import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Folder, RefreshCw, Upload } from "lucide-react";
import { EmptyState, ToolPage, ToolPanel, type ToolSurfaceProps } from "../../core/sdk";
import { desktop } from "./backend";
import { useSessionAnalyze } from "./SessionAnalyzeProvider";
import { SessionReport } from "./SessionReport";
import { SessionTabs } from "./SessionTabs";
import { Highlight } from "./Highlight";
import { AGENT_LABELS, filterSessions, projectName } from "./utils";
import type { SessionPreview } from "./types";

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });
function modifiedDate(session: SessionPreview) {
  const date = new Date(session.modifiedAt);
  return session.modifiedAt > 0 && Number.isFinite(date.getTime()) ? date : null;
}

export default function SessionAnalyzeWorkspace({ tool }: ToolSurfaceProps) {
  const state = useSessionAnalyze();
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [agent, setAgent] = useState("");
  const [tower, setTower] = useState("");
  const [displayMode, setDisplayMode] = useState<"project" | "date">("project");
  const [summaryHost, setSummaryHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!started.current && !state.scanned) { started.current = true; void state.refresh(); }
  }, [state]);
  const matches = filterSessions(state.catalog.sessions, query, project, agent, tower);
  const byDate = displayMode === "date";
  const orderedMatches = byDate ? [...matches].sort((a, b) => (modifiedDate(b)?.getTime() ?? 0) - (modifiedDate(a)?.getTime() ?? 0)) : matches;
  const groups = new Map<string, SessionPreview[]>();
  for (const session of orderedMatches) {
    const date = byDate ? modifiedDate(session) : null;
    const group = byDate ? date ? dayFormat.format(date) : "Date unavailable" : session.project || "";
    const sessions = groups.get(group);
    if (sessions) sessions.push(session); else groups.set(group, [session]);
  }
  const projects = [...new Set(state.catalog.sessions.map((session) => session.project).filter((path): path is string => !!path))].sort();
  return <ToolPage tool={tool} className={`session-analyze-tool${state.workspaceTab === "analysis" && state.report ? " sa-has-analysis" : ""}`}
    toolbar={<><div ref={setSummaryHost} className="sa-header-summary" hidden={state.workspaceTab !== "analysis" || !state.report} aria-label="Selected session summary" />
    <div className="sa-workspace-toolbar">
      <SessionTabs prefix="sa-workspace" label="Session analyze views" value={state.workspaceTab} onChange={state.setWorkspaceTab}
        items={[{ id: "sessions", label: "Sessions", count: state.catalog.sessions.length }, { id: "analysis", label: "Analysis" }]} />
      <div className="sa-toolbar">
        <button className="button secondary" disabled={!!state.busy || !desktop} onClick={() => void state.refresh()}><RefreshCw size={16} />Refresh sessions</button>
        <button className="button secondary" disabled={!!state.busy} onClick={() => input.current?.click()}><Upload size={16} />Import report</button>
        <input ref={input} type="file" accept=".json,application/json" aria-label="Import analysis JSON" className="sa-file-input" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void state.importFile(file);
          event.target.value = "";
        }} />
      </div>
    </div></>}
    description={<>
      {state.busy && <p className="sa-busy" role="status"><RefreshCw size={16} />{state.busy}</p>}
      {state.error && <p className="error-banner" role="alert">{state.error}</p>}
    </>}>
    <div id="sa-workspace-panel-sessions" role="tabpanel" aria-labelledby="sa-workspace-tab-sessions" hidden={state.workspaceTab !== "sessions"}>
      <div className="sa-catalog-summary">
        <div><strong>{state.catalog.sessions.length.toLocaleString()}</strong><span>sessions across {projects.length} projects</span></div>
        <div className="sa-platforms" aria-label="Sessions by platform">{Object.entries(AGENT_LABELS).map(([id, name]) => {
          const total = state.catalog.sessions.filter((session) => session.agent === id).length;
          return <button className="sa-platform" key={id} aria-pressed={agent === id} onClick={() => setAgent(agent === id ? "" : id)}><span>{name}</span><strong>{total}</strong><span className="sa-platform-track" aria-hidden="true"><span style={{ width: `${state.catalog.sessions.length ? total / state.catalog.sessions.length * 100 : 0}%` }} /></span></button>;
        })}</div>
      </div>
      {!desktop && <p className="info-banner">Local session discovery and project coverage need the desktop app. Import a general chat analyze JSON report to explore it here.</p>}
      <ToolPanel title="Find a session" className="sa-catalog" status={<span className="small-tag">{matches.length} matching</span>}>
        <div className="sa-filters">
          <label>Search sessions<input type="search" placeholder="Title, project, or session ID" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label>Project<select aria-label="Project" value={project} onChange={(event) => setProject(event.target.value)}><option value="">All projects</option>{projects.map((path) => <option key={path} value={path}>{path}</option>)}</select></label>
          <label>Agent platform<select aria-label="Agent platform" value={agent} onChange={(event) => setAgent(event.target.value)}><option value="">All agents</option>{Object.entries(AGENT_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label>Tower task<select aria-label="Tower task" value={tower} onChange={(event) => setTower(event.target.value)}><option value="">Any origin</option><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option></select></label>
        </div>
        <div className="sa-results-heading"><div><span><strong>{matches.length}</strong> matching sessions · previews only</span>{byDate && <p className="sa-date-basis">Last modified · newest first · local dates</p>}</div>
          <div className="sa-view-controls"><label>Display mode<select aria-label="Display mode" value={displayMode} onChange={(event) => setDisplayMode(event.target.value as "project" | "date")}><option value="project">By project</option><option value="date">By date — newest first</option></select></label>
            {(query || project || agent || tower) && <button className="text-button" onClick={() => { setQuery(""); setProject(""); setAgent(""); setTower(""); }}>Clear filters</button>}
          </div>
        </div>
        <div className="sa-session-list" aria-label={byDate ? "Sessions by date" : "Sessions by project"}>
          {matches.length === 0 && <EmptyState title={state.catalog.sessions.length ? "No sessions match these filters" : "No sessions found"}>{state.catalog.sessions.length ? "Clear a filter or try another title or path." : "Import a report or refresh local sessions in the desktop app."}</EmptyState>}
          {[...groups].map(([group, sessions]) => <details className="sa-session-group" key={`${displayMode}:${group}`} open>
            <summary>{byDate ? <CalendarDays size={17} /> : <Folder size={17} />}<strong>{byDate ? group : projectName(group)}</strong><span className="small-tag">{sessions.length}</span>{!byDate && <span className="sa-project-path"><Highlight text={group || "Project not recorded"} query={query} /></span>}</summary>
            <ul>{sessions.map((session) => <li key={`${session.agent}:${session.sourcePath}:${session.id}`} className={state.report?.session.id === session.id ? "sa-selected" : ""}>
              <div className="sa-session-title"><strong><Highlight text={session.title || session.id} query={query} /></strong><span className="sa-muted">{modifiedDate(session)?.toLocaleString() ?? "Date unavailable"} · {(session.sizeBytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} KiB</span>{byDate && <span className="sa-path sa-muted"><Highlight text={session.project || "Project not recorded"} query={query} /></span>}</div>
              <span className="sa-badge">{AGENT_LABELS[session.agent]}</span><span className={`sa-badge ${session.tower === "yes" ? "sa-badge-info" : ""}`}>Tower: {session.tower}</span>
              <button className="button secondary" disabled={!!state.busy} aria-label={`Analyze: ${session.title || session.id}`} onClick={() => void state.analyze(session)}>Analyze<ArrowRight size={15} /></button>
            </li>)}</ul>
          </details>)}
        </div>
      </ToolPanel>
      <details className="sa-note"><summary>Sources and discovery notes</summary>
        <ul>{state.catalog.sources.map((source) => <li key={source.path}><strong>{AGENT_LABELS[source.agent]} · {source.found ? "Found" : "Not found"}</strong><br /><code>{source.path}</code></li>)}</ul>
        <ul>{state.catalog.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
      </details>
    </div>
    <div id="sa-workspace-panel-analysis" role="tabpanel" aria-labelledby="sa-workspace-tab-analysis" hidden={state.workspaceTab !== "analysis"}>
      {state.report ? <SessionReport key={`${state.report.session.agent}:${state.report.session.id}:${state.report.analyzedAt}`} report={state.report} summaryHost={summaryHost} /> : <ToolPanel title="Analysis"><EmptyState title="Choose a session to analyze">Open Sessions and select Analyze to inspect activity, costs, and project coverage.<button className="button primary" onClick={() => state.setWorkspaceTab("sessions")}>Browse sessions</button></EmptyState></ToolPanel>}
    </div>
  </ToolPage>;
}
