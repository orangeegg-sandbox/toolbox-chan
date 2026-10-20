import {
  ChevronDown,
  Clipboard,
  ImagePlus,
  LoaderCircle,
  ScanLine,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Language } from "../types";
import { LANGUAGES } from "../types";
import { errorMessage } from "../utils";
import { ToolPanel } from "../../../core/layout";
import ImageWorkspace from "./ImageWorkspace";
import { rotatedImage } from "../services/images";
import { useOcr } from "../OcrProvider";
export default function OcrInputPanel() {
  const {
    preferences,
    source,
    setSource,
    mode,
    engine,
    regions,
    setRegions,
    activeRegion,
    setActiveRegion,
    words,
    setWords,
    busy,
    loadingImage,
    setError,
    dragging,
    setDragging,
    fileInput,
    dragDepth,
    modifier,
    notify,
    updatePreferences,
    loadFile,
    pasteImage,
    cancel,
    extract,
  } = useOcr();
  return (
    <ToolPanel
      title="Your image"
      step={1}
      aria-label="Source image"
      className="input-panel"
      actions={
        <button
          className="text-button"
          disabled={busy || loadingImage}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={14} />
          {source ? "Replace" : "Upload image"}
        </button>
      }
    >
      <div
        className={`input-content ${dragging ? "is-dragging" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("Files")) {
            dragDepth.current++;
            setDragging(true);
          }
        }}
        onDragLeave={() => {
          dragDepth.current--;
          if (dragDepth.current <= 0) setDragging(false);
        }}
      >
        {loadingImage ? (
          <div className="dropzone">
            <LoaderCircle className="spin" size={30} />
            <h3>Opening your image…</h3>
          </div>
        ) : source ? (
          <ImageWorkspace
            key={source.url}
            source={source}
            mode={mode}
            words={words}
            regions={regions}
            activeRegion={activeRegion}
            onActiveRegion={setActiveRegion}
            busy={busy}
            onRegions={setRegions}
            onRemove={() => {
              setSource(null);
              setWords([]);
              setRegions([]);
              setError("");
            }}
            onRotate={async () => {
              try {
                await loadFile(await rotatedImage(source));
              } catch (failure) {
                notify(errorMessage(failure), true);
              }
            }}
          />
        ) : (
          <div
            className="dropzone"
            onClick={() => {
              if (!busy) fileInput.current?.click();
            }}
          >
            <div className="upload-illustration" aria-hidden="true">
              <div className="illustration-back" />
              <div className="illustration-page">
                <div className="mini-image">
                  <span />
                  <i />
                  <b />
                </div>
                <div className="illustration-lines">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <span className="illustration-spark">
                <Sparkles size={19} />
              </span>
              <span className="illustration-plus">+</span>
            </div>
            <h3>Drop an image here</h3>
            <p>or choose a file from your computer</p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                fileInput.current?.click();
              }}
            >
              <ImagePlus size={16} />
              Choose image
            </button>
            <div className="dropzone-or">
              <span />
              or
              <span />
            </div>
            <button
              className="paste-button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                void pasteImage();
              }}
            >
              <Clipboard size={14} />
              Paste from clipboard<kbd>{modifier} V</kbd>
            </button>
            <span className="file-types">
              PNG, JPG, WebP, BMP, GIF · up to 25 MB
            </span>
          </div>
        )}
      </div>
      <div className="input-settings">
        <label htmlFor="language">Recognition language</label>
        <div className="select-wrap">
          <span className="language-glyph">文 A</span>
          <select
            id="language"
            value={preferences.language}
            disabled={busy}
            onChange={(e) =>
              updatePreferences({
                language: e.target.value as Language,
              })
            }
          >
            {LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
      </div>
      <div className="panel-action">
        {busy ? (
          <button className="button secondary full-width" onClick={cancel}>
            <X size={16} />
            Cancel recognition
          </button>
        ) : (
          <button
            className="button primary full-width"
            disabled={!source || loadingImage}
            onClick={() => void extract()}
          >
            <ScanLine size={17} />
            {engine === "online" ? "Upload & extract text" : "Extract text"}
            <kbd>{modifier} ↵</kbd>
          </button>
        )}
      </div>
    </ToolPanel>
  );
}
