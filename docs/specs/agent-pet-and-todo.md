# Spec: Agent Desktop Pet and Agent TODO

Status: agreed with the user on 2026-10-22. The shared groundwork (tray, startup, Pet event API with both doors) is built; see [architecture](../architecture.md#background-running-and-the-pet-event-api). The pet and TODO tools are not built yet.

Two new tools inside Toolbox-Chan. Both follow the normal module rules in [AGENTS.md](../../AGENTS.md) and [architecture.md](../architecture.md): each lives in `src/tools/<id>/`, imports core only through `src/core/sdk.ts`, and never imports the other tool.

## Agents in scope

| Id | Agent | How it runs here | Session data |
| --- | --- | --- | --- |
| `claude` | Claude Code | Claude desktop app, Code tab | `~/.claude/projects/<project>/<session>.jsonl` |
| `codex` | OpenAI Codex | CLI and desktop app | `~/.codex/sessions/**`, thread names in `~/.codex/session_index.jsonl` |
| `deepseek` | DeepSeek Harness (DSH) | desktop app and CLI | `~/.dsh/sessions/<project>/**` |

Claude Code in a plain terminal is not a target, but hooks in `~/.claude/settings.json` cover it anyway.

## Shared groundwork (core)

1. **Tray and autostart.** Toolbox-Chan starts with Windows and lives in the system tray. Closing the main window hides it; the pet keeps running. Tray menu: open, show/hide pets, quit.
2. **Pet event API.** The one way anything talks to the pets. See below.

## Pet event API

The pet depends on this API only. It knows nothing about hooks, the TODO tool, or any other caller. A new feature talks to the pet by sending events; the pet needs no change for a new caller.

### Event

```ts
type PetEvent = {
  source: string;        // who sent it: "hook", "agent-todo", ...
  agent?: AgentId;       // "claude" | "codex" | "deepseek"; omitted = every pet
  sessionId?: string;    // lets the pet count parallel chats ("×3")
  status?: "working" | "done" | "needs-you" | "idle";
  emote?: "happy" | "laugh" | "surprised" | "sleepy";
  note?: string;         // short text shown when hovering the pet, e.g. "CustomOfflineTool · Add pet"
  badge?: { count: number; action?: PetAction } | null; // null clears this source's badge
};

type PetAction = { type: "open-tool"; toolId: string };
```

Events say **what happened**; the pet chooses the motion. A caller sends `status: "done"` and the pet decides to cheer, show the red dot and follow the mouse. `emote` is the only direct motion request, and it is limited to a fixed list, so new artwork never breaks callers.

### Two doors, one handler

- **Inside the app:** `notifyPet(event)`, exported from `src/core/sdk.ts`.
- **Outside the app:** `POST http://127.0.0.1:<port>/pet/events` with the event as JSON. Loopback only. Agent hooks use this through `curl`, which ships with Windows. The port is shown in the pet settings and written to a small file in the app data folder so scripts can find it.

Both doors reach the same core handler, which validates the event and forwards it to the pet window. Core owns the API and the `PetEvent` type; the pet tool owns the behavior. If the pet tool is off, events are dropped quietly and callers see no error.

### State the pet keeps

- Status per agent and session. `done` stays until the user clicks the pet. `needs-you` stays until the next event from that session, or a click.
- Badges are keyed by agent and source. A new badge from one source replaces only that source's badge. Core keeps the latest badge per key so a restarted pet window shows it again.

## Tool 1: Agent Desktop Pet (`src/tools/agent-pet/`)

### Pets

- One pet per agent (max three). Each can be turned off in the pet settings.
- If several chats of one agent run at once, the pet shows a count, for example "×3".
- Art: chibi versions of the three reference sheets in [`docs/design/agent-pets/`](../design/agent-pets/). Credits and the non-commercial notice live in that folder's README, and must also be added to the pet tool's README and `THIRD_PARTY_NOTICES.md`.

### Where it lives

- A transparent, always-on-top, no-taskbar window. Clicks pass through everywhere except on the pets.
- Pets walk along the bottom of whichever screen the mouse is on, and move to another screen when the mouse does.

### States

| State | Trigger | Look and behavior |
| --- | --- | --- |
| Idle | No status, or `status: "idle"` | Walks, stops, looks around; sits or sleeps after a long idle |
| Working | `status: "working"` | Agent-specific working animation (Claude reads her book, Codex types at a `>_` terminal, DeepSeek-Chan sings) |
| Done | `status: "done"` | Red dot on the pet, and the pet follows the mouse cursor. Stays until the user clicks the pet |
| Needs you | `status: "needs-you"` | A different look: "?" bubble. Clears on the session's next event or when clicked |

Done wins over working when both are true for one agent.

### Interactions

- Drag the pet anywhere; it dangles while held and lands with a small bounce.
- Click a calm pet: plays a random emote (happy, laugh, surprised, sleepy).
- Click a pet in Done state: clears all done notices for that agent.
- Hover a pet: shows the `note` of its latest event.
- Badges from any source (for example the TODO tool's open-item count). Clicking a badge runs the action its sender attached; the pet does not know what it opens.

### Detection (hooks)

Hooks are just another caller of the Pet event API: each hook command posts a `PetEvent` with `source: "hook"`. They are added to each agent's own settings; the pet tool's settings page installs and removes them and shows if they are present.

- **Claude Code** (`~/.claude/settings.json`): `UserPromptSubmit` → working, `Stop` → done, `Notification` (permission or idle prompts) → needs you.
- **Codex** (`~/.codex/config.toml`): use `[[hooks.*]]` entries. Do not replace the existing `notify` line; it is already used by Codex computer use. Confirm which hook events this Codex version (0.163) supports.
- **DSH**: check whether DSH has hooks. If it has none, fall back to watching `~/.dsh/sessions/` for file changes.

Never overwrite other hooks already in those files (there are existing `cbm-*` hooks for Claude and SessionStart/SubagentStart hooks for Codex). Back up each file before the first edit.

### Art brief (for Codex image generation via tower, route `image`)

The full request is in [`docs/design/agent-pets/art-brief.md`](../design/agent-pets/art-brief.md); this is a summary.

For each of the three characters, keep the face, hair, colors, outfit and signature items from the reference, in a chibi style of about 2.5 heads tall with a modest outfit. Transparent PNG frames of one fixed size, facing right (code flips for left):

- idle (2–4 frames), walk (4–6), working (3–4, agent-specific prop), done / cheer (2–3), needs-you (2, puzzled pose), held / dangling (1–2), landing (2), sit or sleep (2), emotes: happy, laugh, surprised (1–2 each).
- No text, bubbles, red dots or badges in the art; the code draws those.

Save under `docs/design/agent-pets/<agent>/` with a `prompts.json` and `review.json`, like the Toolbox-Chan art in [`docs/design/toolbox-chan/`](../design/toolbox-chan/). Runtime copies go in the tool's own assets folder.

## Tool 2: Agent TODO (`src/tools/agent-todo/`)

A reminder list only. It never sends anything back to the agents.

### What becomes an item

1. **Unfinished plan steps.** Steps from the agent's own task list (Claude's TodoWrite or task-list tool calls, Codex `update_plan`, the DSH equivalent) that are still not completed when a turn ends.
2. **Things the agent told the user to do**, found two ways:
   - **Fixed format.** One line is added to each agent's global instructions (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, the DSH equivalent): write follow-ups for the user as `TODO(user): ...`. These are caught exactly.
   - **Word rules.** In the final message of a turn: list items under headings like "Next steps", "TODO", "Follow-ups", and sentences that start with phrases like "You need to", "You should", "Please run", "Remember to". Some misses and some noise are expected.

No AI is used. Everything runs offline by reading local session files.

### Each item stores

Agent, project (folder name, with full path on hover), chat title, the text, the kind (unfinished step or for-you), when it was found, and the source session id. The same text from the same session is stored once.

### Rules

- Only chats active after the tool is first turned on are read. Old chats are ignored.
- Items stay until the user removes them, even if the agent finishes the step later.
- Removed items go to History with the time they were removed. History is kept and items can be restored.
- Filter by agent and by project.

### Talks to the pet

Whenever the open-item count for an agent changes, the TODO tool calls `notifyPet({ source: "agent-todo", agent, badge: { count, action: { type: "open-tool", toolId: "agent-todo" } } })`, or `badge: null` when the count reaches zero. It does not check whether the pet exists.

## Defaults picked without asking

These were not in the questions. Change them if they are wrong.

1. Plan steps are captured when a turn ends, and only the ones still unfinished then. Without this, every step the agent finishes in seconds would become an item the user must remove by hand.
2. Needs-you does not follow the mouse; only Done does.
3. All three pets are on at first.
4. History is kept forever. Clearing History asks for confirmation first.
