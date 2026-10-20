# Native host

- `src/lib.rs` assembles Tauri plugins, shared state, and explicitly registered commands.
- `src/platform/` owns shared native services; `src/tools/<id>/` owns tool-specific commands. Read a tool's nested `AGENTS.md` before editing its commands.
- Keep permissions narrowly scoped and native commands compatible with their frontend callers.
- Run `npm run check:native` for Rust changes; use `npm run desktop:build` when native packaging changes.
