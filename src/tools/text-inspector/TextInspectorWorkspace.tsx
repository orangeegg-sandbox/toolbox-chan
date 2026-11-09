import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Copy, Download, ScanText, Trash2 } from "lucide-react";
import { EmptyState, SplitPane, ToolPage, ToolPanel, type ToolSurfaceProps } from "../../core/sdk";
import type { Change, Character, CleanRules, Finding, ScanResult } from "./engine";
import { useTextInspector } from "./TextInspectorProvider";

const PREVIEW_SIZE = 400;
const TABLE_SIZE = 100;
const FINDINGS_SIZE = 12;
type BooleanRule = Exclude<keyof CleanRules, "lineEndings">;
const RULES: readonly { key: BooleanRule; label: string; detail?: string }[] = [
  { key: "removeControls", label: "Remove non-text controls", detail: "Keep tabs and all recognized line endings." },
  { key: "removeLeadingBom", label: "Remove leading BOM" },
  { key: "removeZeroWidthSpace", label: "Remove zero-width space" },
  { key: "removeWordJoiner", label: "Remove word joiner" },
  { key: "removeBom", label: "Remove other BOM characters" },
  { key: "removeSoftHyphen", label: "Remove soft hyphen" },
  { key: "removeDirection", label: "Remove direction controls" },
  { key: "convertSpaces", label: "Convert unusual spaces", detail: "Replace each unusual horizontal space with one ordinary space." },
];

function Pager({ label, page, count, size, onChange }: {
  label: string; page: number; count: number; size: number; onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / size));
  if (pages <= 1) return null;
  return <nav className="text-inspector-pager" aria-label={`${label} pages`}>
    <button className="button secondary" onClick={() => onChange(page - 1)} disabled={page === 0} aria-label={`Previous ${label.toLowerCase()} page`}>Previous</button>
    <span>Page {page + 1} of {pages}</span>
    <button className="button secondary" onClick={() => onChange(page + 1)} disabled={page >= pages - 1} aria-label={`Next ${label.toLowerCase()} page`}>Next</button>
  </nav>;
}

function characterAction(character: Character, changes: Map<number, Change>) {
  const change = changes.get(character.start);
  return change ? change.reason : "Keep";
}

function TextPreview({ scan, page, marked, showSpaces, selected, onSelect, label }: {
  scan: ScanResult; page: number; marked: boolean; showSpaces: boolean; selected?: number;
  onSelect?: (character: Character) => void; label: string;
}) {
  const characters = scan.characters;
  const start = page * PREVIEW_SIZE;
  const end = Math.min(start + PREVIEW_SIZE, characters.length);
  const nodes: ReactNode[] = [];
  let run = "";
  let runStart = start;
  const flush = () => {
    if (run) nodes.push(<span key={`text-${runStart}`} className="text-inspector-text-run">{run}</span>);
    run = "";
  };
  for (let index = start; index < end; index++) {
    const character = characters[index];
    // Pairs spanning pages remain visible as their separate CR and LF points.
    const pair = character.codePoint === 13 && index + 1 < end && characters[index + 1]?.codePoint === 10;
    const neutralize = character.group === "direction" || character.group === "control" || character.group === "invalid";
    const showMarker = neutralize || marked && character.group !== "text" && (character.codePoint !== 32 || showSpaces);
    const isSelected = selected === character.index || pair && selected === character.index + 1;
    if (showMarker || isSelected) {
      flush();
      const content = showMarker ? pair ? "[CRLF]" : character.marker : character.value;
      const name = pair ? "Carriage return + line feed, U+000D U+000A" : `${character.name}, ${character.code}`;
      const className = `text-inspector-marker group-${character.group}${isSelected ? " selected" : ""}`;
      nodes.push(onSelect
        ? <button key={character.index} type="button" className={className} title={name} aria-label={`Inspect ${name} at position ${character.index}`} aria-pressed={isSelected} data-character-index={character.index} onClick={() => onSelect(character)}>{content}</button>
        : <span key={character.index} className={className} title={name}>{content}</span>);
      if (character.newline || pair) nodes.push("\n");
    } else {
      if (!run) runStart = index;
      run += character.newline || pair ? "\n" : character.value;
    }
    if (pair) index++;
  }
  flush();
  return <div className="text-inspector-preview" role="region" aria-label={label} dir="ltr">{nodes}</div>;
}

function CharacterTable({ characters, page, changes, selected, onSelect }: {
  characters: Character[]; page: number; changes: Map<number, Change>; selected: number | null;
  onSelect: (character: Character) => void;
}) {
  return <div className="text-inspector-table-wrap"><table className="text-inspector-table" aria-label="All characters in logical order">
    <thead><tr><th>Index</th><th>Character</th><th>Name / code point</th><th>Line:column</th><th>Action</th></tr></thead>
    <tbody>{characters.slice(page * TABLE_SIZE, (page + 1) * TABLE_SIZE).map(character => <tr key={character.index}>
      <td>{character.index}</td>
      <td><button className="text-inspector-character" aria-pressed={selected === character.index} data-character-index={character.index} aria-label={`Inspect ${character.code} at position ${character.index}`} onClick={() => onSelect(character)}><bdi>{character.marker}</bdi></button></td>
      <td>{character.name}<br /><code>{character.code}</code></td>
      <td>{character.line}:{character.column}</td>
      <td>{characterAction(character, changes)}</td>
    </tr>)}</tbody>
  </table></div>;
}

function Findings({ findings, changes, selected, onSelect }: {
  findings: Finding[]; changes: Map<number, Change>; selected: Character | undefined;
  onSelect: (character: Character) => void;
}) {
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(findings.length / FINDINGS_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const selectedFinding = findings.find(finding => finding.codePoint === selected?.codePoint);
  const occurrence = selectedFinding?.occurrences.findIndex(item => item.index === selected?.index) ?? -1;
  return <ToolPanel title="Character findings">
    {findings.length === 0 ? <p className="text-inspector-note">No hidden or formatting characters found in the implemented categories.</p> : <>
      <div className="text-inspector-table-wrap"><table className="text-inspector-table" aria-label="Hidden and formatting character types">
        <thead><tr><th>Character</th><th>Name / code point</th><th>Occurrences</th><th>Output action</th></tr></thead>
        <tbody>{findings.slice(currentPage * FINDINGS_SIZE, (currentPage + 1) * FINDINGS_SIZE).map(finding => {
          const actions = new Set(finding.occurrences.map(character => characterAction(character, changes)));
          return <tr key={finding.codePoint}>
            <td><button className={`text-inspector-marker group-${finding.group}`} aria-label={`Find ${finding.name}`} onClick={() => onSelect(finding.occurrences[0])}>{finding.marker}</button></td>
            <td>{finding.name}<br /><code>{finding.code}</code></td>
            <td>{finding.occurrences.length}</td>
            <td>{actions.size === 1 ? [...actions][0] : "Mixed — inspect occurrences"}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <Pager label="Findings" page={currentPage} count={findings.length} size={FINDINGS_SIZE} onChange={setPage} />
    </>}
    {selected && <div className="text-inspector-detail" role="status" aria-live="polite">
      <p><strong>{selected.name}</strong> · {selected.code} · Position {selected.index} · Line {selected.line}, column {selected.column}</p>
      <p>{characterAction(selected, changes)}. Positions count code points; one emoji may contain several.</p>
      {selectedFinding && selectedFinding.occurrences.length > 1 && <div className="text-inspector-occurrences">
        <button className="button secondary" disabled={occurrence <= 0} onClick={() => onSelect(selectedFinding.occurrences[occurrence - 1])}>Previous occurrence</button>
        <span>Occurrence {occurrence + 1} of {selectedFinding.occurrences.length}</span>
        <button className="button secondary" disabled={occurrence >= selectedFinding.occurrences.length - 1} onClick={() => onSelect(selectedFinding.occurrences[occurrence + 1])}>Next occurrence</button>
      </div>}
    </div>}
  </ToolPanel>;
}

export default function TextInspectorWorkspace({ tool }: ToolSurfaceProps) {
  const state = useTextInspector();
  const [sourceView, setSourceView] = useState<"marked" | "all">("marked");
  const [sourcePage, setSourcePage] = useState(0);
  const [outputPage, setOutputPage] = useState(0);
  const [showSpaces, setShowSpaces] = useState(true);
  const [outputMarkers, setOutputMarkers] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const originalRef = useRef<HTMLDivElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const analysis = state.analysis;
  const changeMap = useMemo(() => new Map(analysis?.changes.map(change => [change.start, change]) ?? []), [analysis]);
  const sourceSize = sourceView === "marked" ? PREVIEW_SIZE : TABLE_SIZE;
  const selectedCharacter = selected ? analysis?.source.characters[selected - 1] : undefined;
  const canOutput = Boolean(state.source && analysis && !analysis.source.invalidCount && !analysis.result.invalidCount && !state.busy);
  const reviewCount = analysis?.result.findings.filter(finding => !["formatting", "language"].includes(finding.group)).reduce((count, finding) => count + finding.occurrences.length, 0) ?? 0;
  useEffect(() => { setSourcePage(0); setSelected(null); }, [state.sourceVersion]);
  useEffect(() => { setOutputPage(0); }, [analysis]);
  useEffect(() => {
    if (pendingFocus.current === null) return;
    const target = originalRef.current?.querySelector<HTMLButtonElement>(`[data-character-index="${pendingFocus.current}"]`);
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    pendingFocus.current = null;
  }, [focusRequest]);
  function selectCharacter(character: Character) {
    const index = character.index - 1;
    const samePagePair = sourceView === "marked" && character.codePoint === 10 && analysis?.source.characters[index - 1]?.codePoint === 13
      && Math.floor((index - 1) / PREVIEW_SIZE) === Math.floor(index / PREVIEW_SIZE);
    const offset = samePagePair ? index - 1 : index;
    pendingFocus.current = offset + 1;
    setSourcePage(Math.floor(offset / sourceSize));
    setSelected(character.index);
    setFocusRequest(request => request + 1);
  }
  function setView(view: "marked" | "all") {
    setSourceView(view);
    setSourcePage(0);
    setSelected(null);
  }
  return <ToolPage tool={tool} className="text-inspector-tool"
    toolbar={<div className="text-inspector-toolbar"><p>Text stays on this device and is kept only for this app session.</p><button className="button secondary" disabled={state.busy || !state.source && !state.error} onClick={() => { state.clear(); pasteRef.current?.focus(); }}><Trash2 size={16} />Clear text</button></div>}
    hint={<p className="text-inspector-note">A hidden character does not establish that it was injected. Clipboard applications may normalize line endings before or after inspection.</p>}>
    <div className="text-inspector-paste">
      <label htmlFor="text-inspector-paste">Paste text to inspect</label>
      <textarea id="text-inspector-paste" ref={pasteRef} readOnly disabled={state.busy} value="" rows={2} placeholder="Focus here and paste. A new paste replaces the current text." aria-describedby="text-inspector-limit" onPaste={event => { event.preventDefault(); state.replaceSource(event.clipboardData.types.includes("text/plain") ? event.clipboardData.getData("text/plain") : null); }} />
      <p id="text-inspector-limit">Up to 100,000 UTF-16 code units. The pasted source is retained unchanged.</p>
    </div>
    {state.error && <div className="error-banner" role="alert">{state.error}</div>}
    {state.outputError && <div className="error-banner" role="alert">{state.outputError}</div>}
    {!analysis ? <EmptyState title="Paste text to inspect its characters" icon={ScanText}>Reveal hidden characters, inspect Unicode values, and choose what to clean.</EmptyState> : <>
      <SplitPane primary={<ToolPanel title="Original text" status={<span className="small-tag">{analysis.source.codePointCount.toLocaleString()} code points · {analysis.source.newlineCount.toLocaleString()} line breaks</span>}>
        <div className="text-inspector-view-controls" role="group" aria-label="Original text view">
          <button className="button secondary" aria-pressed={sourceView === "marked"} onClick={() => setView("marked")}>Marked text</button>
          <button className="button secondary" aria-pressed={sourceView === "all"} onClick={() => setView("all")}>All characters</button>
          {sourceView === "marked" && <label className="text-inspector-check"><input type="checkbox" checked={showSpaces} onChange={event => setShowSpaces(event.target.checked)} />Show ordinary spaces</label>}
        </div>
        <div ref={originalRef}>{sourceView === "marked"
          ? <TextPreview scan={analysis.source} page={sourcePage} marked showSpaces={showSpaces} selected={selected ?? undefined} onSelect={selectCharacter} label="Marked original text" />
          : <CharacterTable characters={analysis.source.characters} page={sourcePage} changes={changeMap} selected={selected} onSelect={selectCharacter} />}</div>
        <Pager label="Original text" page={sourcePage} count={analysis.source.codePointCount} size={sourceSize} onChange={setSourcePage} />
        <p className="text-inspector-note">Markers expose formatting. All characters lists every code point in stored order.</p>
      </ToolPanel>} secondary={<ToolPanel title="Cleaned text" status={<span className="small-tag">{analysis.result.codePointCount.toLocaleString()} code points · {analysis.result.newlineCount.toLocaleString()} line breaks</span>}>
        <div className="text-inspector-view-controls"><label className="text-inspector-check"><input type="checkbox" checked={outputMarkers} onChange={event => setOutputMarkers(event.target.checked)} />Show formatting</label></div>
        {analysis.output.length ? <TextPreview scan={analysis.result} page={outputPage} marked={outputMarkers} showSpaces label="Cleaned text preview" /> : <p className="text-inspector-note">Cleaning produced an empty string. Copy or save will output empty text.</p>}
        <Pager label="Cleaned text" page={outputPage} count={analysis.result.codePointCount} size={PREVIEW_SIZE} onChange={setOutputPage} />
        <p className="text-inspector-summary" role="status" aria-label="Cleaning summary" aria-live="polite">{analysis.removedCount} removed · {analysis.convertedCount} spaces or line endings converted · {reviewCount} to review</p>
        {!!(analysis.source.invalidCount || analysis.result.invalidCount) && <div className="error-banner" role="alert">Source or output contains unpaired surrogates. Copy and save are blocked to prevent silent replacement.</div>}
        <fieldset className="text-inspector-rules" disabled={state.busy}>
          <legend>Cleaning choices</legend>
          {RULES.map(rule => <label key={rule.key} className="text-inspector-check"><input type="checkbox" aria-label={rule.label} aria-describedby={rule.detail ? `text-inspector-${rule.key}-detail` : undefined} checked={state.rules[rule.key]} onChange={event => state.changeRules({ ...state.rules, [rule.key]: event.target.checked })} /><span>{rule.label}{rule.detail && <small id={`text-inspector-${rule.key}-detail`}>{rule.detail}</small>}</span></label>)}
          <div className="text-inspector-endings"><label htmlFor="text-inspector-endings">Line endings</label><div className="select-wrap"><select id="text-inspector-endings" value={state.rules.lineEndings} onChange={event => state.changeRules({ ...state.rules, lineEndings: event.target.value as CleanRules["lineEndings"] })}><option value="preserve">Preserve original</option><option value="lf">Convert to LF</option><option value="crlf">Convert to CRLF</option></select><ChevronDown size={14} /></div></div>
          <p className="text-inspector-rule-note">Chinese, emoji joiners, variation selectors, and accents are kept. Removing hidden formatting or direction controls can change language, layout, or meaning.</p>
        </fieldset>
        <div className="text-inspector-output-actions"><button className="button primary" disabled={!canOutput} onClick={() => void state.copy()}><Copy size={16} />Copy cleaned text</button><button className="button secondary" disabled={!canOutput} onClick={() => void state.save()}><Download size={16} />Save .txt</button></div>
      </ToolPanel>} />
      <Findings findings={analysis.source.findings} changes={changeMap} selected={selectedCharacter} onSelect={selectCharacter} />
    </>}
  </ToolPage>;
}
