import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Clock3, FileText, Folder, FolderTree, RefreshCw, Search } from "lucide-react";
import type { ProjectCoverage } from "./types";
import {
  buildProjectTree, directorySummary, fileStateLabel, filterProjectTree, projectBreadcrumbs, projectMapRectangles,
  projectTreeRows, searchProjectTree, type FileState, type ProjectNode, type ProjectTree, type StructureActivity,
} from "./project-map";
import "./project-map.css";

export interface ProjectMapProps {
  coverage: ProjectCoverage | null;
  project: string | null;
  busy: boolean;
  onScan: (rescan: boolean, includeDependencies: boolean, respectGitignore: boolean) => void;
  available: boolean;
}

// Larger folders use a scrolling grid so every tile keeps a readable target size.
const PROPORTIONAL_MAP_LIMIT = 12;
const STATES: FileState[] = ["read", "write", "both", "untouched", "excluded"];
const SYMBOL: Record<FileState, string> = { read: "R", write: "W", both: "R/W", untouched: "—", excluded: "×" };
const ACTIVITY_LABELS: Record<StructureActivity, string> = { all: "All", touched: "Touched (read or written)", read: "Read", written: "Written", untouched: "Untouched", excluded: "Excluded" };
const UNMATCHED_REASONS: Record<ProjectCoverage["unmatchedFiles"][number]["reason"], string> = {
  "not-in-snapshot": "Not in snapshot", "outside-project": "Outside project", unresolved: "Unresolved path",
};

function StateLabel({ state }: { state: FileState }) {
  return <span className={`pm-state pm-state-${state}`}><span aria-hidden="true">{SYMBOL[state]}</span> {fileStateLabel(state)}</span>;
}

function ActivityBar({ node }: { node: ProjectNode }) {
  return <div className="pm-activity-bar" role="img" aria-label={directorySummary(node)}>
    {(["read", "write", "both", "untouched"] as const).map((state) => node.counts[state] > 0 && <span
      key={state} className={`pm-fill-${state}`} style={{ width: `${node.counts[state] / Math.max(1, node.counts.files) * 100}%` }}
      title={`${fileStateLabel(state)}: ${node.counts[state].toLocaleString()}`} />)}
  </div>;
}

function MapTiles({ tree, nodes, onSelect }: { tree: ProjectTree; nodes: ProjectNode[]; onSelect: (node: ProjectNode) => void }) {
  const scrolling = nodes.length > PROPORTIONAL_MAP_LIMIT;
  const rectangles = scrolling ? [] : projectMapRectangles(nodes.map((node) => node.counts.files || 1));
  return <div className={`pm-mosaic${scrolling ? " pm-mosaic-scroll" : ""}`} aria-label="Folder map entries" tabIndex={0}>
    {nodes.map((node, index) => {
      const rectangle = rectangles[index];
      const preview = node.excluded ? [] : node.children.slice(0, 4).map((path) => tree.nodes.get(path)!);
      const roomy = scrolling || (rectangle.width >= 22 && rectangle.height >= 28);
      return <div className="pm-map-cell" key={node.path} style={rectangle ? { left: `${rectangle.x}%`, top: `${rectangle.y}%`, width: `${rectangle.width}%`, height: `${rectangle.height}%` } : undefined}>
        <div className={`pm-map-tile ${node.kind === "directory" && !node.excluded ? "pm-directory-tile" : `pm-state-${node.state}`}`}>
          <button type="button" className="pm-tile-heading" onClick={() => onSelect(node)} title={`${node.path}\n${directorySummary(node)}`}>
            {node.kind === "directory" ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
            <span><strong>{node.name}</strong><small>{node.kind === "directory" ? (node.excluded ? "Excluded folder" : `${node.counts.files.toLocaleString()} files${node.partial ? " · partial" : ""}`) : fileStateLabel(node.state)}</small></span>
            {node.kind === "directory" && !node.excluded && <ChevronRight size={14} aria-hidden="true" />}
          </button>
          {node.kind === "directory" && !node.excluded && <>
            <ActivityBar node={node} />
            {preview.length > 0 && <span className={`pm-preview-label${roomy ? "" : " pm-compact-preview"}`}>Preview · {preview.length} of {node.children.length.toLocaleString()} entries</span>}
            {preview.length > 0 && <div className={`pm-nested-map${roomy ? "" : " pm-compact-preview"}`} aria-label={`Inside ${node.path}`}>
              {preview.map((child) => <button type="button" key={child.path}
                className={`pm-nested-tile ${child.kind === "file" || child.excluded ? `pm-state-${child.state}` : ""}`}
                title={`${child.path}\n${directorySummary(child)}`} onClick={() => onSelect(child)}>
                {child.kind === "directory" ? <Folder size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
                <span>{child.name}<small>{child.kind === "directory" ? (child.excluded ? "Excluded" : `${child.counts.files.toLocaleString()} files${child.partial ? " · partial" : ""}`) : fileStateLabel(child.state)}</small></span>
              </button>)}
            </div>}
            {node.children.length === 0 && <span className={`pm-empty-folder${roomy ? "" : " pm-compact-preview"}`}>Empty folder</span>}
          </>}
        </div>
      </div>;
    })}
  </div>;
}

export function ProjectMap({ coverage, project, busy, onScan, available }: ProjectMapProps) {
  const [focusPath, setFocusPath] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [activity, setActivity] = useState<StructureActivity>("all");
  const [includeDependencies, setIncludeDependencies] = useState(coverage?.includeDependencies ?? false);
  const [respectGitignore, setRespectGitignore] = useState(coverage?.respectGitignore ?? false);
  const inventory = useMemo(() => coverage ? buildProjectTree(coverage) : null, [coverage]);
  const tree = useMemo(() => inventory ? filterProjectTree(inventory, activity) : null, [inventory, activity]);
  const unmatched = useMemo(() => (coverage?.unmatchedFiles ?? []).filter((file) =>
    activity === "read" ? file.operation === "read" : activity === "written" ? file.operation === "write"
      : file.operation === "read" || file.operation === "write"), [coverage?.unmatchedFiles, activity]);
  const unmatchedPaths = useMemo(() => new Set(unmatched.map((file) => file.path)).size, [unmatched]);
  const focus = tree?.nodes.get(focusPath) ?? tree?.root;
  const selected = selectedPath ? tree?.nodes.get(selectedPath) : undefined;
  const children = useMemo(() => !tree || !focus ? [] : focus.children.map((path) => tree.nodes.get(path)!)
    .sort((a, b) => b.counts.files - a.counts.files || a.name.localeCompare(b.name)), [tree, focus]);
  const breadcrumbs = useMemo(() => tree && focus ? projectBreadcrumbs(tree, focus.path) : [], [tree, focus]);
  const rows = useMemo(() => !tree || !focus ? { rows: [], total: 0 } : deferredQuery.trim()
    ? searchProjectTree(tree, deferredQuery)
    : projectTreeRows(tree, focus.path, expanded), [tree, focus, expanded, deferredQuery]);

  useEffect(() => {
    setFocusPath(""); setSelectedPath(null); setExpanded(new Set()); setQuery(""); setActivity("all");
  }, [project]);
  useEffect(() => {
    if (coverage && !busy) {
      setIncludeDependencies(coverage.includeDependencies);
      setRespectGitignore(coverage.respectGitignore);
    }
  }, [coverage?.includeDependencies, coverage?.respectGitignore, busy]);
  useEffect(() => {
    if (tree && !tree.nodes.has(focusPath)) setFocusPath("");
    if (tree && selectedPath && !tree.nodes.has(selectedPath)) setSelectedPath(null);
  }, [tree, focusPath, selectedPath]);

  const navigate = (node: ProjectNode) => {
    if (node.kind === "directory" && !node.excluded) {
      setFocusPath(node.path); setSelectedPath(null);
    } else {
      setFocusPath(node.parent ?? ""); setSelectedPath(node.path);
    }
    setExpanded(new Set()); setQuery("");
  };
  const scanDisabled = !available || !project || busy;
  const snapshotDate = coverage && coverage.scannedAt > 0 ? new Date(coverage.scannedAt) : null;
  const validSnapshotDate = snapshotDate && Number.isFinite(snapshotDate.getTime()) ? snapshotDate : null;
  const snapshotTime = validSnapshotDate?.toLocaleString() ?? "Time unavailable";

  return <section className="pm-project" aria-label="Project structure and coverage">
    <div className="pm-heading">
      <div><h3><FolderTree size={20} aria-hidden="true" /> Project structure</h3>
        <p>Explore the project’s folders and files, including files the agent never touched.</p></div>
      <button className="button secondary" type="button" disabled={scanDisabled} onClick={() => onScan(coverage !== null, includeDependencies, respectGitignore)}>
        <RefreshCw size={14} aria-hidden="true" /> {coverage ? "Rescan project" : "Scan project structure"}
      </button>
    </div>
    <code className="pm-project-path">{project || coverage?.project || "No project folder was recorded for this session."}</code>
    <div className="pm-scan-options">
      <label className="pm-checkbox"><input type="checkbox" checked={includeDependencies} disabled={scanDisabled}
        onChange={(event) => { const next = event.target.checked; setIncludeDependencies(next); onScan(false, next, respectGitignore); }} />
        Include dependency and build folders</label>
      <label className="pm-checkbox"><input type="checkbox" checked={respectGitignore} disabled={scanDisabled}
        onChange={(event) => { const next = event.target.checked; setRespectGitignore(next); onScan(false, includeDependencies, next); }} />
        Respect .gitignore</label>
      <span className="pm-muted">Options select a cached snapshot or scan once. Rescan refreshes files and ignore rules. .git stays excluded.</span>
    </div>
    {!available && <p className="pm-muted">Project scanning is available in the desktop app.</p>}
    {!coverage && <div className="pm-scan-empty"><FolderTree size={28} aria-hidden="true" /><p>Scan once to build the folder map and directory tree. With ignore rules enabled, only .gitignore files are read.</p></div>}
    {coverage && inventory && tree && focus && <>
      <div className="pm-snapshot"><span className={`pm-snapshot-badge ${coverage.cached ? "" : "pm-snapshot-fresh"}`}><Clock3 size={14} aria-hidden="true" />{coverage.cached ? "Cached snapshot" : "Fresh scan"}</span>
        <time dateTime={validSnapshotDate?.toISOString()}>{snapshotTime}</time>
        <span>{inventory.root.counts.files.toLocaleString()} files · {inventory.root.counts.directories.toLocaleString()} folders</span>
        {coverage.respectGitignore && <span>{coverage.ignoredEntries.toLocaleString()} entries skipped by .gitignore</span>}
      </div>
      {!coverage.complete && <p className="pm-incomplete">Partial inventory: scan limits or inaccessible folders left some entries out. Counts and the map cover the available snapshot.</p>}
      <div className="pm-legend" aria-label="File activity legend">{STATES.map((state) => <StateLabel key={state} state={state} />)}</div>
      <div className="pm-filter-bar">
        <label className="pm-activity-filter"><span>Structure activity</span><select aria-label="Structure activity" value={activity}
          onChange={(event) => setActivity(event.target.value as StructureActivity)}>
          {(Object.entries(ACTIVITY_LABELS) as [StructureActivity, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {activity !== "all" && <button type="button" className="button secondary" onClick={() => setActivity("all")}>Clear structure filter</button>}
      </div>
      {activity !== "all" && <p className="pm-filter-summary" role="status">{ACTIVITY_LABELS[activity]}: {activity === "excluded"
        ? `${tree.root.counts.excluded.toLocaleString()} excluded entries`
        : `${tree.root.counts.files.toLocaleString()} of ${inventory.root.counts.files.toLocaleString()} files`}. Folder paths stay visible; counts reflect this filter.</p>}
      {(activity === "read" || activity === "written" || activity === "touched") && tree.root.counts.files === 0 && <p className="pm-unmatched-explanation">
        No recorded {activity === "read" ? "read" : activity === "written" ? "write" : "read or write"} paths matched included files in this snapshot.
        {unmatchedPaths > 0 && ` ${unmatchedPaths.toLocaleString()} recorded ${activity === "read" ? "read " : activity === "written" ? "write " : ""}${unmatchedPaths === 1 ? "path is" : "paths are"} not mapped.`}
      </p>}
      {unmatched.length > 0 && <details className="pm-unmatched">
        <summary>Recorded paths not mapped ({unmatchedPaths.toLocaleString()})</summary>
        <p>{unmatched.length.toLocaleString()} recorded {unmatched.length === 1 ? "operation" : "operations"}; excluded from map counts. Not in snapshot can mean excluded, ignored, changed, or not scanned. These records do not establish successful access.</p>
        <ul aria-label="Unmapped recorded file operations" tabIndex={0}>
          {unmatched.map((file, index) => <li key={index}>
            <code>{file.path}</code><span className="pm-unmatched-meta"><span>{file.operation}</span><span>{file.evidence}</span><span>{UNMATCHED_REASONS[file.reason]}</span></span>
          </li>)}
        </ul>
      </details>}
      <nav className="pm-breadcrumbs" aria-label="Project map location">
        {breadcrumbs.length > 5 && <><button type="button" onClick={() => navigate(tree.root)}>{tree.root.name}</button><span aria-hidden="true">/ … /</span></>}
        {breadcrumbs.slice(-5).map((node, index) => <span key={node.path}>{index > 0 && <span className="pm-separator" aria-hidden="true">/</span>}<button type="button" aria-current={node.path === focus.path ? "location" : undefined} onClick={() => navigate(node)}>{node.name}</button></span>)}
      </nav>
      <div className="pm-folder-summary"><strong>{activity !== "all" && "Matching: "}{directorySummary(focus)}</strong><code>{focus.path || "/"}</code></div>
      <div className="pm-map-heading"><h4>Folder map</h4><p>{children.length > PROPORTIONAL_MAP_LIMIT
        ? "Scroll through all entries. Equal-size tiles keep folder names readable."
        : <><span className="pm-proportional-note">Area approximates file count. Small and empty entries stay visible.</span><span className="pm-compact-note">Equal-size tiles keep folder names readable in this compact layout.</span></>} Select a folder to explore its contents.</p></div>
      {children.length ? <MapTiles key={`${focus.path}:${activity}`} tree={tree} nodes={children} onSelect={navigate} />
        : <div className="pm-folder-empty">{activity === "all" ? "This folder has no inventoried entries." : "No entries match this activity filter."}</div>}
      {selected && <div className="pm-selection" role="status"><strong>{selected.kind === "directory" ? "Folder" : "File"}: <code>{selected.path}</code></strong><StateLabel state={selected.state} />
        {selected.excluded && <span className="pm-muted">Contents were excluded from this scan. Dependency/build folders can be included above; .git and links stay excluded.</span>}</div>}
      <div className="pm-tree-heading"><div><h4>Directory tree</h4><p>Expand folders, or select a folder name to focus the map.</p></div>
        <label className="pm-search"><span><Search size={14} aria-hidden="true" /> Search all {tree.paths.length.toLocaleString()} {activity !== "all" && "filtered "}paths</span><input type="search" value={query}
          onChange={(event) => setQuery(event.target.value)} placeholder="Find any folder or file" /></label>
      </div>
      <p className="pm-result-count" aria-live="polite">{rows.total.toLocaleString()} {deferredQuery.trim() ? `matching paths across the ${activity === "all" ? "project" : "filtered structure"}` : "visible entries in this folder tree"}</p>
      <ul className="pm-tree" key={`${focus.path}:${activity}:${deferredQuery}`} tabIndex={0} aria-label={deferredQuery.trim() ? "Project path search results" : "Project directory tree"}>
        {rows.rows.map(({ node, depth }) => <li key={node.path} className={`pm-tree-row ${selectedPath === node.path ? "pm-tree-selected" : ""}`}
          style={{ "--pm-depth": Math.min(depth, 12) } as CSSProperties}>
          {node.kind === "directory" && !node.excluded && node.children.length > 0 && !deferredQuery.trim() ? <button type="button" className="pm-expand"
            aria-label={`${expanded.has(node.path) ? "Collapse" : "Expand"} ${node.path}`} aria-expanded={expanded.has(node.path)}
            onClick={() => setExpanded((previous) => { const next = new Set(previous); if (!next.delete(node.path)) next.add(node.path); return next; })}>
            {expanded.has(node.path) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button> : <span className="pm-expand-placeholder" />}
          <button type="button" className="pm-tree-name" title={`${node.path}\n${directorySummary(node)}`} onClick={() => navigate(node)}>
            {node.kind === "directory" ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
            <span>{deferredQuery.trim() ? node.path : node.name}</span>
          </button>
          <span className="pm-tree-summary">{node.kind === "directory" && !node.excluded ? <><span>{node.counts.files.toLocaleString()} files{node.partial ? " · partial" : ""}</span><span>{(node.counts.read + node.counts.both).toLocaleString()} read · {(node.counts.write + node.counts.both).toLocaleString()} written</span></> : <StateLabel state={node.state} />}</span>
        </li>)}
      </ul>
      {rows.total === 0 && <p className="pm-muted">{deferredQuery.trim() ? "No paths match this search." : "No entries in this folder."}</p>}
      <details className="pm-notes"><summary>Snapshot scope and notes{coverage.warnings.length ? ` (${coverage.warnings.length})` : ""}</summary>
        <p>{coverage.basis}</p><p>Untouched means no recorded read or write matched the file. It does not prove what was present in the model’s context.</p>
        {tree.omitted > 0 && <p>{tree.omitted.toLocaleString()} invalid inventory paths could not be shown.</p>}
        {coverage.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
        {coverage.outsideProject.length > 0 && <p>{coverage.outsideProject.length.toLocaleString()} recorded paths are outside this project and do not appear on the map.</p>}
      </details>
    </>}
  </section>;
}
