import { useEffect, useState } from "react";
import { ChevronDown, Copy, Palette, PawPrint, RadioTower } from "lucide-react";
import {
  copyText, getPetState, notifyPet, subscribePetVisibility, ToolPage, useToolbox,
  type PetDoorStatus, type PetEvent, type PetStatus, type ToolSurfaceProps,
} from "../../../core/sdk";
import { PETS } from "../pets";
import { PET_SIZES, usePetSettings, type PetSize } from "../settings";
import { SpritePlayer } from "../sprites/SpritePlayer";
import { HooksSettings } from "./HooksSettings";

const SIZE_LABELS: Record<PetSize, string> = { small: "Small", medium: "Medium", large: "Large" };
const TEST = { source: "agent-pet", sessionId: "pet-settings-test", note: "Test from pet settings" } as const;

/** The pet tool's page is its settings: the pets themselves live in their own window. */
export default function AgentPetWorkspace({ tool }: ToolSurfaceProps) {
  return (
    <ToolPage tool={tool} className="agent-pet-settings">
      <PetsSettings />
      <DoorSettings />
      <HooksSettings />
      <Credits />
    </ToolPage>
  );
}

function PetsSettings() {
  const [settings, update] = usePetSettings();
  const [visible, setVisible] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void getPetState().then((state) => { if (active) setVisible(state.visible); }).catch(() => undefined);
    const stop = subscribePetVisibility(setVisible);
    return () => {
      active = false;
      stop();
    };
  }, []);
  const status = (value: PetStatus) => void notifyPet({ ...TEST, status: value });
  const badge = (value: PetEvent["badge"]) => void notifyPet({ source: TEST.source, badge: value });
  return (
    <section className="settings-card" aria-labelledby="pets-heading">
      <div className="settings-section-heading">
        <PawPrint size={16} aria-hidden="true" />
        <h2 id="pets-heading">Pets</h2>
      </div>
      {PETS.map((pet) => (
        <div className="setting-row" key={pet.agent}>
          <div className="pet-row-title">
            <span className="pet-thumb" aria-hidden="true">
              <SpritePlayer agent={pet.agent} pose="idle" elapsed={0} size={44} facing={1} />
            </span>
            <div>
              <label htmlFor={`pet-${pet.agent}`}>{pet.name}</label>
              <p>Shows what {pet.agentName} is doing.</p>
            </div>
          </div>
          <input
            id={`pet-${pet.agent}`}
            className="toggle"
            role="switch"
            type="checkbox"
            checked={settings.enabled[pet.agent]}
            onChange={(event) => update({ enabled: { ...settings.enabled, [pet.agent]: event.target.checked } })}
          />
        </div>
      ))}
      <div className="setting-row">
        <div>
          <label htmlFor="pet-size">Size</label>
          <p>How tall the pets stand on the taskbar.</p>
        </div>
        <div className="select-wrap">
          <select id="pet-size" value={settings.size} onChange={(event) => update({ size: event.target.value as PetSize })}>
            {(Object.keys(PET_SIZES) as PetSize[]).map((size) => (
              <option key={size} value={size}>{SIZE_LABELS[size]} ({PET_SIZES[size]} px)</option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
      </div>
      <div className="setting-row">
        <div>
          <strong>Try the pets</strong>
          <p>Sends a test event to every pet that is on. Click a finished pet to clear its red dot.</p>
        </div>
        <div className="pet-actions">
          <button type="button" className="button secondary" onClick={() => status("working")}>Working</button>
          <button type="button" className="button secondary" onClick={() => status("done")}>Done</button>
          <button type="button" className="button secondary" onClick={() => status("needs-you")}>Needs you</button>
          <button type="button" className="button secondary" onClick={() => status("idle")}>Idle</button>
          <button
            type="button"
            className="button secondary"
            onClick={() => badge({ count: 3, action: { type: "open-tool", toolId: "agent-pet" } })}
          >
            Show a badge
          </button>
          <button type="button" className="button secondary" onClick={() => badge(null)}>
            Clear the badge
          </button>
        </div>
      </div>
      <p className="settings-note">
        {visible === false
          ? "The pets are hidden. Choose Show pets in the tray menu to bring them back."
          : "Show pets in the tray menu hides or shows all pets at once."}
      </p>
    </section>
  );
}

function DoorSettings() {
  const { notify } = useToolbox();
  const [door, setDoor] = useState<PetDoorStatus | null>(null);
  useEffect(() => {
    let active = true;
    void getPetState().then((state) => { if (active) setDoor(state.door); }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const url = door?.url || "http://127.0.0.1:47615/pet/events";
  const example = `curl -s -m 2 -H "Content-Type: application/json" -d "{\\"source\\":\\"manual\\",\\"agent\\":\\"claude\\",\\"status\\":\\"done\\"}" ${url}`;
  return (
    <section className="settings-card" aria-labelledby="door-heading">
      <div className="settings-section-heading">
        <RadioTower size={16} aria-hidden="true" />
        <h2 id="door-heading">Event door</h2>
      </div>
      <div className="setting-row">
        <div>
          <strong>Address</strong>
          <p>Outside programs, such as agent hooks, post pet events here. Only this computer can reach it.</p>
        </div>
        <div>
          <p className="mono">{door?.url || "—"}</p>
          <span className="pet-state" data-tone={door?.listening ? "good" : "bad"}>
            {door === null ? "Checking…" : door.listening ? "Listening" : door.error ?? "Not listening"}
          </span>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <strong>Try it from a terminal</strong>
          <p className="mono">{example}</p>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => void copyText(example).then(() => notify("Command copied.")).catch(() => notify("Could not copy the command.", true))}
        >
          <Copy size={14} aria-hidden="true" /> Copy
        </button>
      </div>
    </section>
  );
}

function Credits() {
  return (
    <section className="settings-card" aria-labelledby="credits-heading">
      <div className="settings-section-heading">
        <Palette size={16} aria-hidden="true" />
        <h2 id="credits-heading">Art credits</h2>
      </div>
      <div className="pet-credits">
        <p>
          The pets are chibi versions of fan character art, used with credit for this personal, non-commercial project.
          Do not sell them or use them in a commercial product.
        </p>
        <ul>
          {PETS.map((pet) => <li key={pet.agent}>{pet.name} ({pet.agentName}) by {pet.artist}</li>)}
        </ul>
      </div>
    </section>
  );
}
