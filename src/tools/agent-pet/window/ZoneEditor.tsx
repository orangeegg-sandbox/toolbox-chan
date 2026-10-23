import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { MIN_ZONE, type Zone } from "../settings";

interface ZoneEditorProps {
  /** The zone saved now, shown dashed until a new one is drawn. */
  zone: Zone;
  onSave: (zone: Zone) => void;
  onTurnOff: () => void;
  onCancel: () => void;
}

interface Drag {
  pointerId: number;
  x: number;
  y: number;
}

function toZone(a: { x: number; y: number }, b: { x: number; y: number }): Zone {
  const width = window.innerWidth || 1;
  const height = window.innerHeight || 1;
  const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
  const left = clamp(Math.min(a.x, b.x) / width);
  const top = clamp(Math.min(a.y, b.y) / height);
  return { x: left, y: top, width: clamp(Math.max(a.x, b.x) / width) - left, height: clamp(Math.max(a.y, b.y) / height) - top };
}

function boxStyle(zone: Zone) {
  return { left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.width * 100}%`, height: `${zone.height * 100}%` };
}

/**
 * Lets the user drag a box on the real screen: the pets' idle zone. The whole
 * window takes the pointer meanwhile. The pet window cannot take keyboard focus,
 * so the choices are buttons.
 */
export function ZoneEditor({ zone, onSave, onTurnOff, onCancel }: ZoneEditorProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drawn, setDrawn] = useState<Zone | null>(null);

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ pointerId: event.pointerId, x: event.clientX, y: event.clientY });
    setDrawn(null);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDrawn(toZone(drag, { x: event.clientX, y: event.clientY }));
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const box = toZone(drag, { x: event.clientX, y: event.clientY });
    setDrag(null);
    // A click, or a box too thin to see, is not a zone.
    setDrawn(box.width >= MIN_ZONE && box.height >= MIN_ZONE ? box : null);
  }

  return (
    <div
      className="pet-zone-editor"
      data-pet-hit=""
      role="application"
      aria-label="Draw the idle zone"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="pet-zone-box" data-state={drawn ? "old" : "current"} style={boxStyle(zone)} />
      {drawn && <div className="pet-zone-box" data-state="new" style={boxStyle(drawn)} />}
      <div className="pet-zone-toolbar" role="toolbar" aria-label="Idle zone">
        <p>{drawn ? "Save this box as the pets' idle zone?" : "Drag a box where the pets should rest."}</p>
        <button type="button" className="button primary" disabled={!drawn || drag !== null} onClick={() => drawn && onSave(drawn)}>
          Save
        </button>
        <button type="button" className="button secondary" onClick={onTurnOff}>Use the whole bottom</button>
        <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
