import {
  ArrowDownToLine,
  Check,
  Clock3,
  Copy,
  FileText,
  ScanLine,
} from "lucide-react";
import { ToolPanel } from "../../../core/sdk";
import { useOcr } from "../OcrProvider";
export default function OcrOutputPanel() {
  const {
    text,
    setText,
    result,
    busy,
    progress,
    copied,
    copy,
    download,
    textCount,
    mode,
    activeRegion,
    setActiveRegion,
    regionTexts,
    editRegionText,
  } = useOcr();
  const comparingRegion = mode === "custom" && activeRegion !== null && activeRegion < regionTexts.length;
  return (
    <ToolPanel
      title="Extracted text"
      step={2}
      aria-label="Extracted text"
      className="output-panel"
      actions={
        <div className="inline-actions">
          <button
            className="icon-button"
            title={comparingRegion ? "Copy all text" : "Copy text"}
            aria-label={comparingRegion ? "Copy all text" : "Copy text"}
            disabled={!text.trim() || busy}
            onClick={() => void copy()}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button
            className="icon-button"
            title={comparingRegion ? "Export all text" : "Export text file"}
            aria-label={comparingRegion ? "Export all text" : "Export text file"}
            disabled={!text.trim() || busy}
            onClick={() => void download()}
          >
            <ArrowDownToLine size={17} />
          </button>
        </div>
      }
      status={result && <span className="result-dot" />}
    >
      {mode === "custom" && regionTexts.length > 0 && !busy && (
        <div className="region-results" aria-label="Compare extracted regions">
          <button className={!comparingRegion ? "selected" : ""} aria-pressed={!comparingRegion} onClick={() => setActiveRegion(null)}>All text</button>
          {regionTexts.map((_, index) => (
            <button key={index} className={activeRegion === index ? "selected" : ""} aria-pressed={activeRegion === index} onClick={() => setActiveRegion(index)}>Region {index + 1}</button>
          ))}
        </div>
      )}
      <div className="output-content">
        {busy ? (
          <div className="output-placeholder working">
            <div className="scan-animation">
              <ScanLine size={32} strokeWidth={1.3} />
            </div>
            <h3>Recognizing text…</h3>
            <p>{progress.status}</p>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuenow={Math.round(progress.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="OCR progress"
            >
              <div style={{ width: `${progress.progress * 100}%` }} />
            </div>
            <span className="progress-percent">
              {Math.round(progress.progress * 100)}%
            </span>
          </div>
        ) : result || text ? (
          <textarea
            className="result-editor"
            aria-label={comparingRegion ? `Recognized text for region ${activeRegion! + 1}` : "Recognized text"}
            spellCheck={false}
            value={comparingRegion ? regionTexts[activeRegion!] : text}
            onChange={(e) => comparingRegion ? editRegionText(activeRegion!, e.target.value) : setText(e.target.value)}
            placeholder="No text found. Try another language, a clearer image, or the Scattered text layout in OCR settings."
          />
        ) : (
          <div className="output-placeholder">
            <FileText size={28} strokeWidth={1.5} aria-hidden="true" />
            <h3>No text yet</h3>
            <p>Add an image, then extract its text to edit, copy, or export it.</p>
          </div>
        )}
      </div>
      <div className="output-meta">
        <span>
          {textCount.toLocaleString()} characters
          {result && result.confidence >= 0
            ? ` · ${Math.round(result.confidence)}% confidence`
            : ""}
        </span>
        <span>
          {result ? (
            <>
              <Clock3 size={12} />
              {result.duration.toFixed(1)}s
            </>
          ) : (
            "Ready"
          )}
        </span>
      </div>
      <div className="output-actions">
        <button
          className="button secondary"
          disabled={!text.trim() || busy}
          onClick={() => void copy()}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied" : comparingRegion ? "Copy all text" : "Copy text"}
        </button>
        <button
          className="text-button"
          disabled={!text.trim() || busy}
          onClick={() => void download()}
        >
          <ArrowDownToLine size={15} />
          {comparingRegion ? "Export all text" : "Export .txt"}
        </button>
      </div>
    </ToolPanel>
  );
}
