import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  CircleHelp,
  Cloud,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { Engine } from "../types";
import { modes } from "../constants";
import { errorMessage } from "../utils";
import type { ToolSurfaceProps } from "../../../core/tools/contracts";
import { ToolPage, SplitPane } from "../../../core/layout";
import OcrInputPanel from "./OcrInputPanel";
import OcrOutputPanel from "./OcrOutputPanel";
import { sampleImage } from "../services/images";
import { useOcr } from "../OcrProvider";
export default function OcrWorkspace({ tool }: ToolSurfaceProps) {
  const [expanded, setExpanded] = useState(false);
  const comparison = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
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
    openSettings,
    loadFile,
    changeMode,
    changeEngine,
    drop,
  } = useOcr();
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
              <button onClick={() => openSettings()}>Configure</button>
            </span>
          )}
        </div>
      }
      footer={
        <div className="under-workspace">
          <span>
            <ShieldCheck size={14} />
            {engine === "offline"
              ? "Your images stay on your device. Always."
              : "Online OCR uses your provider’s data policy."}
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
            <Sparkles size={14} />
            Try a sample image
            <ArrowRight size={13} />
          </button>
        </div>
      }
      hint={
        <div className="tips-row">
          <div className="tip-icon">
            <WandSparkles size={20} strokeWidth={1.5} />
          </div>
          <div>
            <strong>A small tip for better results</strong>
            <p>
              Sharp images and upright text work best. Choose the matching
              language, or highlight just the text you need.
            </p>
          </div>
        </div>
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
      <div
        ref={comparison}
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
