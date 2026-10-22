# Native host

- `src/lib.rs` assembles Tauri plugins, shared state, and explicitly registered commands.
- `src/platform/` owns shared native services; `src/tools/<id>/` owns tool-specific commands. Read a tool's nested `AGENTS.md` before editing its commands.
- List every registered command in `build.rs`; this turns on the command ACL. Grant each command only to the window that calls it in `capabilities/`, with a tool's permissions in `capabilities/<id>.json`.
- Keep permissions narrowly scoped and native commands compatible with their frontend callers.
- Run `npm run check:native` for Rust changes; use `npm run desktop:build` when native packaging changes.
