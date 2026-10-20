import {
  ArrowRight,
  ChevronRight,
  FileText,
  History,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import { LANGUAGES } from "../types";
import { formatTime } from "../utils";
import type { ToolSurfaceProps } from "../../../core/tools/contracts";
import { useOcr } from "../OcrProvider";
export default function OcrActivity({ tool }: ToolSurfaceProps) {
  const { preferences, history, openTool, restore, removeHistory } = useOcr();
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
          History is turned off. You can enable it in Settings.
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
        <div className="empty-view">
          <History size={36} strokeWidth={1.3} />
          <h2>A fresh start.</h2>
          <p>
            Your extracted text will appear here when history is enabled.
            <br />
            Images are never saved to history.
          </p>
          <button className="button primary" onClick={() => openTool("ocr")}>
            Extract your first image
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
