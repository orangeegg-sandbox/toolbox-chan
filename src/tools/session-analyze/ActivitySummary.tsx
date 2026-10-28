import { useId, useMemo, useState } from "react";
import { EVENT_KINDS, EVENT_LABELS, getActivitySummary, getActivityTimeline } from "./analytics";
import type { ActivityCategory, ActivityFrequency, EventKind } from "./analytics";
import type { GeneralChatAnalyze } from "./types";
import "./activity-summary.css";

export interface ActivitySummaryProps {
  report: GeneralChatAnalyze;
  kinds?: readonly EventKind[];
  onSelect: (kind: EventKind, name: string, eventIds?: readonly string[]) => void;
  highlightedIds?: readonly string[] | null;
  onHighlight?: (ids: readonly string[] | null) => void;
  showTimeline?: boolean;
}
export interface ActivityTimelineProps extends Omit<ActivitySummaryProps, "onSelect" | "showTimeline"> {
  onSelect?: ActivitySummaryProps["onSelect"];
  visibleEventIds?: readonly string[];
  currentEventIds?: readonly string[];
  compact?: boolean;
}

const format = (value: number) => value.toLocaleString();
const kindsFromKey = (key: string | undefined) => key === undefined ? undefined : key ? key.split("|") as EventKind[] : [];

function useHighlight(ids: readonly string[] | null | undefined, onHighlight?: ActivitySummaryProps["onHighlight"]) {
  const [local, setLocal] = useState<readonly string[] | null>(null);
  const highlighted = ids === undefined ? local : ids;
  const update = (next: readonly string[] | null) => { setLocal(next); onHighlight?.(next); };
  return [highlighted, update] as const;
}

export function ActivityTimeline({ report, kinds, highlightedIds, onHighlight, onSelect, visibleEventIds, currentEventIds, compact = false }: ActivityTimelineProps) {
  const kindsKey = kinds?.join("|");
  const data = useMemo(() => getActivityTimeline(report, kindsFromKey(kindsKey)), [report, kindsKey]);
  const [highlighted, highlight] = useHighlight(highlightedIds, onHighlight);
  const highlightSet = useMemo(() => highlighted === null ? null : new Set(highlighted), [highlighted]);
  const visibleSet = useMemo(() => visibleEventIds === undefined ? null : new Set(visibleEventIds), [visibleEventIds]);
  const currentSet = useMemo(() => new Set(currentEventIds), [currentEventIds]);
  const categories = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data]);
  const selectedIds = useMemo(() => new Set(data.categories.flatMap((category) => category.eventIds)), [data]);
  const eventOrder = useMemo(() => new Map(report.events.map((event) => [event.id, event.order])), [report]);
  const readingOrders = (currentEventIds ?? []).flatMap((id) => eventOrder.has(id) ? [eventOrder.get(id)!] : []).sort((a, b) => a - b);
  const currentBuckets = data.buckets.flatMap((bucket, index) => bucket.eventIds.some((id) => currentSet.has(id)) ? [index] : []);
  const highlightedCount = highlighted?.filter((id) => selectedIds.has(id)).length ?? 0;
  const visibleCount = visibleEventIds?.filter((id) => selectedIds.has(id)).length ?? data.selected;
  return <section className={`sa-activity-sequence${compact ? " sa-activity-sequence-compact" : ""}`} aria-label="Source order activity">
    <div className="sa-activity-sequence-label"><h4>Source order</h4><span>{format(data.selected)} {data.byName ? "evidence events" : "records"} · {format(data.total)} session records</span></div>
    {data.total === 0 ? <p className="sa-activity-note">No source records were provided.</p> : <>
      <div className="sa-activity-strip" role="list" aria-label="Activity in full session source order">
        {data.buckets.map((bucket, index) => {
          const current = bucket.eventIds.some((id) => currentSet.has(id));
          const description = `Source order ${bucket.firstOrder} to ${bucket.lastOrder}: ${bucket.selected} selected of ${bucket.total} source records${current ? "; currently reading" : ""}`;
          return <div key={index} role="listitem" aria-label={description} title={description}
            className={`sa-activity-bucket${bucket.selected === 0 ? " is-gap" : ""}`}
            data-first-order={bucket.firstOrder} data-last-order={bucket.lastOrder} data-selected-count={bucket.selected} style={{ flexGrow: bucket.total }}>
            {bucket.selected < bucket.total && <span className="sa-activity-gap" aria-hidden="true" style={{ flexGrow: bucket.total - bucket.selected }} />}
            {bucket.segments.flatMap((segment) => {
              const category = categories.get(segment.categoryId)!;
              const portions = new Map<string, { count: number; matched: boolean; shown: boolean }>();
              for (const id of segment.eventIds) {
                const matched = highlightSet?.has(id) ?? false;
                const shown = visibleSet === null || visibleSet.has(id);
                const key = `${matched}-${shown}`;
                const portion = portions.get(key) ?? { count: 0, matched, shown };
                portion.count += 1;
                portions.set(key, portion);
              }
              return [...portions].map(([key, portion]) => <span key={`${segment.categoryId}-${key}`} aria-hidden="true"
                className={`sa-activity-segment sa-timeline-color-${category.color}${highlightSet !== null ? portion.matched ? " is-highlighted" : " is-dimmed" : !portion.shown ? " is-dimmed" : ""}`}
                data-category={category.id} data-color={category.color} data-highlighted={portion.matched} data-count={portion.count}
                title={`${category.name}: ${portion.count}${portion.matched ? " highlighted" : ""}${!portion.shown ? "; outside evidence filter" : ""}`}
                style={{ flexGrow: portion.count }} />);
            })}
          </div>;
        })}
      </div>
      {currentEventIds !== undefined && <div className="sa-reading-track" aria-hidden="true"
        style={{ gridTemplateColumns: data.buckets.map((bucket) => `${bucket.total}fr`).join(" ") }}>
        {currentBuckets.length > 0 && <span className="sa-reading-range"
          data-first-order={readingOrders[0]} data-last-order={readingOrders.at(-1)}
          style={{ gridColumn: `${currentBuckets[0] + 1} / ${currentBuckets.at(-1)! + 2}` }} />}
      </div>}
      <div className="sa-activity-axis"><span>#{data.buckets[0].firstOrder}</span><span>Full session · gaps preserved</span><span>#{data.buckets.at(-1)!.lastOrder}</span></div>
      <div className="sa-timeline-position">
        <span className="sa-timeline-match-count" role="status" aria-live="polite">{highlightSet === null ? "Hover or focus a name to trace its events." : `${format(highlightedCount)} matching ${highlightedCount === 1 ? "event" : "events"} highlighted`}</span>
        {visibleEventIds !== undefined && <span>{format(visibleCount)} match evidence filters</span>}
        {readingOrders.length > 0 && <strong>Reading #{readingOrders[0]}{readingOrders.length > 1 ? `–#${readingOrders.at(-1)}` : ""}</strong>}
      </div>
      <ul className="sa-activity-legend" aria-label="Source order legend">{data.categories.map((category) => {
        const matches = highlightSet === null || category.eventIds.some((id) => highlightSet.has(id));
        return <li key={category.id}><button type="button" className={`sa-timeline-legend-item${matches ? "" : " is-dimmed"}`}
          aria-label={`${category.name}: ${format(category.count)} events. ${onSelect ? "Show evidence" : "Highlight activity"}`}
          onMouseEnter={() => highlight(category.eventIds)} onMouseLeave={() => highlight(null)} onFocus={() => highlight(category.eventIds)} onBlur={() => highlight(null)}
          onClick={() => { if (onSelect) { highlight(null); onSelect(category.kind, category.name, category.eventIds); } else highlight(category.eventIds); }}>
          <span aria-hidden="true" className={`sa-activity-swatch sa-timeline-color-${category.color}`} data-color={category.color} />
          <span className="sa-timeline-legend-name" title={category.name}>{category.name}</span><span className="sa-timeline-legend-count">{format(category.count)}</span>
        </button></li>;
      })}</ul>
      {data.byName && <p className="sa-timeline-note">Color identifies names. Blank space represents other source records; height shows activity within each source interval.</p>}
    </>}
  </section>;
}

interface FrequencyVisuals {
  categoryByEvent: ReadonlyMap<string, ActivityCategory>;
  uncertainIds: ReadonlySet<string>;
  highlighted: ReadonlySet<string> | null;
  onHighlight: (ids: readonly string[] | null) => void;
}

function FrequencyChart<T extends ActivityFrequency>({ title, rows, empty, onSelect, visuals }: {
  title: string;
  rows: T[];
  empty: string;
  onSelect: (row: T) => void;
  visuals: FrequencyVisuals;
}) {
  const id = useId();
  const maximum = rows.reduce((largest, row) => Math.max(largest, row.count), 1);
  const renderRow = (row: T, index: number) => {
    const colors = new Map<string, { count: number; color: string; uncertain: boolean }>();
    for (const id of row.eventIds) {
      const color = visuals.categoryByEvent.get(id)?.color ?? "other";
      const uncertain = visuals.uncertainIds.has(id);
      const key = `${color}-${uncertain}`;
      const group = colors.get(key) ?? { count: 0, color, uncertain };
      group.count += 1;
      colors.set(key, group);
    }
    const dimmed = visuals.highlighted !== null && !row.eventIds.some((id) => visuals.highlighted!.has(id));
    return <li key={`${row.name}-${index}`}>
    <button type="button" className={`sa-frequency-row${dimmed ? " is-dimmed" : ""}`} onClick={() => { visuals.onHighlight(null); onSelect(row); }} disabled={row.count === 0}
      onMouseEnter={() => visuals.onHighlight(row.eventIds)} onMouseLeave={() => visuals.onHighlight(null)}
      onFocus={() => visuals.onHighlight(row.eventIds)} onBlur={() => visuals.onHighlight(null)}
      aria-label={`${row.name || "Unnamed activity"}: ${format(row.count)} events${row.uncertain ? `, ${format(row.uncertain)} uncertain` : ""}. Show evidence`}>
      <span className="sa-frequency-name" title={row.name}>{row.name || "Unnamed activity"}</span>
      <span className="sa-frequency-count">{format(row.count)}</span>
      <span className="sa-frequency-track" aria-hidden="true">
        {[...colors].map(([key, group]) => <span key={key} data-color={group.color}
          className={`${group.uncertain ? "sa-frequency-uncertain" : "sa-frequency-fill"} sa-timeline-color-${group.color}`}
          style={{ width: `${group.count / maximum * 100}%` }} />)}
      </span>
      {row.uncertain > 0 && <span className="sa-frequency-note">{format(row.uncertain)} uncertain</span>}
    </button>
  </li>;
  };
  return <section className="sa-frequency" aria-labelledby={id}>
    <h4 id={id}>{title}</h4>
    {rows.length ? <ol className="sa-frequency-list" aria-labelledby={id} tabIndex={0}>{rows.map(renderRow)}</ol> : <p className="sa-activity-note">{empty}</p>}
  </section>;
}

export function ActivitySummary({ report, kinds, onSelect, highlightedIds, onHighlight, showTimeline = true }: ActivitySummaryProps) {
  const kindsKey = kinds?.join("|");
  const data = useMemo(() => getActivitySummary(report, kindsFromKey(kindsKey)), [report, kindsKey]);
  const timeline = useMemo(() => getActivityTimeline(report, kindsFromKey(kindsKey)), [report, kindsKey]);
  const [highlighted, highlight] = useHighlight(highlightedIds, onHighlight);
  const categoryByEvent = useMemo(() => new Map(timeline.categories.flatMap((category) => category.eventIds.map((id) => [id, category] as const))), [timeline]);
  const uncertainIds = useMemo(() => new Set(report.events.filter((event) => event.status === "unknown").map((event) => event.id)), [report]);
  const highlightedSet = useMemo(() => highlighted === null ? null : new Set(highlighted), [highlighted]);
  const visuals: FrequencyVisuals = { categoryByEvent, uncertainIds, highlighted: highlightedSet, onHighlight: highlight };
  const heading = useId();
  const singleKind = kinds?.length === 1 ? kinds[0] : undefined;
  const isContext = kinds?.includes("context") && !kinds.includes("tool");
  const isAll = kinds === undefined;
  const totalCalls = data.recordedCalls + data.uncertainCalls;
  const mix = EVENT_KINDS.filter((kind) => kinds === undefined || kinds.includes(kind)).map((kind) => {
    const frequencies = data.frequencies.filter((row) => row.kind === kind);
    return { kind, name: EVENT_LABELS[kind], count: data.counts[kind],
      recorded: frequencies.reduce((sum, row) => sum + row.recorded, 0),
      uncertain: frequencies.reduce((sum, row) => sum + row.uncertain, 0), eventIds: frequencies.flatMap((row) => row.eventIds) };
  });
  const statuses = [
    { key: "success", label: "Success", count: data.statuses.success },
    { key: "error", label: "Error", count: data.statuses.error },
    { key: "observed", label: "No result", count: data.statuses.observed },
    { key: "unknown", label: "Uncertain", count: data.statuses.unknown },
  ] as const;

  return <section className="sa-activity-summary" aria-labelledby={heading}>
    <div className="sa-activity-heading">
      <h3 id={heading}>Activity summary</h3>
      <div className="sa-activity-totals">
        <span><strong>{format(data.eventIds.length)}</strong> evidence events</span>
        {(isAll || totalCalls > 0 || singleKind === "tool" || singleKind === "mcp") && <span><strong>{format(data.recordedCalls)}</strong> recorded calls</span>}
        {data.uncertainCalls > 0 && <span><strong>{format(data.uncertainCalls)}</strong> uncertain calls</span>}
        {data.skillReads > 0 && <span><strong>{format(data.skillReads)}</strong> skill file requests</span>}
      </div>
    </div>
    {data.eventCount === 0 ? <p className="sa-activity-note">No events of this kind were recorded. The source log may omit activity.</p> : <>
      {showTimeline && <ActivityTimeline report={report} kinds={kinds} highlightedIds={highlighted} onHighlight={highlight} onSelect={onSelect} />}

      <div className="sa-activity-charts">
        {isAll && <FrequencyChart visuals={visuals} title="Events by kind" rows={mix} empty="No activity was recorded."
          onSelect={(row) => onSelect(row.kind, row.name, row.eventIds)} />}
        {(isAll || singleKind === "tool") && <FrequencyChart visuals={visuals} title={isAll ? "Most frequent activity" : "Tool calls"}
          rows={data.frequencies.filter((row) => ["tool", "mcp", "skill"].includes(row.kind))}
          empty="No tool calls were recorded in this view."
          onSelect={(row) => onSelect(row.kind, row.name, row.eventIds)} />}
        {(singleKind === "skill" || isContext) && <FrequencyChart visuals={visuals} title="Skill activity"
          rows={data.frequencies.filter((row) => row.kind === "skill")}
          empty="No skill calls or SKILL.md reads were identified. A catalog mention does not establish that a skill was loaded."
          onSelect={(row) => onSelect(row.kind, row.name, row.eventIds)} />}
        {isContext && <FrequencyChart visuals={visuals} title="Context sources" rows={data.frequencies.filter((row) => row.kind === "context" || row.kind === "compaction")}
          empty="No context sources or compactions were recorded." onSelect={(row) => onSelect(row.kind, row.name, row.eventIds)} />}
        {singleKind === "mcp" && <>
          <FrequencyChart visuals={visuals} title="MCP tools" rows={data.frequencies} empty="No MCP calls were identified."
            onSelect={(row) => onSelect(row.kind, row.name, row.eventIds)} />
          <FrequencyChart visuals={visuals} title="MCP servers" rows={data.servers} empty="No server names could be identified from recorded MCP tool names."
            onSelect={(row) => onSelect("mcp", row.query, row.eventIds)} />
        </>}
        {singleKind === "tool" && <FrequencyChart visuals={visuals} title="Command frequency" rows={data.commands}
          empty="No literal command arguments could be read from the recorded shell calls."
          onSelect={(row) => onSelect("tool", row.name, row.eventIds)} />}
      </div>

      {singleKind === "mcp" && data.servers.reduce((total, row) => total + row.count, 0) < data.counts.mcp && <p className="sa-activity-note">
        Server names were identified for {format(data.servers.reduce((total, row) => total + row.count, 0))} of {format(data.counts.mcp)} MCP events. Ambiguous tool names remain in the tools list.
      </p>}

      {singleKind === "tool" && data.literalCommands > 0 && <div className="sa-command-details">
        <p className="sa-activity-note">{format(data.literalCommands)} literal command arguments. Groups use the first executable name; compound scripts count once. Result text is excluded.</p>
        <h4>Recorded command previews</h4>
        <p className="sa-activity-note">Up to three example previews per executable. Open command evidence for every recorded argument.</p>
        <div className="sa-command-previews" role="region" aria-label="Recorded command previews" tabIndex={0}>
          {data.commands.map((row) => <div className="sa-command-example" key={row.name}>
            <h4>{row.name} <span>({format(row.count)})</span></h4>
            {row.examples.map((command, index) => <pre key={index}>{command.length > 1200 ? `${command.slice(0, 1200)}\n… Preview truncated; open evidence for the recorded arguments.` : command}</pre>)}
            <button type="button" className="text-button" onClick={() => onSelect("tool", row.name, row.eventIds)}>Show command evidence</button>
          </div>)}
        </div>
      </div>}

      {totalCalls > 0 && <section className="sa-call-outcomes" aria-label="Call results">
        <h4>Call results</h4>
        <div className="sa-outcome-track" aria-hidden="true">{statuses.filter((status) => status.count > 0).map((status) =>
          <span className={`sa-outcome-${status.key}`} key={status.key} style={{ flexGrow: status.count }} />)}</div>
        <dl>{statuses.map((status) => <div key={status.key}><dt>{status.label}</dt><dd>{format(status.count)}</dd></div>)}</dl>
      </section>}
      {(data.skillReads > 0 || data.uncertainCalls > 0 || data.excludedResults > 0 || data.duplicateEvents > 0) && <p className="sa-activity-note sa-activity-accounting">
        {data.skillReads > 0 && "Skill file requests are evidence of a requested read; they do not add another tool call. "}
        {data.uncertainCalls > 0 && "Uncertain calls may come from unexecuted script branches or incomplete logs. "}
        {(data.excludedResults > 0 || data.duplicateEvents > 0) && `${format(data.excludedResults)} result records and ${format(data.duplicateEvents)} duplicate records are excluded from frequency counts. `}
        Timeline positions follow the full source log.
      </p>}
    </>}
  </section>;
}
