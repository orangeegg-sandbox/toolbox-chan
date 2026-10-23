import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent,
} from "react";
import { ExternalLink, X } from "lucide-react";
import {
  AGENT_IDS, getPetState, PET_EMOTES, runPetAction, subscribePetEvents, subscribePetVisibility,
  type AgentId, type PetBadgeEntry, type PetEvent, type ToolSurfaceProps,
} from "../../../core/sdk";
import { PET_BY_AGENT } from "../pets";
import { PET_SIZES, subscribeZoneDrawing, usePetSettings, type PetSettings } from "../settings";
import { applyPetEvent, clickPet, createBook, expireSessions, petView, type PetBook, type PetView } from "../model/petModel";
import {
  actBody, canAct, createBody, dragBody, emoteBody, fitBody, grabBody, releaseBody, stepBody, wakeBody, warpView,
  type Band, type Body, type Plan, type Point,
} from "../model/motion";
import { BASELINE, FRAME_SIZE } from "../sprites/animations";
import { preloadFrames } from "../sprites/library";
import { builtInMoves, mergeMoves, moveDuration, type IdleMove } from "../sprites/moves";
import { SpritePlayer } from "../sprites/SpritePlayer";
import { listIdleMoves, subscribeIdleMoves } from "../services/idleMoves";
import { reportPetWindow, subscribeNativePointer } from "./nativeWindow";
import { ZoneEditor } from "./ZoneEditor";

const EXPIRE_EVERY_MS = 30_000;
const DRAG_THRESHOLD = 5;
/** About 30 frames per second is smooth enough for the pets and halves the work of a screen-sized window. */
const FRAME_MS = 1000 / 32;
/** An idle pet plays one of its idle moves this often (a random time in between). */
const ACT_EVERY_MS = [25_000, 70_000] as const;
/** How long an idle line stays up. */
const TALK_MS = 5000;
/** Bubbles closer than this stack; matches the bubble's maximum width in the stylesheet. */
const BUBBLE_WIDTH = 240;
/** How far each stacked bubble rises: about one two-line bubble and its tail. */
const BUBBLE_LIFT = 62;
/** Space kept between a bubble and the screen's edge. */
const BUBBLE_MARGIN = 8;

interface Press {
  agent: AgentId;
  pointerId: number;
  start: Point;
  dragging: boolean;
}

interface Talk {
  text: string;
  until: number;
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The idle zone in window pixels. Its floor stays low enough for a whole pet to fit above it. */
function zoneBand(settings: PetSettings, area: { width: number; height: number }, size: number): Band | undefined {
  if (!settings.zoneOn) return undefined;
  const { x, y, width, height } = settings.zone;
  return {
    left: x * area.width,
    right: (x + width) * area.width,
    floor: Math.min(area.height, Math.max(size * 0.95, (y + height) * area.height)),
  };
}

/** How the pet answers what wants the user; a limit reset only cheers at home. */
function planFor(view: PetView, settings: PetSettings): Plan {
  return { travel: view.call ? settings.behaviour[view.call] : "stay", reset: settings.limitReset && view.reset };
}

function between([low, high]: readonly [number, number]) {
  return low + Math.random() * (high - low);
}

/** The desktop pets. Everything they show comes from pet events; they never call an agent. */
export default function PetWindow(_props: ToolSurfaceProps) {
  const [settings, updateSettings] = usePetSettings();
  const [trayVisible, setTrayVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [book, setBook] = useState<PetBook>(() => createBook(Date.now()));
  const [area, setArea] = useState(viewport);
  const [imported, setImported] = useState<IdleMove[]>([]);
  const [, setFrame] = useState(0);
  const [hovered, setHovered] = useState<AgentId | null>(null);
  const bodies = useRef(new Map<AgentId, Body>());
  const emotes = useRef(new Map<AgentId, number>());
  const nextAct = useRef(new Map<AgentId, number>());
  const nextTalk = useRef(new Map<AgentId, number>());
  const talks = useRef(new Map<AgentId, Talk>());
  const cursor = useRef<Point | null>(null);
  const press = useRef<Press | null>(null);
  const bookRef = useRef(book);
  bookRef.current = book;

  const size = PET_SIZES[settings.size];
  const agents = AGENT_IDS.filter((agent) => settings.enabled[agent]);
  const moves = useMemo(() => mergeMoves(builtInMoves, imported), [imported]);
  const movesById = useMemo(() => new Map(moves.map((move) => [move.id, move])), [moves]);
  const zone = zoneBand(settings, area, size);
  // While another app is full screen the pets hide, but the native side keeps
  // reporting the pointer, or the pets would never learn that it closed.
  const active = trayVisible && agents.length > 0;
  const shown = active && !(fullscreen && settings.hideFullscreen);
  const live = useRef({ size, agents, area, zone, settings, moves });
  live.current = { size, agents, area, zone, settings, moves };

  useEffect(() => preloadFrames(), []);

  // Read the current badges and visibility first, then apply events in order.
  useEffect(() => {
    let active = true;
    let ready = false;
    const queued: PetEvent[] = [];
    const apply = (event: PetEvent) => {
      if (event.notice === "limit-reset" && !live.current.settings.limitReset) return;
      setBook((current) => applyPetEvent(current, event, Date.now()));
    };
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

  // Imported idle moves, reloaded whenever one is added or removed.
  useEffect(() => {
    let active = true;
    const load = () => void listIdleMoves()
      .then((moves) => { if (active) setImported(moves); })
      .catch((error: unknown) => console.warn("The idle moves could not be read.", error));
    load();
    const stop = subscribeIdleMoves(load);
    return () => {
      active = false;
      stop();
    };
  }, []);

  useEffect(() => subscribeZoneDrawing(() => setDrawing(true)), []);

  // The cursor: from native events while clicks pass through, and from the page when they reach it.
  useEffect(() => {
    const stopNative = subscribeNativePointer((pointer) => {
      const inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= window.innerWidth && pointer.y <= window.innerHeight;
      // On another screen (when the pets stay on the main one) the cursor is out of reach.
      if (!press.current) cursor.current = inside ? { x: pointer.x, y: pointer.y } : null;
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
    for (const body of bodies.current.values()) fitBody(body, previousArea.current, { ...area, size, zone });
    previousArea.current = area;
    // Only a new screen moves pets here; after a new zone they walk home on their own.
  }, [area, size]);

  // While the zone is drawn the whole window takes the pointer, even with every pet hidden.
  useEffect(() => {
    if (drawing) reportPetWindow(true, true, settings.followScreen);
  }, [drawing, settings.followScreen]);

  useEffect(() => {
    if (!shown) {
      setHovered(null);
      if (!drawing) reportPetWindow(active, false, settings.followScreen);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      if (time - last < FRAME_MS) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const { size, agents, area, zone, settings, moves } = live.current;
      const now = Date.now();
      const world = {
        ...area, size, zone, cursor: cursor.current, now, dt: Math.min(0.05, Math.max(0, (time - last) / 1000)), random: Math.random,
        wander: settings.wander, doze: settings.doze,
      };
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
        const view = petView(bookRef.current, agent);
        const plan = planFor(view, settings);
        const others = agents.filter((other) => other !== agent).flatMap((other) => bodies.current.get(other)?.x ?? []);
        stepBody(body, view.mood, { ...world, others }, plan);

        const calm = view.mood === "idle" && !plan.reset && !view.bubble;
        // Now and then a calm pet plays one of its idle moves.
        const actAt = nextAct.current.get(agent);
        if (actAt === undefined) nextAct.current.set(agent, now + between(ACT_EVERY_MS) + index * 7000);
        else if (now >= actAt && settings.idleMoves && calm && canAct(body)) {
          const choices = moves.filter((move) => move.agent === agent && !settings.disabledMoves.includes(move.id));
          const move = choices[Math.floor(Math.random() * choices.length)];
          if (move) actBody(body, move.id, moveDuration(move), now);
          nextAct.current.set(agent, now + between(ACT_EVERY_MS));
        }
        // And says one of the idle lines.
        const every = settings.idleTalkMinutes * 60_000;
        const talkAt = nextTalk.current.get(agent);
        if (talkAt === undefined) nextTalk.current.set(agent, now + every * (0.4 + Math.random() * 0.6) + index * 20_000);
        else if (now >= talkAt && settings.idleTalk && settings.idleLines.length > 0 && calm && body.phase === "ground") {
          talks.current.set(agent, { text: settings.idleLines[Math.floor(Math.random() * settings.idleLines.length)], until: now + TALK_MS });
          nextTalk.current.set(agent, now + every * (0.6 + Math.random() * 0.8));
        }
        const talk = talks.current.get(agent);
        if (talk && (now >= talk.until || !calm)) talks.current.delete(agent);
      });
      // Clicks reach this window only while the zone is drawn, or the cursor is over a pet, a badge, a bubble, or a pet being dragged.
      const point = cursor.current;
      const target = point ? document.elementFromPoint(point.x, point.y) : null;
      reportPetWindow(true, drawing || press.current !== null || Boolean(target?.closest("[data-pet-hit]")), settings.followScreen);
      setFrame((value) => (value + 1) % 1_000_000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shown, active, drawing, settings.followScreen]);

  const click = useCallback((agent: AgentId) => {
    const now = Date.now();
    const { cleared } = clickPet(bookRef.current, agent, now);
    // Apply to the newest state, so an event that arrives at the same moment is kept.
    setBook((current) => clickPet(current, agent, now).book);
    talks.current.delete(agent);
    const body = bodies.current.get(agent);
    if (!body) return;
    if (cleared) wakeBody(body, now);
    else emoteBody(body, PET_EMOTES[Math.floor(Math.random() * PET_EMOTES.length)], now);
  }, []);

  const openBubble = useCallback((agent: AgentId) => {
    const action = bookRef.current.agents[agent].bubble?.action;
    if (action) void runPetAction(action).catch((error: unknown) => console.warn("The bubble's link failed.", error));
    click(agent);
  }, [click]);

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
    if (current.dragging && body) releaseBody(body, { ...live.current.area, zone: live.current.zone, now: Date.now() });
    else if (!cancelled) click(current.agent);
  }

  const editor = drawing && (
    <ZoneEditor
      zone={settings.zone}
      onSave={(zone) => {
        updateSettings({ zone, zoneOn: true });
        setDrawing(false);
      }}
      onTurnOff={() => {
        updateSettings({ zoneOn: false });
        setDrawing(false);
      }}
      onCancel={() => setDrawing(false)}
    />
  );

  if (!shown) return <div className="agent-pet-layer" aria-hidden={!drawing}>{editor}</div>;
  const now = Date.now();
  // Bubbles of pets standing close together stack upwards instead of covering each other.
  const lifts = new Map<AgentId, number>();
  const speaking = agents
    .filter((agent) => (settings.bubbles && book.agents[agent].bubble) || talks.current.has(agent))
    .flatMap((agent) => bodies.current.get(agent) ? [{ agent, x: bodies.current.get(agent)!.x }] : [])
    .sort((a, b) => a.x - b.x);
  speaking.forEach((item, index) => {
    lifts.set(item.agent, speaking.slice(0, index).filter((other) => item.x - other.x < BUBBLE_WIDTH).length);
  });
  return (
    <div className="agent-pet-layer">
      {agents.map((agent) => {
        const body = bodies.current.get(agent);
        const warp = body && warpView(body, now);
        return warp?.portals.filter((portal) => portal.open > 0).map((portal) => (
          <span
            key={`${agent}-${portal.exit ? "exit" : "entry"}`}
            className="pet-portal"
            data-exit={String(portal.exit)}
            aria-hidden="true"
            style={{
              width: size * 0.8,
              height: size * 0.22,
              transform: `translate(${portal.x - size * 0.4}px, ${portal.y - size * 0.11}px) scale(${portal.open}, ${portal.open})`,
            }}
          />
        ));
      })}
      {agents.map((agent) => {
        const body = bodies.current.get(agent);
        if (!body) return null;
        const pet = PET_BY_AGENT[agent];
        const view = petView(book, agent);
        const reset = settings.limitReset && view.reset;
        const top = body.y - (size * BASELINE) / FRAME_SIZE;
        const warp = warpView(body, now);
        const move = body.act ? movesById.get(body.act.id) : undefined;
        const bubble = settings.bubbles ? view.bubble : undefined;
        const talk = !bubble ? talks.current.get(agent) : undefined;
        // Near a screen edge the bubble slides inward; its tail still points at the pet.
        const half = BUBBLE_WIDTH / 2 + BUBBLE_MARGIN;
        const shift = Math.max(0, body.x + half - area.width) - Math.max(0, half - body.x);
        const lift = { marginTop: -((lifts.get(agent) ?? 0) * BUBBLE_LIFT), "--bubble-shift": `${shift}px` } as CSSProperties;
        const label = [
          pet.name,
          view.done && "finished",
          view.needsYou && "needs you",
          view.mood === "working" && "working",
          reset && "limit reset",
          view.count > 1 && `${view.count} chats`,
        ].filter(Boolean).join(", ");
        // Through a portal, everything below its surface is hidden.
        const cut = warp ? Math.min(size, Math.max(0, size - (warp.clipY - top))) : 0;
        return (
          <div
            key={agent}
            className="agent-pet"
            data-agent={agent}
            data-pose={body.pose}
            data-mood={view.mood}
            data-phase={body.phase}
            style={{ width: size, height: size, transform: `translate(${body.x - size / 2}px, ${top}px)` }}
          >
            {reset && !warp && <span className="pet-reset" aria-hidden="true" />}
            <div className="pet-body" style={cut > 0 ? { clipPath: `inset(0 0 ${cut}px 0)` } : undefined}>
              <SpritePlayer
                agent={agent}
                pose={body.pose}
                elapsed={now - (body.act && move ? body.act.since : body.poseSince)}
                size={size}
                facing={body.facing}
                move={move}
              />
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
            </div>
            {!warp && (
              <>
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
                {bubble && (
                  <div className="pet-bubble" data-kind={bubble.kind} data-pet-hit="" role="status" key={bubble.serial} style={lift}>
                    <button
                      type="button"
                      className="pet-bubble-text"
                      title={bubble.action ? "Open it" : "Got it"}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => openBubble(agent)}
                    >
                      {bubble.text}
                      {bubble.action && <ExternalLink size={12} aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      className="pet-bubble-close"
                      aria-label="Dismiss"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => click(agent)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </div>
                )}
                {talk && <div className="pet-bubble" data-kind="talk" role="status" style={lift}>{talk.text}</div>}
                {settings.hoverNote && !bubble && !talk && hovered === agent && view.note && press.current === null && (
                  <div className="pet-note" role="tooltip">{view.note}</div>
                )}
              </>
            )}
          </div>
        );
      })}
      {editor}
    </div>
  );
}
