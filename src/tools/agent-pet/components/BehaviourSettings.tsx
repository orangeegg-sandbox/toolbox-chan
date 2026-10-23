import { useState } from "react";
import { BellRing, Map as MapIcon } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { PET_BEHAVIOURS, PET_CALLS, requestZoneDrawing, usePetSettings, type PetBehaviour, type PetCall, type Zone } from "../settings";
import { SelectRow, ToggleRow } from "./SettingRows";

const BEHAVIOUR_LABELS: Record<PetBehaviour, string> = {
  stay: "Stay in the idle zone",
  walk: "Walk to the pointer",
  teleport: "Teleport to the pointer",
};

const CALLS: Record<PetCall, { label: string; description: string }> = {
  done: { label: "Task done", description: "A chat finished. The pet shows a red dot until you click it." },
  needsYou: { label: "Needs you", description: "An agent asks for permission or an answer. The pet shows a “?”." },
  notice: { label: "Other notices", description: "Any other message a tool sends, such as a new TODO item." },
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function describeZone(zone: Zone) {
  return `${percent(zone.width)} wide and ${percent(zone.height)} tall, ${percent(zone.x)} from the left and ${percent(1 - zone.y - zone.height)} from the bottom.`;
}

/** Where the pets rest, and how they answer when something wants you. */
export function BehaviourSettings() {
  const [settings, update] = usePetSettings();
  const [asked, setAsked] = useState(false);
  const desktop = isTauri();
  return (
    <>
      <section className="settings-card" aria-labelledby="place-heading">
        <div className="settings-section-heading">
          <MapIcon size={16} aria-hidden="true" />
          <h2 id="place-heading">Where the pets rest</h2>
        </div>
        <ToggleRow
          id="pet-zone-on"
          label="Keep pets in the idle zone"
          description="When nothing needs you, the pets stay inside the zone so they never block what you are looking at. Off: they walk along the whole bottom of the screen."
          checked={settings.zoneOn}
          onChange={(zoneOn) => update({ zoneOn })}
        />
        <div className="setting-row">
          <div>
            <strong>Idle zone</strong>
            <p>
              {describeZone(settings.zone)} The zone keeps the same place in proportion on every screen. Pets stand on its bottom edge.
            </p>
            {asked && <p role="status">Drag a box on the screen with the pets, then choose Save.</p>}
          </div>
          <div className="pet-zone-setting">
            <div className="pet-zone-preview" aria-hidden="true">
              <span
                style={{
                  left: percent(settings.zone.x), top: percent(settings.zone.y),
                  width: percent(settings.zone.width), height: percent(settings.zone.height),
                }}
              />
            </div>
            <button
              type="button"
              className="button secondary"
              disabled={!desktop}
              title={desktop ? undefined : "The pets run in the desktop app."}
              onClick={() => {
                requestZoneDrawing();
                setAsked(true);
              }}
            >
              Draw the zone
            </button>
          </div>
        </div>
        <ToggleRow
          id="pet-follow-screen"
          label="Follow the screen the mouse is on"
          description="The pets move to whichever screen your mouse is on. Off: they stay on the main screen."
          checked={settings.followScreen}
          onChange={(followScreen) => update({ followScreen })}
        />
        <ToggleRow
          id="pet-hide-fullscreen"
          label="Hide while an app is full screen"
          description="Hides the pets during full-screen videos and games."
          checked={settings.hideFullscreen}
          onChange={(hideFullscreen) => update({ hideFullscreen })}
        />
      </section>

      <section className="settings-card" aria-labelledby="calls-heading">
        <div className="settings-section-heading">
          <BellRing size={16} aria-hidden="true" />
          <h2 id="calls-heading">When something needs you</h2>
        </div>
        <p className="settings-description">
          Teleport opens a portal under the pet, drops it in, and pops it out of a second portal next to your pointer. A pet
          that walked or teleported to you goes back to the zone the same way once you click it.
        </p>
        {PET_CALLS.map((call) => (
          <SelectRow
            key={call}
            id={`pet-call-${call}`}
            label={CALLS[call].label}
            description={CALLS[call].description}
            value={settings.behaviour[call]}
            options={PET_BEHAVIOURS.map((value) => ({ value, label: BEHAVIOUR_LABELS[value] }))}
            onChange={(value) => update({ behaviour: { ...settings.behaviour, [call]: value } })}
          />
        ))}
        <ToggleRow
          id="pet-limit-reset"
          label="Cheer when a usage limit resets"
          description="When an agent's 5-hour or weekly limit starts fresh, even early, its pet cheers in the zone with a ring of light until you click it."
          checked={settings.limitReset}
          onChange={(limitReset) => update({ limitReset })}
        />
        <ToggleRow
          id="pet-bubbles"
          label="Chat bubbles"
          description="The pet says what happened, such as “Fix the tray is ready”. Click the bubble to open that chat or tool; × dismisses it. Off: only the red dot and “?”."
          checked={settings.bubbles}
          onChange={(bubbles) => update({ bubbles })}
        />
        <ToggleRow
          id="pet-hover-note"
          label="Show the latest note on hover"
          description="Hovering a pet shows its latest note, such as the project and chat title."
          checked={settings.hoverNote}
          onChange={(hoverNote) => update({ hoverNote })}
        />
      </section>
    </>
  );
}
