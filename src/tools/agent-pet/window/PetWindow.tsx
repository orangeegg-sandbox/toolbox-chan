import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AGENT_IDS, getPetState, PET_EMOTES, runPetAction, subscribePetEvents, subscribePetVisibility,
  type AgentId, type PetBadgeEntry, type PetEvent, type ToolSurfaceProps,
} from "../../../core/sdk";
import { PET_BY_AGENT } from "../pets";
import { PET_SIZES, usePetSettings } from "../settings";
import { applyPetEvent, clickPet, createBook, expireSessions, petView, type PetBook } from "../model/petModel";
import {
  createBody, dragBody, emoteBody, fitBody, grabBody, releaseBody, stepBody, wakeBody, type Body, type Point,
} from "../model/motion";
import { BASELINE, FRAME_SIZE } from "../sprites/animations";
import { preloadFrames } from "../sprites/library";
import { SpritePlayer } from "../sprites/SpritePlayer";
import { reportPetWindow, subscribeNativePointer } from "./nativeWindow";

const EXPIRE_EVERY_MS = 30_000;
const DRAG_THRESHOLD = 5;
/** About 30 frames per second is smooth enough for the pets and halves the work of a screen-sized window. */
const FRAME_MS = 1000 / 32;

interface Press {
  agent: AgentId;
  pointerId: number;
  start: Point;
  dragging: boolean;
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The desktop pets. Everything they show comes from pet events; they never call an agent. */
export default function PetWindow(_props: ToolSurfaceProps) {
  const [settings] = usePetSettings();
  const [trayVisible, setTrayVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [book, setBook] = useState<PetBook>(() => createBook(Date.now()));
  const [area, setArea] = useState(viewport);
  const [, setFrame] = useState(0);
  const [hovered, setHovered] = useState<AgentId | null>(null);
  const bodies = useRef(new Map<AgentId, Body>());
  const emotes = useRef(new Map<AgentId, number>());
  const cursor = useRef<Point | null>(null);
  const press = useRef<Press | null>(null);
  const bookRef = useRef(book);
  bookRef.current = book;

  const size = PET_SIZES[settings.size];
  const agents = AGENT_IDS.filter((agent) => settings.enabled[agent]);
  // While another app is full screen the pets hide, but the native side keeps
  // reporting the pointer, or the pets would never learn that it closed.
  const active = trayVisible && agents.length > 0;
  const shown = active && !fullscreen;
  const live = useRef({ size, agents, area });
  live.current = { size, agents, area };

  useEffect(() => preloadFrames(), []);

  // Read the current badges and visibility first, then apply events in order.
  useEffect(() => {
    let active = true;
    let ready = false;
    const queued: PetEvent[] = [];
    const apply = (event: PetEvent) => setBook((current) => applyPetEvent(current, event, Date.now()));
    const stopEvents = subscribePetEvents((event) => (ready ? apply(event) : queued.push(event)));
    const stopVisibility = subscribePetVisibility(setTrayVisible);
    const start = (badges: PetBadgeEntry[]) => {
      if (!active) return;
      setBook((current) => ({ ...current, badges }));
      ready = true;
      queued.splice(0).forEach(apply);
    };
    getPetState()
      .then((state) => {
        if (active) setTrayVisible(state.visible);
        start(state.badges);
      })
      .catch(() => start([]));
    const expire = window.setInterval(() => setBook((current) => expireSessions(current, Date.now())), EXPIRE_EVERY_MS);
    return () => {
      active = false;
      stopEvents();
      stopVisibility();
      window.clearInterval(expire);
    };
  }, []);

  // The cursor: from native events while clicks pass through, and from the page when they reach it.
  useEffect(() => {
    const stopNative = subscribeNativePointer((pointer) => {
      if (!press.current) cursor.current = { x: pointer.x, y: pointer.y };
      setFullscreen(pointer.fullscreen);
    });
    const move = (event: PointerEvent) => {
      cursor.current = { x: event.clientX, y: event.clientY };
    };
    const resize = () => setArea(viewport());
    window.addEventListener("pointermove", move);
    window.addEventListener("resize", resize);
    return () => {
      stopNative();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // A move to another screen resizes the window; keep every pet on it.
  const previousArea = useRef(area);
  useLayoutEffect(() => {
    for (const body of bodies.current.values()) fitBody(body, previousArea.current, { ...area, size });
    previousArea.current = area;
  }, [area, size]);

  useEffect(() => {
    if (!shown) {
      setHovered(null);
      reportPetWindow(active, false);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      if (time - last < FRAME_MS) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const { size, agents, area } = live.current;
      const now = Date.now();
      const world = { ...area, size, cursor: cursor.current, now, dt: Math.min(0.05, Math.max(0, (time - last) / 1000)), random: Math.random };
      last = time;
      agents.forEach((agent, index) => {
        let body = bodies.current.get(agent);
        if (!body) {
          body = createBody(index, world);
          bodies.current.set(agent, body);
        }
        const state = bookRef.current.agents[agent];
        if (state.activeAt > body.calmSince) wakeBody(body, state.activeAt);
        if (state.emote && state.emote.serial !== emotes.current.get(agent)) {
          emotes.current.set(agent, state.emote.serial);
          emoteBody(body, state.emote.name, now);
        }
        const others = agents.filter((other) => other !== agent).flatMap((other) => bodies.current.get(other)?.x ?? []);
        stepBody(body, petView(bookRef.current, agent).mood, { ...world, others });
      });
      // Clicks reach this window only while the cursor is over a pet, a badge, or a pet being dragged.
      const point = cursor.current;
      const target = point ? document.elementFromPoint(point.x, point.y) : null;
      reportPetWindow(true, press.current !== null || Boolean(target?.closest("[data-pet-hit]")));
      setFrame((value) => (value + 1) % 1_000_000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shown, active]);

  const click = useCallback((agent: AgentId) => {
    const now = Date.now();
    const { cleared } = clickPet(bookRef.current, agent, now);
    // Apply to the newest state, so an event that arrives at the same moment is kept.
    setBook((current) => clickPet(current, agent, now).book);
    const body = bodies.current.get(agent);
    if (!body) return;
    if (cleared) wakeBody(body, now);
    else emoteBody(body, PET_EMOTES[Math.floor(Math.random() * PET_EMOTES.length)], now);
  }, []);

  function pointerDown(agent: AgentId, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { agent, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, dragging: false };
  }

  function pointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const body = bodies.current.get(current.agent);
    const point = { x: event.clientX, y: event.clientY };
    cursor.current = point;
    if (!body) return;
    if (!current.dragging && Math.hypot(point.x - current.start.x, point.y - current.start.y) > DRAG_THRESHOLD) {
      current.dragging = true;
      grabBody(body, current.start, Date.now());
    }
    if (current.dragging) {
      dragBody(body, point, { ...live.current.area, size: live.current.size });
      // Redraw now rather than on the next frame, so the pet stays under the pointer.
      setFrame((value) => (value + 1) % 1_000_000);
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLElement>, cancelled = false) {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    press.current = null;
    const body = bodies.current.get(current.agent);
    if (current.dragging && body) releaseBody(body, { height: live.current.area.height, now: Date.now() });
    else if (!cancelled) click(current.agent);
  }

  if (!shown) return <div className="agent-pet-layer" aria-hidden="true" />;
  return (
    <div className="agent-pet-layer">
      {agents.map((agent) => {
        const body = bodies.current.get(agent);
        if (!body) return null;
        const pet = PET_BY_AGENT[agent];
        const view = petView(book, agent);
        const label = [
          pet.name,
          view.done && "finished",
          view.needsYou && "needs you",
          view.mood === "working" && "working",
          view.count > 1 && `${view.count} chats`,
        ].filter(Boolean).join(", ");
        return (
          <div
            key={agent}
            className="agent-pet"
            data-agent={agent}
            data-pose={body.pose}
            data-mood={view.mood}
            style={{ width: size, height: size, transform: `translate(${body.x - size / 2}px, ${body.y - (size * BASELINE) / FRAME_SIZE}px)` }}
          >
            <SpritePlayer agent={agent} pose={body.pose} elapsed={Date.now() - body.poseSince} size={size} facing={body.facing} />
            <div
              className="pet-hitbox"
              data-pet-hit=""
              role="button"
              aria-label={label}
              onPointerDown={(event) => pointerDown(agent, event)}
              onPointerMove={pointerMove}
              onPointerUp={(event) => pointerUp(event)}
              onPointerCancel={(event) => pointerUp(event, true)}
              onPointerEnter={() => setHovered(agent)}
              onPointerLeave={() => setHovered((current) => (current === agent ? null : current))}
            />
            {view.done && <span className="pet-dot" aria-hidden="true" />}
            {view.needsYou && <span className="pet-question" aria-hidden="true">?</span>}
            {view.count > 1 && <span className="pet-count">×{view.count}</span>}
            {view.badges.length > 0 && (
              <div className="pet-badges">
                {view.badges.map((entry) => {
                  const action = entry.badge.action;
                  const count = entry.badge.count > 99 ? "99+" : String(entry.badge.count);
                  return action ? (
                    <button
                      key={`${entry.agent ?? "*"}:${entry.source}`}
                      type="button"
                      className="pet-badge"
                      data-pet-hit=""
                      aria-label={`${entry.badge.count} from ${entry.source}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => void runPetAction(action).catch((error: unknown) => console.warn("The badge action failed.", error))}
                    >
                      {count}
                    </button>
                  ) : (
                    <span key={`${entry.agent ?? "*"}:${entry.source}`} className="pet-badge" aria-label={`${entry.badge.count} from ${entry.source}`}>
                      {count}
                    </span>
                  );
                })}
              </div>
            )}
            {hovered === agent && view.note && press.current === null && (
              <div className="pet-note" role="tooltip">{view.note}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
