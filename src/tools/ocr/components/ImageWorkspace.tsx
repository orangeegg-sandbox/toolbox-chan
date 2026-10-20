import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  Hand,
  Highlighter,
  MousePointer2,
  RotateCw,
  Scan,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { OcrMode, OcrWord, Region, SourceImage } from "../types";

interface Props {
  source: SourceImage;
  mode: OcrMode;
  words: OcrWord[];
  regions: Region[];
  activeRegion: number | null;
  busy: boolean;
  onActiveRegion: (index: number | null) => void;
  onRegions: (regions: Region[]) => void;
  onRotate: () => void;
  onRemove: () => void;
}
const regionStyle = (r: Region) => ({
  left: `${r.x * 100}%`,
  top: `${r.y * 100}%`,
  width: `${r.width * 100}%`,
  height: `${r.height * 100}%`,
});
const zoomSteps = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
export default function ImageWorkspace({
  source,
  mode,
  words,
  regions,
  activeRegion,
  busy,
  onActiveRegion,
  onRegions,
  onRotate,
  onRemove,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const panStart = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Region | null>(null);
  const [zoom, setZoom] = useState<number | "fit">(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState(false);
  const [panning, setPanning] = useState(false);
  const fit =
    size.width && size.height
      ? Math.min(
          1,
          (size.width - 32) / source.width,
          (size.height - 32) / source.height,
        )
      : 1;
  const scale = zoom === "fit" ? fit : zoom;
  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const changeZoom = (next: number | "fit") => {
    const frame = viewport.current!;
    const bounds = stage.current!.getBoundingClientRect();
    const frameBounds = frame.getBoundingClientRect();
    zoomAnchor.current = {
      x: clamp(
        (frameBounds.left + frame.clientWidth / 2 - bounds.left) / bounds.width,
      ),
      y: clamp(
        (frameBounds.top + frame.clientHeight / 2 - bounds.top) / bounds.height,
      ),
    };
    setZoom(next);
  };
  useLayoutEffect(() => {
    const frame = viewport.current!;
    const anchor = zoomAnchor.current;
    if (!anchor) return;
    const bounds = stage.current!.getBoundingClientRect();
    const frameBounds = frame.getBoundingClientRect();
    frame.scrollLeft +=
      bounds.left - frameBounds.left + bounds.width * anchor.x - frame.clientWidth / 2;
    frame.scrollTop +=
      bounds.top - frameBounds.top + bounds.height * anchor.y - frame.clientHeight / 2;
    zoomAnchor.current = null;
  }, [scale]);
  useEffect(() => {
    if (activeRegion === null || !regions[activeRegion]) return;
    const region = regions[activeRegion];
    const frame = viewport.current!;
    const bounds = stage.current!.getBoundingClientRect();
    const frameBounds = frame.getBoundingClientRect();
    frame.scrollLeft +=
      bounds.left - frameBounds.left +
      (region.x + region.width / 2) * bounds.width - frame.clientWidth / 2;
    frame.scrollTop +=
      bounds.top - frameBounds.top +
      (region.y + region.height / 2) * bounds.height - frame.clientHeight / 2;
  }, [activeRegion, regions]);
  const point = (event: PointerEvent) => {
    const bounds = stage.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button === 1 || (pan && event.button === 0)) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panStart.current = {
        x: event.clientX,
        y: event.clientY,
        left: event.currentTarget.scrollLeft,
        top: event.currentTarget.scrollTop,
      };
      setPanning(true);
      return;
    }
    if (
      mode !== "custom" ||
      busy ||
      regions.length >= 12 ||
      event.button !== 0 ||
      !stage.current?.contains(event.target as Node)
    ) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = point(event);
    setDraft(null);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (panStart.current) {
      event.currentTarget.scrollLeft = panStart.current.left - event.clientX + panStart.current.x;
      event.currentTarget.scrollTop = panStart.current.top - event.clientY + panStart.current.y;
      return;
    }
    if (!start.current) return;
    const end = point(event);
    setDraft({
      x: Math.min(start.current.x, end.x),
      y: Math.min(start.current.y, end.y),
      width: Math.abs(end.x - start.current.x),
      height: Math.abs(end.y - start.current.y),
    });
  };
  const resetPointer = () => {
    start.current = null;
    panStart.current = null;
    setPanning(false);
    setDraft(null);
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current) {
      const end = point(event);
      const region = {
        x: Math.min(start.current.x, end.x),
        y: Math.min(start.current.y, end.y),
        width: Math.abs(end.x - start.current.x),
        height: Math.abs(end.y - start.current.y),
      };
      const bounds = stage.current!.getBoundingClientRect();
      if (region.width * bounds.width >= 4 && region.height * bounds.height >= 4)
        onRegions([...regions, region]);
    }
    resetPointer();
  };
  return (
    <div className="image-workspace">
      <div className="image-toolbar">
        <span>
          {mode === "custom" ? <><Highlighter size={14} />{regions.length} / 12 regions</>
            : mode === "overlay" ? <><MousePointer2 size={14} />{words.length ? "Drag to select text" : "Extract to reveal text"}</>
              : "Image preview"}
        </span>
        <div className="inline-actions zoom-actions">
          <button className="icon-button" title="Zoom out" aria-label="Zoom out" disabled={scale <= zoomSteps[0]} onClick={() => changeZoom([...zoomSteps].reverse().find((value) => value < scale - 0.001) ?? zoomSteps[0])}><ZoomOut size={16} /></button>
          <select className="zoom-select" aria-label="Image zoom" value={zoom} onChange={(event) => changeZoom(event.target.value === "fit" ? "fit" : Number(event.target.value))}>
            <option value="fit">Fit · {Math.round(fit * 100)}%</option>
            {zoomSteps.map((value) => <option key={value} value={value}>{value * 100}%</option>)}
          </select>
          <button className="icon-button" title="Zoom in" aria-label="Zoom in" disabled={scale >= 4} onClick={() => changeZoom(zoomSteps.find((value) => value > scale + 0.001) ?? 4)}><ZoomIn size={16} /></button>
          <button className="text-button" title="Fit the whole image in the preview" aria-label="Fit image" aria-pressed={zoom === "fit"} onClick={() => changeZoom("fit")}><Scan size={14} />Fit</button>
          <button className="text-button" title="One image pixel per screen pixel" aria-label="Actual size (100%)" aria-pressed={zoom === 1} onClick={() => changeZoom(1)}>100%</button>
        </div>
        <div className="inline-actions image-edit-actions">
          {mode === "custom" && <button className={`icon-button ${!pan ? "selected" : ""}`} title="Draw regions" aria-label="Draw regions" aria-pressed={!pan} onClick={() => setPan(false)}><Highlighter size={16} /></button>}
          <button className={`icon-button ${pan ? "selected" : ""}`} title="Pan image by dragging (or use the middle mouse button)" aria-label="Pan image" aria-pressed={pan} onClick={() => setPan(!pan)}><Hand size={16} /></button>
          {mode === "custom" && <>
            <button className="icon-button" title="Undo last highlight" aria-label="Undo last highlight" disabled={busy || !regions.length} onClick={() => onRegions(regions.slice(0, -1))}><Undo2 size={16} /></button>
            <button className="text-button" disabled={busy} onClick={() => onRegions([{ x: 0, y: 0, width: 1, height: 1 }])}>Select all</button>
          </>}
          <button className="icon-button" title="Rotate clockwise" aria-label="Rotate clockwise" disabled={busy} onClick={onRotate}><RotateCw size={16} /></button>
          <button className="icon-button danger-hover" title="Remove image" aria-label="Remove image" disabled={busy} onClick={onRemove}><Trash2 size={16} /></button>
        </div>
      </div>
      <div ref={viewport} className={`image-scroll ${pan ? "pan-mode" : ""} ${panning ? "is-panning" : ""}`} role="region" aria-label="Image preview" tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={resetPointer} onLostPointerCapture={resetPointer}>
        <div className="image-canvas">
          <div ref={stage} className={`image-stage ${mode === "custom" && !pan ? "highlight-mode" : ""}`} style={{ width: source.width * scale, height: source.height * scale }}>
            <img src={source.url} alt={source.name} draggable={false} />
            {mode === "overlay" && <div className="text-overlay" aria-label="Selectable recognized text">
              {words.map((word, index) => <span key={index} style={{ ...regionStyle(word), fontSize: `${((word.height * source.height) / source.width) * 100}cqw` }} title={word.text}>{word.text}{" "}</span>)}
            </div>}
            {mode === "custom" && <div className="highlights" aria-hidden="true">
              {regions.map((region, index) => <div className={`highlight-region ${activeRegion === index ? "selected" : ""}`} key={index} style={regionStyle(region)}><b>{index + 1}</b></div>)}
              {draft && <div className="highlight-region draft" style={regionStyle(draft)} />}
            </div>}
          </div>
        </div>
      </div>
      {mode === "custom" && regions.length > 0 && <div className="region-list" aria-label="Selected regions">
        <span>Compare</span>
        {regions.map((_, index) => <button key={index} aria-label={`Region ${index + 1}`} aria-pressed={activeRegion === index} onClick={() => onActiveRegion(activeRegion === index ? null : index)}>{index + 1}</button>)}
      </div>}
      <p className="image-hint">
        {mode === "custom" ? <Highlighter size={13} /> : <Hand size={13} />}
        {pan ? "Drag to pan. Switch off the hand tool to select text or draw regions." : mode === "custom" ? "Draw regions in reading order. Use the hand tool or scroll to move around." : "Scroll to inspect the image, or use the hand tool to pan."}
      </p>
      <div className="file-meta">
        <span className="truncate">{source.name}</span>
        <span>{source.width.toLocaleString()} × {source.height.toLocaleString()} · {source.bytes < 1024 * 1024 ? `${Math.max(1, Math.round(source.bytes / 1024))} KB` : `${(source.bytes / 1024 / 1024).toFixed(1)} MB`}</span>
      </div>
    </div>
  );
}
