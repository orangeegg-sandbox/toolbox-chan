import {
  ArrowRight,
  ChevronRight,
  FileText,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import { LANGUAGES } from "../types";
import { formatTime } from "../utils";
import { EmptyState, type ToolSurfaceProps } from "../../../core/sdk";
import { useOcr } from "../OcrProvider";
export default function OcrActivity({ tool }: ToolSurfaceProps) {
  const { preferences, history, openTool, openOcrSettings, restore, removeHistory } = useOcr();
  return (
    <div className="ocr-tool">
      <div className="view-heading">
        <div>
          <h2>{tool.name}</h2>
          <p className="page-intro">
            Your last 20 extractions, saved only on this device.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={!history.length}
          onClick={() => removeHistory()}
        >
          <Trash2 size={15} />
          Clear history
        </button>
      </div>
      {!preferences.keepHistory && (
        <div className="info-banner">
          <LockKeyhole size={17} />
          <span>History is turned off. Enable it in <button className="text-button" onClick={openOcrSettings}>OCR settings</button>.</span>
        </div>
      )}
      {history.length ? (
        <div className="history-list">
          {history.map((entry) => (
            <article className="history-entry" key={entry.id}>
              <span className="history-icon">
                <FileText size={20} />
              </span>
              <button className="history-open" onClick={() => restore(entry)}>
                <strong>{entry.name}</strong>
                <p>{entry.text.slice(0, 160)}</p>
                <span>
                  {formatTime(entry.createdAt)} ·{" "}
                  {LANGUAGES.find((l) => l.value === entry.language)?.short} ·{" "}
                  {[...entry.text].length} characters
                </span>
              </button>
              <button
                className="icon-button danger-hover"
                aria-label={`Delete ${entry.name}`}
                title="Delete from history"
                onClick={() => removeHistory(entry.id)}
              >
                <Trash2 size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={`Open ${entry.name}`}
                onClick={() => restore(entry)}
              >
                <ChevronRight size={18} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No history yet"
          mascot
          action={
            <button className="button secondary" onClick={() => openTool("ocr")}>
              Open {tool.name}
              <ArrowRight size={15} />
            </button>
          }
        >
          Extracted text appears here when history is on. Images are never
          saved to history.
        </EmptyState>
      )}
    </div>
  );
}
