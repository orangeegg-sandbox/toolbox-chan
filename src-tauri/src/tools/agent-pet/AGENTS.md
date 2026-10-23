# Native agent pets

- `window.rs` owns the transparent pet window. Clicks must pass through unless the pet page reports the pointer over a pet; keep the click-through style re-asserted by the poller. On Windows, change it with the raw style calls, not `set_ignore_cursor_events`, which re-shows the window with activation.
- `hook_cli.rs` runs before Tauri starts. It must print nothing, never block (bounded stdin and network waits), always exit 0, and send only events `PetEvent::parse` accepts. Its bubble links are built from session IDs only after `link_safe` checks them.
- `limits/status_line.rs` (`--pet-status-line`) also runs before Tauri starts, as Claude Code's status line. It prints only the user's own command's output, bounds every wait, and never fails the status line; `IDENTIFIER` must match `tauri.conf.json` (a test checks it).
- `limits/` and `idle_moves.rs` only read agent records and the user's chosen folder; `hooks/status_line.rs` changes only `statusLine.command`.
- `hooks/` edits agent config files: read and validate first, back up once with `files::back_up_once`, write with `files::write_atomically`, and change only Toolbox-Chan's own entries (recognised by `--pet-hook <agent>`). Never touch Codex's `notify` line or its `hooks.state` review records. Tests use temporary folders, never the real home folder.
- `dsh_watch.rs` only reads DSH's session folders and reports through `PetHub`.
- Grant the pet window's commands only to the `agent-pet` window and the hook commands only to `main`, in `capabilities/agent-pet.json`; `tests/agent_pet_acl.rs` checks this.
