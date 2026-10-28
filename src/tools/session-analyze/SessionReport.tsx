import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Download, FileSearch, Info } from "lucide-react";
import { ToolPanel } from "../../core/sdk";
import { desktop, exportReport } from "./backend";
import { useSessionAnalyze } from "./SessionAnalyzeProvider";
import { PricingEstimate } from "./PricingEstimate";
import { ActivitySummary, ActivityTimeline } from "./ActivitySummary";
import { getActivitySummary } from "./analytics";
import { ProjectMap } from "./ProjectMap";
import { Highlight } from "./Highlight";
import { SessionTabs } from "./SessionTabs";
import { AGENT_LABELS, contextSignals, estimateCost } from "./utils";
import type { GeneralChatAnalyze, SessionEvent } from "./types";

const VIEWS = ["Overview", "Flow", "Skills", "MCP", "Tools", "Files", "Context", "Cost"] as const;
type View = typeof VIEWS[number];
const eventKind: Partial<Record<View, SessionEvent["kind"]>> = { Skills: "skill", MCP: "mcp", Tools: "tool" };
const count = (value: number | null) => value === null ? "Unknown" : value.toLocaleString();

const Events = memo(function Events({ events, query, onVisible }: { events: SessionEvent[]; query: string; onVisible: (ids: readonly string[]) => void }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    onVisible([]);
    const root = list.current?.closest(".sa-event-scroll");
    if (!root || !list.current) return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.eventId!;
        if (entry.isIntersecting) visible.add(id); else visible.delete(id);
      }
      onVisible([...visible]);
    }, { root, threshold: 0 });
    for (const row of list.current.children) observer.observe(row);
    return () => observer.disconnect();
  }, [events, onVisible]);
  return <>
    <p className="sa-result-count"><strong>{events.length.toLocaleString()}</strong> matching events <span>· source order</span></p>
    <ol ref={list} className="sa-events" aria-label="Session events">
      {events.map((event) => <li key={event.id} id={`sa-event-${event.id}`} data-event-id={event.id}>
        <details>
          <summary><span className="sa-event-order">{event.order}</span><span className={`sa-badge sa-kind-${event.kind}`}>{event.kind}</span><strong><Highlight text={event.name || event.role || "Event"} query={query} /></strong><span className={`sa-badge sa-status-${event.status}`}>{event.status}</span></summary>
          <div className="sa-event-detail"><p className="sa-muted">{event.timestamp || "Time not recorded"} · {event.role || "Agent activity"}{event.callId ? ` · Call ${event.callId}` : ""}</p>
            <pre><Highlight text={event.text || "No text recorded."} query={query} /></pre>
            <p className="sa-muted">Evidence: <Highlight text={event.source} query={query} /></p>
          </div>
        </details>
      </li>)}
    </ol>
    {!events.length && <div className="sa-inline-empty"><FileSearch size={24} /><strong>No matching evidence</strong><p>Try another search or filter. Missing records do not prove that no activity occurred.</p></div>}
  </>;
});

function CostAccounting({ report, rates, onRateChange }: { report: GeneralChatAnalyze; rates: string[]; onRateChange: (index: number, value: string) => void }) {
  const state = useSessionAnalyze();
  const estimate = estimateCost(report.usage, rates);
  const cached = report.usage.cachedInputTokens;
  const total = report.usage.inputTokens;
  const cachedPercent = total !== null && total > 0 && cached !== null && cached <= total ? cached / total * 100 : null;
  return <div className="sa-cost-view">
    <section className="sa-section"><h3>Token accounting</h3><p><strong>{count(cached)}</strong> cached input tokens · <strong>{cachedPercent === null ? "Unknown" : `${cachedPercent.toFixed(1)}%`}</strong> of input</p>
      {cachedPercent !== null && <div className="sa-token-track" role="img" aria-label={`${cachedPercent.toFixed(1)} percent of input tokens cached`}><span style={{ width: `${cachedPercent}%` }} /></div>}
      <details className="sa-note"><summary>Cost and token accounting</summary><p>{report.cost.detail}</p><p>{report.usage.basis}</p></details>
    </section>
    <PricingEstimate report={report} />
    <details className="sa-note"><summary>Manual whole-session estimate</summary>
      <p>Use one rate set only when it applies to every request. Mixed models and cache-write charges need separate accounting.</p>
      <div className="sa-rates">{["Uncached input", "Cached input", "Output"].map((label, i) => <label key={label}>{label}<input aria-label={`${label} price per million tokens`} type="number" min="0" step="any" value={rates[i]} onChange={(event) => onRateChange(i, event.target.value)} /></label>)}</div>
      <p>{estimate === null ? "Requires known input, output, and cached-input counts and all three USD prices per million tokens." : `Estimated API cost: $${estimate.toFixed(6)} USD`}</p>
      <button className="button secondary" disabled={estimate === null || report.cost.basis === "reported"} onClick={() => { if (estimate !== null) state.saveEstimate(estimate, `User-supplied USD rates per million tokens: uncached input ${rates[0]}, cached input ${rates[1]}, output ${rates[2]}. API-equivalent estimate; excludes subscription and additional charges.`); }}>Use estimate in report</button>
    </details>
  </div>;
}

export function SessionReport({ report, summaryHost }: { report: GeneralChatAnalyze; summaryHost: HTMLElement | null }) {
  const state = useSessionAnalyze();
  const [view, setView] = useState<View>("Overview");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [selectedIds, setSelectedIds] = useState<readonly string[] | null>(null);
  const [selectionLabel, setSelectionLabel] = useState("");
  const [operation, setOperation] = useState("");
  const [rates, setRates] = useState(["", "", ""]);
  const [highlightedIds, setHighlightedIds] = useState<readonly string[] | null>(null);
  const [currentEventIds, setCurrentEventIds] = useState<readonly string[]>([]);
  const signals = useMemo(() => contextSignals(report), [report]);
  const summary = useMemo(() => getActivitySummary(report), [report]);
  const eventById = useMemo(() => new Map(report.events.map((event) => [event.id, event])), [report.events]);
  const relevantEvents = useMemo(() => {
    if (view === "Context") return signals.contextEvents;
    const kind = eventKind[view];
    if (!kind) return report.events;
    const ids = new Set(getActivitySummary(report, [kind]).eventIds);
    return report.events.filter((event) => ids.has(event.id));
  }, [view, report, signals]);
  const selectedSet = useMemo(() => selectedIds ? new Set(selectedIds) : null, [selectedIds]);
  const needle = query.trim().toLowerCase();
  const events = useMemo(() => relevantEvents.filter((event) => (!selectedSet || selectedSet.has(event.id)) && (!status || event.status === status)
    && (!needle || `${event.name} ${event.text} ${event.source}`.toLowerCase().includes(needle))), [relevantEvents, selectedSet, status, needle]);
  const visibleEventIds = useMemo(() => events.map((event) => event.id), [events]);
  const visibleFiles = report.files.filter((file) => (!operation || file.operation === operation) && file.path.toLowerCase().includes(needle));
  const tabCounts: Partial<Record<View, number>> = { Flow: report.events.length, Skills: summary.counts.skill, MCP: summary.counts.mcp, Tools: summary.counts.tool, Files: report.files.length, Context: signals.contextEvents.length };
  const navigate = (next: View) => { setView(next); setQuery(""); setStatus(""); setSelectedIds(null); setSelectionLabel(""); setHighlightedIds(null); setCurrentEventIds([]); };
  const selectActivity = (kind: SessionEvent["kind"], name: string, ids?: readonly string[]) => {
    navigate(kind === "tool" ? "Tools" : kind === "mcp" ? "MCP" : kind === "skill" ? "Skills" : kind === "context" || kind === "compaction" ? "Context" : "Flow");
    if (ids) { setSelectedIds(ids); setSelectionLabel(name); } else setQuery(name);
  };
  const jump = (id: string) => { navigate("Flow"); setSelectedIds([id]); setSelectionLabel(`Event #${eventById.get(id)?.order ?? id}`); };
  const kinds = useMemo(() => view === "Context" ? ["context", "skill", "compaction"] as const : eventKind[view] ? [eventKind[view]!] : undefined, [view]);
  return <>
    {summaryHost && createPortal(<>
      <header className="sa-report-header"><div><h3>{report.session.title || report.session.id}</h3><p className="sa-path">{report.session.project || "No project recorded"}</p></div><div className="sa-report-meta"><span className="sa-badge sa-badge-info">{AGENT_LABELS[report.session.agent]}</span><span className="sa-badge">Tower: {report.session.tower}</span><span className="sa-muted">Analyzed {new Date(report.analyzedAt).toLocaleString()}</span></div></header>
      <div className="sa-metrics">
        <button onClick={() => navigate("Cost")}><span>Session cost</span><strong>{report.cost.amount === null ? "Unknown" : `$${report.cost.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}`}</strong><small>{report.cost.basis} · USD</small></button>
        <button onClick={() => navigate("Cost")}><span>Input tokens</span><strong>{count(report.usage.inputTokens)}</strong><small>{count(report.usage.cachedInputTokens)} cached</small></button>
        <button onClick={() => navigate("Cost")}><span>Output tokens</span><strong>{count(report.usage.outputTokens)}</strong><small>{count(report.usage.reasoningTokens)} reasoning</small></button>
        <button onClick={() => navigate("Flow")}><span>Recorded events</span><strong>{count(report.events.length)}</strong><small>{report.files.length.toLocaleString()} file operations</small></button>
      </div>
    </>, summaryHost)}
    <ToolPanel title="Analysis" className="sa-report" actions={<div className="sa-toolbar"><button className="button secondary" onClick={() => state.setWorkspaceTab("sessions")}><ArrowLeft size={15} />Sessions</button><button className="button secondary" disabled={!!state.busy} onClick={() => void state.exportAction(() => exportReport(report))}><Download size={16} />Export JSON</button></div>}>
    <div className="sa-report-body">
      <SessionTabs prefix="sa-report" label="Report sections" value={view} onChange={navigate} items={VIEWS.map((id) => ({ id, label: id, count: tabCounts[id] }))} />
      {VIEWS.map((name) => <section key={name} id={`sa-report-panel-${name}`} role="tabpanel" aria-labelledby={`sa-report-tab-${name}`} hidden={view !== name} className="sa-report-section">
        {view === name && (view === "Cost" ? <CostAccounting report={report} rates={rates} onRateChange={(index, value) => setRates((old) => old.map((rate, i) => i === index ? value : rate))} /> : view === "Files" ? <div className="sa-files-layout">
          <div className="sa-map-pane" tabIndex={0} role="region" aria-label="Project structure pane"><ProjectMap coverage={state.coverage} project={report.session.project} busy={!!state.busy} available={desktop} onScan={(rescan, includeDependencies, respectGitignore) => void state.getCoverage(rescan, includeDependencies, respectGitignore)} /></div>
          <section className="sa-files-evidence" aria-label="Recorded file operations pane"><div className="sa-section-heading"><h3>Recorded file operations</h3><span className="small-tag">{new Set(report.files.map((file) => file.path)).size} distinct paths</span></div>
            <div className="sa-operation-counts" aria-label="File operation counts">{["read", "write", "search", "list"].map((op) => <button key={op} className={`sa-operation sa-operation-${op}`} aria-pressed={operation === op} onClick={() => setOperation(operation === op ? "" : op)}><strong>{report.files.filter((file) => file.operation === op).length}</strong><span>{op}</span></button>)}</div>
            <div className="sa-evidence-filters"><label>Search files<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter recorded paths" /></label><label>File operation<select aria-label="File operation" value={operation} onChange={(event) => setOperation(event.target.value)}><option value="">All operations</option>{["read", "write", "search", "list"].map((name) => <option key={name}>{name}</option>)}</select></label></div>
            <p className="sa-muted"><strong>{visibleFiles.length}</strong> matching operations. Search and list activity do not count as file reads. Explicit paths indicate a request, not guaranteed success.</p>
            <div className="sa-table-scroll"><table aria-label="File operations"><thead><tr><th>File or scope</th><th>Operation</th><th>Evidence</th><th>Event</th></tr></thead><tbody>{visibleFiles.map((file, i) => <tr key={i}><td><code><Highlight text={file.path} query={query} /></code></td><td><span className={`sa-badge sa-operation-${file.operation}`}>{file.operation}</span></td><td>{file.evidence}{eventById.get(file.eventId)?.status === "error" && <span className="sa-badge sa-status-error">Failed</span>}</td><td><button className="text-button" onClick={() => jump(file.eventId)}>#{eventById.get(file.eventId)?.order ?? file.eventId}</button></td></tr>)}</tbody></table></div>
            {!visibleFiles.length && <p className="sa-muted">No recorded paths match these filters.</p>}
          </section>
        </div> : view === "Overview" ? <>
          <ActivitySummary report={report} onSelect={selectActivity} highlightedIds={highlightedIds} onHighlight={setHighlightedIds} />
            <div className="sa-overview-links"><button className="sa-overview-link" onClick={() => navigate("Files")}><FileSearch size={20} /><span><strong>{new Set(report.files.map((file) => file.path)).size} recorded paths</strong><small>Open the project map and file evidence</small></span></button><button className="sa-overview-link" onClick={() => navigate("Context")}><Info size={20} /><span><strong>{signals.repeatedReads.length} paths read repeatedly</strong><small>Inspect context sources and repeated reads</small></span></button></div>
            {report.warnings.length > 0 && <details className="sa-note sa-analysis-notes"><summary><Info size={16} />Analysis notes <span className="small-tag">{report.warnings.length}</span></summary><ul>{report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
          </> : <div className="sa-reading-layout">
            <aside className="sa-reading-summary" tabIndex={0} aria-label="Activity charts">
              <ActivitySummary report={report} kinds={kinds} onSelect={selectActivity} highlightedIds={highlightedIds} onHighlight={setHighlightedIds} showTimeline={false} />
            {view === "Context" && <>
              <p className="sa-muted">Skill catalogs do not prove that skills were loaded. Text size below measures logged characters, not tokens or exact context-window occupancy.</p>
              <div className="sa-context-grid"><section className="sa-section"><h3>Repeated file reads <span className="small-tag">{signals.repeatedReads.length}</span></h3><ul className="sa-ranked-list" aria-label="Repeated file reads" tabIndex={0}>{signals.repeatedReads.map(([path, times]) => <li key={path}><button onClick={() => { navigate("Flow"); setSelectedIds(report.files.filter((file) => file.path === path && file.operation === "read").map((file) => file.eventId)); setSelectionLabel(path); }}><code>{path}</code><strong>{times}×</strong><span className="sa-rank-track" aria-hidden="true"><span style={{ width: `${times / signals.repeatedReads[0][1] * 100}%` }} /></span></button></li>)}</ul>{!signals.repeatedReads.length && <p className="sa-muted">No repeated reads recorded.</p>}</section>
                <section className="sa-section"><h3>Recorded text by size <span className="small-tag">{signals.largestEvents.length}</span></h3><ul className="sa-ranked-list" aria-label="Recorded text by size" tabIndex={0}>{signals.largestEvents.map((event) => <li key={event.id}><button onClick={() => jump(event.id)}><span>#{event.order} · {event.name}</span><strong>{event.text.length.toLocaleString()} chars</strong><span className="sa-rank-track" aria-hidden="true"><span style={{ width: `${event.text.length / Math.max(1, signals.largestEvents[0].text.length) * 100}%` }} /></span></button></li>)}</ul></section></div>
            </>}
            </aside>
            <section className="sa-evidence" aria-label="Event reading pane">
              <div className="sa-reader-controls">
                <ActivityTimeline report={report} kinds={kinds} highlightedIds={highlightedIds} onHighlight={setHighlightedIds} visibleEventIds={visibleEventIds} currentEventIds={currentEventIds} onSelect={selectActivity} compact />
                <div className="sa-section-heading"><h3>{view === "Flow" ? "Event timeline" : `${view} evidence`}</h3>{selectedIds && <button className="text-button" onClick={() => { setSelectedIds(null); setSelectionLabel(""); }}>Clear selection</button>}</div>
              {selectedIds && <p className="sa-selection">Showing: <strong>{selectionLabel}</strong></p>}
              <div className="sa-evidence-filters"><label>Search {view.toLowerCase()}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, recorded text, or source" /></label><label>Outcome<select aria-label="Outcome" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All outcomes</option>{["success", "error", "observed", "unknown"].map((name) => <option key={name}>{name}</option>)}</select></label></div>
              </div>
              <div className="sa-event-scroll" tabIndex={0} role="region" aria-label="Scrollable session events"><Events key={view + query + status + selectionLabel} events={events} query={query} onVisible={setCurrentEventIds} /></div>
            </section>
          </div>)}
      </section>)}
    </div>
  </ToolPanel></>;
}
