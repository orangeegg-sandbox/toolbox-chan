import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  CircleHelp,
  Cloud,
  Lightbulb,
  Maximize2,
  Minimize2,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { Engine } from "../types";
import { modes } from "../constants";
import { errorMessage } from "../utils";
import { ToolPage, SplitPane, type ToolSurfaceProps } from "../../../core/sdk";
import OcrInputPanel from "./OcrInputPanel";
import OcrOutputPanel from "./OcrOutputPanel";
import OcrSettings from "./OcrSettings";
import { sampleImage } from "../services/images";
import { useOcr } from "../OcrProvider";
export default function OcrWorkspace({ tool }: ToolSurfaceProps) {
  const [expanded, setExpanded] = useState(false);
  const comparison = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const settingsPanel = useRef<HTMLElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const {
    source,
    text,
    mode,
    engine,
    busy,
    loadingImage,
    error,
    setError,
    fileInput,
    notify,
    settingsOpen,
    setSettingsOpen,
    openOcrSettings,
    loadFile,
    changeMode,
    changeEngine,
    drop,
  } = useOcr();
  useEffect(() => {
    if (!settingsOpen) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    settingsPanel.current?.focus({ preventScroll: true });
    settingsPanel.current?.scrollIntoView({ block: "start" });
  }, [settingsOpen, expanded]);
  const closeSettings = () => {
    setSettingsOpen(false);
    settingsButton.current?.focus({ preventScroll: true });
    settingsButton.current?.scrollIntoView({ block: "nearest" });
  };
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    comparison.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
      }
      if (event.key === "Tab") {
        const controls = comparison.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        );
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === comparison.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", keydown);
      (previous?.isConnected ? previous : expandButton.current)?.focus();
    };
  }, [expanded]);
  return (
    <ToolPage
      tool={tool}
      className="ocr-tool"
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
      toolbar={
        <div className="workbench-controls">
          <div className="mode-tabs" role="tablist" aria-label="OCR mode">
            {modes.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={mode === item.id}
                title={item.description}
                disabled={
                  busy || (engine === "online" && item.id === "overlay")
                }
                className={mode === item.id ? "selected" : ""}
                onClick={() => changeMode(item.id)}
              >
                <item.icon size={15} />
                {item.name}
              </button>
            ))}
          </div>
          <div className="ocr-toolbar-actions">
            <div className="engine-picker">
              <span>Engine</span>
              <div className="select-wrap compact">
                <select
                  aria-label="OCR engine"
                  value={engine}
                  disabled={busy}
                  onChange={(e) => changeEngine(e.target.value as Engine)}
                >
                  <option value="offline">Offline · Tesseract</option>
                  <option value="online">Online · Vision API</option>
                </select>
                <ChevronDown size={13} />
              </div>
            </div>
            <button
              ref={settingsButton}
              className={`button secondary ocr-settings-button ${settingsOpen ? "selected" : ""}`}
              aria-expanded={settingsOpen}
              aria-controls="ocr-settings-panel"
              onClick={() => settingsOpen ? closeSettings() : openOcrSettings()}
            >
              <Settings2 size={15} />
              OCR settings
            </button>
          </div>
        </div>
      }
      description={
        <div className="mode-description">
          {mode === "simple"
            ? "Extract all the text from your image in one go."
            : mode === "overlay"
              ? "Extract first, then select and copy recognized words directly on the image."
              : "Highlight the areas you need. We’ll read only those regions, in the order you select them."}
          {engine === "online" && (
            <span className="online-disclosure">
              <Cloud size={12} />
              {mode === "custom" ? "Only highlighted crops" : "Your image"} will
              be sent to your configured provider.{" "}
              <button onClick={openOcrSettings}>Configure</button>
            </span>
          )}
        </div>
      }
      footer={!settingsOpen &&
        <div className="under-workspace">
          <span>
            <ShieldCheck size={14} />
            {engine === "offline"
              ? "Images are processed on this device."
              : "Online OCR follows your provider’s data policy."}
          </span>
          <button
            className="text-button sample-button"
            disabled={busy || loadingImage}
            onClick={async () => {
              try {
                await loadFile(await sampleImage());
              } catch (failure) {
                notify(errorMessage(failure), true);
              }
            }}
          >
            Try a sample image
            <ArrowRight size={13} />
          </button>
        </div>
      }
      hint={!settingsOpen &&
        <p className="tips-row">
          <Lightbulb size={14} aria-hidden="true" />
          <span>
            Sharp images and upright text work best. Choose the matching
            language, or highlight only the text you need.
          </span>
        </p>
      }
    >
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
        aria-label="Choose image"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void loadFile(file);
          event.target.value = "";
        }}
      />
      {settingsOpen && (
        <section
          ref={settingsPanel}
          id="ocr-settings-panel"
          className="ocr-settings-panel"
          aria-labelledby="ocr-settings-heading"
          tabIndex={-1}
        >
          <div className="ocr-settings-heading">
            <div>
              <div className="ocr-settings-title">
                <Settings2 size={19} />
                <h2 id="ocr-settings-heading">OCR settings</h2>
              </div>
              <p>Recognition, your online provider, and local history. Changes apply to OCR only.</p>
            </div>
            <button className="button secondary" onClick={closeSettings}>
              <ArrowLeft size={15} />
              Back to workspace
            </button>
          </div>
          <OcrSettings />
        </section>
      )}
      <div
        ref={comparison}
        hidden={settingsOpen}
        className={`ocr-comparison ${expanded ? "is-expanded" : ""}`}
        role={expanded ? "dialog" : "region"}
        aria-modal={expanded ? true : undefined}
        aria-label="Image and text comparison"
        tabIndex={-1}
      >
        <div className="comparison-toolbar">
          <div><strong>Image & text</strong><span>100% shows the image at its original pixel size.</span></div>
          <button
            ref={expandButton}
            className="button secondary"
            disabled={!expanded && !source && !text}
            aria-label={expanded ? "Restore comparison" : "Expand comparison"}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {expanded ? "Restore" : "Expand comparison"}
          </button>
        </div>
        <SplitPane primary={<OcrInputPanel />} secondary={<OcrOutputPanel />} />
        {expanded && <p className="comparison-hint">Press Esc to restore the workspace.</p>}
        {error && (
          <div className="error-banner" role="alert">
            <CircleHelp size={16} />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
