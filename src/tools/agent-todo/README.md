# Agent TODO

[← Toolbox-Chan](../../../README.md)

A reminder list of what your coding agents left for you: plan steps still unfinished when an agent's turn ended, and things an agent told you to do. It reads the chat files that Claude Code, Codex, and DeepSeek Harness (DSH) already keep on this computer. It never sends anything back to the agents, and no AI is used.

## Use the list

Open **Agent TODO** from the sidebar, or click an agent pet's badge.

- **Open** lists items, newest first. Each shows the agent, whether it is an **Unfinished step** or **For you**, the project folder (hover for the full path), the chat title, and when it was found.
- Filter by **Agent** and by **Project**.
- **Remove** an item when it is done. It moves to **History** with the time you removed it. Items stay until you remove them, even if the agent finishes the step later.
- **History** keeps removed items. **Restore** puts one back on the list. **Clear history** asks first, then deletes them for good; cleared items are not found again.
- **Scan now** reads new chat activity right away. Otherwise the list checks every few seconds, also while the window is closed to the tray.

Each agent pet shows its open-item count as a badge. Clicking the badge opens this list.

## Settings

Open **TODO settings** on the Agent TODO page.

- **Watch agent chats** pauses or resumes reading. While paused, **Scan now** still reads once.
- The chat folders each agent uses, and whether they were found.
- **Fixed-format rule** adds one line to an agent's global instructions so it writes follow-ups as `TODO(user): ...`, which this list catches exactly:

  > When you leave a follow-up for the user, write it on its own line as \`TODO(user): ...\`

  | Agent | File |
  | --- | --- |
  | Claude Code | `~/.claude/CLAUDE.md` (or `$CLAUDE_CONFIG_DIR/CLAUDE.md`) |
  | Codex | `~/.codex/AGENTS.md` (or `$CODEX_HOME/AGENTS.md`) |
  | DSH | `~/.dsh/AGENTS.md` (or `$DSH_HOME/AGENTS.md`), its user-global instruction file |

  **Add line** and **Remove line** change only that one line. Before each change the file is copied to `<file>.agent-todo.bak` next to it. A missing file is created; a missing agent folder is not. New chats pick up the line; open chats may not until they restart.

Only chats active after the tool was first turned on are read. Older chats are ignored, and so is anything an old chat wrote before then.

## What is caught

| Kind | Caught when |
| --- | --- |
| Unfinished step | A step in the agent's own task list is still pending or in progress when a turn ends. Claude Code: the desktop app's task list and `TodoWrite`. Codex: `update_plan`. DSH: `todo_write`. |
| For you | The final message of a turn has a `TODO(user): ...` line. |
| For you | The final message has list items under a heading such as **Next steps**, **TODO**, **Follow-ups**, or **Action items**, or under a line such as "Please run:". |
| For you | A sentence in the final message starts with "You need to", "You'll need to", "You should", "You must", "Please run", "Remember to", "Make sure to", or "Don't forget to". |

The same text from the same chat is stored once. When a Claude Code turn ends with its wrap-up, the step in progress counts as done; steps never started stay open.

## What is not caught, and limits

- The word rules are simple, so expect some misses and some noise ("You should see a green check." becomes an item). The fixed format is the reliable path.
- Only the final message of a turn is read for follow-ups. Progress notes in the middle of a turn are not.
- Subagents, Codex chats imported from other agents, and DSH forks replaying their source are skipped: they talk to another agent, not to you.
- A chat that was already running when the tool was turned on is read from that moment, so a plan it made earlier is not known until the agent updates it.
- Claude Code in a plain terminal works when it uses `TodoWrite`; its newer `TaskCreate`/`TaskUpdate` tools are not read.
- Chat files are read on this computer only. In the browser preview (`npm run dev`) nothing is read; the page shows a list kept in local storage.

## Development notes

The scanner is native (`src-tauri/src/tools/agent-todo/`) so it keeps running while the main window is hidden in the tray. A background thread checks file sizes and change times every 4 seconds and reads only what each file added since its saved cursor. A line or zstd frame still being written is left for the next scan. Files seen for the first time are read from the start only if they changed after the tool was turned on and are under 64 MB; otherwise reading starts at the end. State lives in the app data folder under `tools/agent-todo/`: `items.json` (items, History, first-enabled time) and `scan-state.json` (cursors). Both are written through a temporary file and a rename; a damaged file is kept as `*.damaged`.

The scanner sends badges straight to the core pet event hub (`PetHub::publish`, the handler behind `notifyPet`), once at start and whenever an agent's open-item count changes. It never checks whether a pet exists. The frontend talks to the scanner through the `agent_todo_*` commands and reloads on the `agent-todo-changed` event. In the browser preview, `services/backend.ts` keeps the list in local storage and calls `notifyPet` itself.

### Session formats

Verified on this machine in October 2026 (Claude Code 2.1, Codex 0.163, DSH session format v4). Anonymised samples are in `src-tauri/src/tools/agent-todo/fixtures/`.

**Claude Code** — `~/.claude/projects/<folder with separators replaced by ->/<session id>.jsonl`, one JSON object per line. Subagents write to `<session id>/subagents/` and are skipped, as are lines with `isSidechain: true`.

- Project: `cwd` on each line. Title: the latest `custom-title` line (`customTitle`); the first prompt's first line until then.
- Plan: assistant `tool_use` blocks. The desktop app uses `mcp__ccd_turn__update_plan` with `items` (`content`, `status`) to replace the list, `advance: true` to finish the step in progress and start the next, `done` (1-based) and `start`. `mcp__ccd_turn__wrap_up` closes the turn. The terminal uses `TodoWrite` with `todos` (`content`, `status`).
- Turn end: an assistant line whose `message.stop_reason` is `end_turn`. One reply is split over several lines with the same `message.id`; the final message is the text of the reply that ends the turn.

**Codex** — `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl`, lines of `{ timestamp, type, payload }`.

- The first `session_meta` line names the chat (`payload.id`) and folder (`cwd`); later `session_meta` lines copy a parent's. `thread_source: "subagent"` marks a subagent. `turn_context.cwd` updates the folder.
- Title: `~/.codex/session_index.jsonl`, lines of `{ id, thread_name, updated_at }`; the latest line for an id wins.
- Plan: `response_item` with `type: "function_call"`, `name: "update_plan"`, and `arguments` as a JSON string `{ plan: [{ step, status }] }`. No chat on this machine used it, so the sample follows the documented CLI format.
- Turn end: `event_msg` `task_complete` (`last_agent_message` is the final message) or `turn_aborted`. Turns whose `turn_id` starts with `external-import` are copies of other agents' chats.

**DSH** — `~/.dsh/sessions/<encoded folder>/session-<id>/session.v4.jsonl.zstd`: zstd frames appended as the chat grows, which decode to one JSON record per line (`{ type, seq, time, data }`). Field names follow DSH's `SessionEventMap` (`packages/core/session/src/types.ts` in the DSH source) and the record types and frame layout of local files; no DSH chat text was read, and the sample is made up.

- `session` record: `id`, `cwd`, `delegationDepth` (above 0 is a subagent), `isSeeded` (a fork replays its source until `session/end-seed`).
- Title: `session/title` (`data.title`). Plan: `tool/call` with `name: "todo_write"` and `arguments` as a JSON string `{ todos: [{ content, status }] }`.
- Final message: the text parts of the turn's latest `assistant/message`. Turn end: `turn/end` (`data.reason.kind`; `forked` is skipped).

### Tests

- Native: `npm run check:native` runs the format readers against the fixtures, the scanner on a temporary folder tree (new and old chats, half-written lines and frames, deleted chats, Codex titles), the store, the word rules, the instruction-line edits on temporary copies, the badge events, and `tests/agent_todo_acl.rs` for window permissions.
- To check the readers against one of your own chats without showing its text, run the ignored `replay_a_real_chat` test with `AGENT_TODO_REPLAY=<chat file>`; it prints counts only.
- Frontend: `src/tools/agent-todo/tests/agent-todo.test.ts` (filters, badges, browser-preview list) and `agent-todo.e2e.ts` (list, filters, History, settings in the browser preview).
