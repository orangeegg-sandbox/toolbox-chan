import { useCallback, useEffect, useState } from "react";
import { Coffee, Plus, Trash2 } from "lucide-react";
import { useToolbox } from "../../../core/sdk";
import { PET_BY_AGENT } from "../pets";
import {
  cleanLines, IDLE_TALK_MINUTES, MAX_IDLE_LINE, MAX_IDLE_LINES, usePetSettings,
} from "../settings";
import { builtInMoves, mergeMoves, type IdleMove } from "../sprites/moves";
import { SpritePlayer } from "../sprites/SpritePlayer";
import { idleMovesAvailable, importIdleMove, listIdleMoves, removeIdleMove, subscribeIdleMoves } from "../services/idleMoves";
import { SelectRow, ToggleRow } from "./SettingRows";

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Plays a move's frames in a small preview. */
function MovePreview({ move }: { move: IdleMove }) {
  const [started] = useState(() => Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000 / move.fps);
    return () => window.clearInterval(timer);
  }, [move.fps]);
  return (
    <span className="pet-thumb" aria-hidden="true">
      <SpritePlayer agent={move.agent} pose="idle" elapsed={Date.now() - started} size={44} facing={1} move={move} />
    </span>
  );
}

/** What the pets do while nothing is going on. */
export function IdleSettings() {
  const { notify } = useToolbox();
  const [settings, update] = usePetSettings();
  const [imported, setImported] = useState<IdleMove[]>([]);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState(() => settings.idleLines.join("\n"));
  const available = idleMovesAvailable();
  const moves = mergeMoves(builtInMoves, imported);

  const load = useCallback(() => {
    void listIdleMoves().then(setImported).catch((reason: unknown) => notify(`Could not read the idle moves. ${message(reason)}`, true));
  }, [notify]);
  useEffect(() => {
    load();
    return subscribeIdleMoves(load);
  }, [load]);
  // Follow changes made elsewhere, unless the box holds an edit that is not saved yet.
  useEffect(() => {
    setLines((current) => (cleanLines(current.split("\n")).join("\n") === settings.idleLines.join("\n") ? current : settings.idleLines.join("\n")));
  }, [settings.idleLines]);

  async function add() {
    setBusy(true);
    try {
      const move = await importIdleMove();
      if (move) notify(`Added “${move.label}” for ${PET_BY_AGENT[move.agent].name}.`);
    } catch (reason) {
      notify(message(reason), true);
    } finally {
      setBusy(false);
    }
  }

  async function remove(move: IdleMove) {
    setBusy(true);
    try {
      await removeIdleMove(move);
      notify(`Removed “${move.label}”.`);
    } catch (reason) {
      notify(message(reason), true);
    } finally {
      setBusy(false);
    }
  }

  const toggleMove = (move: IdleMove, on: boolean) => update({
    disabledMoves: on ? settings.disabledMoves.filter((id) => id !== move.id) : [...settings.disabledMoves, move.id],
  });

  return (
    <section className="settings-card" aria-labelledby="idle-heading">
      <div className="settings-section-heading">
        <Coffee size={16} aria-hidden="true" />
        <h2 id="idle-heading">While nothing is going on</h2>
      </div>
      <ToggleRow
        id="pet-wander"
        label="Walk around"
        description="Idle pets stroll inside the zone now and then. Off: they stand still."
        checked={settings.wander}
        onChange={(wander) => update({ wander })}
      />
      <ToggleRow
        id="pet-doze"
        label="Doze off"
        description="A pet sits down and dozes after three quiet minutes."
        checked={settings.doze}
        onChange={(doze) => update({ doze })}
      />
      <ToggleRow
        id="pet-idle-moves"
        label="Idle moves"
        description="Now and then a calm pet plays one of its idle moves below."
        checked={settings.idleMoves}
        onChange={(idleMoves) => update({ idleMoves })}
      />
      <div className="setting-row pet-moves">
        <div>
          <strong>Moves</strong>
          <p>
            Add your own from a folder of PNG frames and a <span className="mono">move.json</span>. The format and a prompt for
            an image AI are in <span className="mono">docs/design/agent-pets/idle-moves.md</span>.
          </p>
          <ul className="pet-move-list">
            {moves.map((move) => (
              <li key={move.id} data-move={move.id}>
                <MovePreview move={move} />
                <div>
                  <label htmlFor={`pet-move-${move.agent}-${move.name}`}>{move.label}</label>
                  <p>{PET_BY_AGENT[move.agent].name} · {move.frames.length} frames · {move.builtIn ? "built in" : "added by you"}</p>
                </div>
                {!move.builtIn && (
                  <button type="button" className="text-button" disabled={busy} onClick={() => void remove(move)} aria-label={`Remove ${move.label}`}>
                    <Trash2 size={13} aria-hidden="true" /> Remove
                  </button>
                )}
                <input
                  id={`pet-move-${move.agent}-${move.name}`}
                  className="toggle"
                  role="switch"
                  type="checkbox"
                  checked={!settings.disabledMoves.includes(move.id)}
                  onChange={(event) => toggleMove(move, event.target.checked)}
                />
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={!available || busy}
          title={available ? undefined : "Idle moves can be added in the desktop app."}
          onClick={() => void add()}
        >
          <Plus size={14} aria-hidden="true" /> Add idle move
        </button>
      </div>
      <ToggleRow
        id="pet-idle-talk"
        label="Idle chatter"
        description="Now and then a calm pet says one of the lines below in a small bubble that fades by itself."
        checked={settings.idleTalk}
        onChange={(idleTalk) => update({ idleTalk })}
      />
      <SelectRow
        id="pet-idle-talk-every"
        label="How often"
        description="About how long each pet waits between lines."
        value={settings.idleTalkMinutes}
        options={IDLE_TALK_MINUTES.map((value) => ({ value, label: `Every ${value} minutes` }))}
        onChange={(idleTalkMinutes) => update({ idleTalkMinutes })}
        disabled={!settings.idleTalk}
      />
      <div className="setting-row">
        <div>
          <label htmlFor="pet-idle-lines">Lines</label>
          <p>One per line, up to {MAX_IDLE_LINES} lines of {MAX_IDLE_LINE} characters. Saved when you leave the box.</p>
          <textarea
            id="pet-idle-lines"
            className="pet-lines"
            rows={6}
            value={lines}
            disabled={!settings.idleTalk}
            onChange={(event) => setLines(event.target.value)}
            onBlur={() => {
              const idleLines = cleanLines(lines.split("\n"));
              setLines(idleLines.join("\n"));
              update({ idleLines });
            }}
          />
        </div>
      </div>
    </section>
  );
}
