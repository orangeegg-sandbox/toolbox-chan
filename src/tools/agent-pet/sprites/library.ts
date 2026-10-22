import { buildLibrary } from "./animations";

// Real frames are discovered at build time: copy `<agent>/frames/*.png` from
// `docs/design/agent-pets/` into `../assets/<agent>/` and they replace the
// placeholder art. Animations without frames keep falling back.
const files = import.meta.glob<string>("../assets/*/*.png", { eager: true, query: "?url", import: "default" });

export const frameLibrary = buildLibrary(files);

/** True when at least one agent has real frames. */
export const hasArt = Object.values(frameLibrary).some((poses) => Object.keys(poses).length > 0);

let preloaded = false;

/** Loads every frame up front so the first play of an animation does not flicker. */
export function preloadFrames() {
  if (preloaded) return;
  preloaded = true;
  for (const url of Object.values(files)) {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  }
}
