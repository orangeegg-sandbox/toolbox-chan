import { buildLibrary } from "./animations";

// Runtime copies of `docs/design/agent-pets/<agent>/frames/*.png`, found at build
// time by name. A missing animation falls back to a similar one.
const files = import.meta.glob<string>("../assets/*/*.png", { eager: true, query: "?url", import: "default" });

export const frameLibrary = buildLibrary(files);

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
