// Development-only contact sheet: every pose and frame of every pet, from the
// real frames where they exist and from the placeholder art otherwise.
// Open /src/tools/agent-pet/tests/fixtures/poses.html in the dev server.
import { createRoot } from "react-dom/client";
import { AGENT_IDS } from "../../../../core/sdk";
import { POSES } from "../../model/motion";
import { ANIMATIONS, resolveFrames } from "../../sprites/animations";
import { frameLibrary } from "../../sprites/library";
import { PLACEHOLDER_FRAMES } from "../../sprites/PlaceholderPet";
import { SpritePlayer } from "../../sprites/SpritePlayer";

function frameCount(agent: (typeof AGENT_IDS)[number], pose: (typeof POSES)[number]) {
  return resolveFrames(frameLibrary, agent, pose)?.frames.length ?? PLACEHOLDER_FRAMES[pose];
}

createRoot(document.getElementById("root")!).render(
  <main style={{ fontFamily: "sans-serif", padding: 12 }}>
    {AGENT_IDS.map((agent) => (
      <section key={agent}>
        <h2 style={{ margin: "8px 0" }}>{agent}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {POSES.flatMap((pose) => Array.from({ length: frameCount(agent, pose) }, (_, frame) => (
            <figure key={`${pose}-${frame}`} style={{ margin: 0, textAlign: "center", fontSize: 11 }}>
              <div style={{ background: "#dfe7ea", borderRadius: 6 }}>
                <SpritePlayer agent={agent} pose={pose} elapsed={(frame * 1000) / ANIMATIONS[pose].fps + 1} size={96} facing={1} />
              </div>
              <figcaption>{pose}-{frame + 1}</figcaption>
            </figure>
          )))}
        </div>
      </section>
    ))}
  </main>,
);
