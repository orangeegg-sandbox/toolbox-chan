# Spec: Agent pet behaviours

Status: agreed with the user on 2026-10-23 and built the same day. The notes marked **Built:** record where the build settled a detail the spec left open.

Builds on [Agent Desktop Pet and Agent TODO](agent-pet-and-todo.md) and keeps its rules: pet behaviour stays in `src/tools/agent-pet/`, the pet knows only pet events, and agent-specific detection lives with the callers (hooks, watchers), never in the pet window.

## Goals

- Pets stop blocking the view: they rest in a zone the user picks.
- The user picks how a pet reacts to each kind of event.
- A notice says what happened in a chat bubble, with a link to it.
- Pets feel livelier while idle.

## R1. Idle zone

- The user picks one rectangle on the screen: the pets' home.
- It is stored as fractions (0–1) of the screen's work area (the screen without the taskbar), so it keeps the same place in proportion on screens of any size. Pets keep their pixel size; a zone smaller than a pet grows to fit one.
- Pets stand on the zone's bottom edge and walk only between its left and right edges. This holds whenever a pet is not travelling to the pointer: idle, working, and waiting for you.
- A pet that is somewhere else (dropped after a drag, or back from the pointer) goes back into the zone.
- Toggle **Keep pets in the idle zone**. Off = today's behaviour (the whole bottom of the screen).
- Setting the zone: **Draw the zone** in settings dims the screen the mouse is on, shows the current zone, and lets the user drag a new box on the real screen. **Save** keeps it; **Cancel** keeps the old one; **Use the whole bottom** turns the zone off. While drawing, the whole pet window takes clicks (one `data-pet-hit` overlay), so no native change is needed. **Built:** the pet window cannot take keyboard focus, so there is no Enter or Esc; the settings page asks the pet window through a local storage key.

## R2. Behaviour per event

| Event | Comes from | Today |
| --- | --- | --- |
| Task done | `status: "done"` | Red dot; follows the pointer until clicked |
| Needs you | `status: "needs-you"` | "?" bubble; stays where it is |
| New TODO | A badge count goes up (the Agent TODO tool) | Badge number only |
| Limit reset | New, see R5 | — |

Each event gets a choice:

- **Stay in the zone**: plays the event's pose where it is.
- **Walk to the pointer**: today's Done behaviour. Goes to the pointer, stops a little away, follows it until clicked.
- **Teleport to the pointer**: new portal animation (below).

Limit reset offers only **Stay in the zone**. Defaults: Done = walk, Needs you = stay, New TODO = stay.

Clicking the pet (or its bubble link) clears the notice, and the pet goes back to the zone the way it came.

### Teleport animation (like Portal 2)

1. The pet opens an orange portal on the floor at its feet.
2. It jumps in and sinks through.
3. A blue portal opens next to the pointer; the pet jumps out and lands beside the pointer. Both portals close.
4. While the notice is open it stays beside the pointer. If the pointer moves far away (about a third of the screen or more), it teleports again; short moves it walks.

## R3. Toggles

Most options get an on/off switch in the settings page:

| Setting | Kind | Off means |
| --- | --- | --- |
| Each pet, size | exists | — |
| Keep pets in the idle zone | toggle | whole bottom of the screen (today) |
| Follow the screen the mouse is on | toggle | pets stay on the main screen (native change in `window.rs`) |
| Walk around while idle | toggle | the pet stands still in the zone, still breathing and looking around |
| Doze after a quiet while | toggle | never sleeps |
| Hide while an app is full screen | toggle | pets stay over full-screen apps |
| Notice bubbles (R4) | toggle | red dot and "?" only, as today |
| Idle moves and idle lines (R6) | toggle each | — |
| Show the note on hover | toggle | no tooltip |
| Behaviour per event (R2) | choice | — |

## R4. Chat bubbles

When a notice arrives, the pet shows a bubble above it:

| Event | Text | Link does |
| --- | --- | --- |
| Task done | "‹chat title› is ready" | opens that chat in the agent's app |
| Needs you | "‹chat title› needs you" | opens that chat in the agent's app |
| New TODO | "‹item› is marked as TODO" | opens Agent TODO in the toolbox (the existing `open-tool` action) |
| Limit reset | "‹Agent› limit is reset" | — |

- The chat title comes from the event note the hooks already send (`project · chat title`).
- Opening the exact chat is best effort and needs research per agent (for example a Claude desktop session link, or a Codex app link built from the session ID). **Built:** the hook helper builds the link when it sends the event, and the core runs a new `open-link` action that accepts only `claude://` and `codex://` links. Codex chats open with `codex://threads/<session id>` (documented by OpenAI). The Claude desktop app keeps one record per chat in `claude-code-sessions/**/local_*.json`, mapping Claude Code's session ID (`cliSessionId`) to the app's own ID, which opens with `claude://claude.ai/epitaxy/<local id>`. A Claude Code chat in a terminal and DSH chats have no app to open, so their bubble has no link (instead of bringing an unrelated window to the front).
- The TODO item text is not in today's events: the pet event API gets one new optional field for a message and its link, checked in both `core/pet/types.ts` and `platform/pet_events.rs`. The Agent TODO scanner sends it with the badge when an item is added.
- A bubble stays until its link, the pet, or its × is clicked. A newer notice for the same pet replaces it.
- Bubbles take clicks (`data-pet-hit`); everything around them still passes clicks through.

## R5. Limit reset

- New event: an agent's usage window started fresh. That covers every window (5-hour and weekly) and sudden early resets, such as Codex resetting limits on a normal day.
  - **Scheduled reset**: the time passes the window's last known `resets_at`.
  - **Sudden reset**: the used percentage drops while the old `resets_at` is still ahead.
- The pet plays a reset animation in the zone and keeps it until the user clicks the pet. It never travels to the pointer.
- Detection is agent-specific, so it is a caller (like the DSH watcher), not pet logic:
  - **Codex**: a native watcher reads `rate_limits` (window length, `used_percent`, `resets_at`) from the newest lines of `~/.codex/sessions/`. On this computer Codex reports only a weekly window (10080 minutes), no 5-hour one.
  - **Claude Code**: reset data reaches only the status line command (`rate_limits.five_hour` and `seven_day`, each with `used_percentage` and `resets_at`; Claude Code 2.1.80 and later, Pro/Max only, sometimes missing; `resets_at` may be epoch seconds or an ISO string). Toolbox-Chan wraps the status line: a `--pet-status-line` helper mode becomes the `statusLine` command, runs the user's existing command (today agents-studio's) with the same input, prints its output unchanged, and saves the limit data for the limit watcher. **Built:** the user's command travels inside the wrapper command as one base64url word, so removing needs no other record; the limits go to `<app data>/agent-pet/claude-limits.json` rather than the event door, because a reset needs the earlier reading to be found.
  - **Claude desktop app** (found during the build): `plan-usage-history.json` in the app's data folder holds a 5-hour and weekly use sample every 15 minutes, with no reset times. The watcher reads it too, so Claude resets are seen without installing anything. **Install** and **Remove** sit next to the hooks, back up `~/.claude/settings.json` first, and put the original command back on removal. Like `--pet-hook`, the helper must never block or print anything of its own.
  - **DSH**: not covered; DeepSeek has no usage windows known here.
- Limits: a scheduled reset shows on time from the saved `resets_at`, but a sudden reset shows only when the agent next reports usage (Codex runs a turn, or Claude's status line refreshes).

## R6. More idle life

- **Idle moves**: the user adds their own animations from PNG frames. A pet plays one of its idle moves now and then while idle.
  - Format: one folder per move with `move.json` (agent, name, frames per second, how many loops) and `<name>-<n>.png` frames that follow the art brief: 256×256 transparent PNG, facing right, feet at y = 244, same scale as the pet's other frames.
  - **Add idle move** in settings picks a folder, checks the format, and copies it into the app data folder; each move can be turned off or removed.
  - A ready-made prompt for an image AI, plus the folder layout, lives in `docs/design/agent-pets/idle-moves.md`, so the user can ask an AI to make a new move.
  - One demo move per agent, made with that prompt by the image agent (tower route `image`), ships in the same format to prove the path works.
- **Idle lines**: a list of short lines in settings. Now and then an idle pet says one in a bubble, which fades after a few seconds. It never takes clicks. Setting: how often (for example every 2–10 minutes).

## Defaults picked without asking

Change them if they are wrong.

1. Working and needs-you pets stay in the zone too.
2. A dropped pet falls, lands, then walks back into the zone after a short pause.
3. With **Follow the screen** off, pets stay on the main screen.
4. Portals are drawn by code; the pet uses its existing frames (`held` to fall in, `land` to come out). New jump frames can be drawn later.
5. One idle-lines list shared by all pets.
6. Settings stay in local storage; the new version reads the old pet on/off and size.

## Answers from the user (2026-10-23)

1. The zone is drawn on the real screen.
2. A Done or Needs-you link tries to open the exact chat.
3. Every window reset counts, including sudden early resets. Claude's data comes through a status line wrapper.
4. Idle moves are the user's own PNG frames, with a prompt template for an image AI and one demo move per agent.
