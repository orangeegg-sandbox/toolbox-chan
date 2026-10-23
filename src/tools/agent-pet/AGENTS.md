# Agent pets

- The pets depend only on the pet event API from `core/sdk.ts`. Do not import the TODO tool or any other tool, and do not add agent-specific logic to the pet window: hooks and other callers send events, the pet picks the motion.
- Keep `model/` pure and tested; the window (`window/PetWindow.tsx`) only wires events, the animation loop, pointer input, and native calls.
- Every element that may take the pointer carries `data-pet-hit`; everything else in the pet window must keep `pointer-events: none`, or clicks stop passing through to other apps.
- Frame names follow `docs/design/agent-pets/art-brief.md`. `assets/<agent>/` holds unedited copies of `docs/design/agent-pets/<agent>/frames/`; change art in the docs folder first, then copy it, and keep the two identical.
- Native code is in `src-tauri/src/tools/agent-pet/` (read its `AGENTS.md`); grant new commands in `src-tauri/capabilities/agent-pet.json`.
- Tests never touch the real agent config files.
