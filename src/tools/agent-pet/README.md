# Agent pets

[← Toolbox-Chan](../../../README.md)

Little desktop pets that stand on your taskbar and show what your coding agents are doing: one pet each for **Claude Code** (Claude-Chan), **Codex** (Codex-Chan), and **DeepSeek Harness / DSH** (DeepSeek-Chan). A pet works, cheers when a chat finishes, and asks for you when an agent waits for an answer.

The pets run in the desktop app, in their own transparent window. They keep running while the toolbox window is closed to the tray.

## What the pets show

| State | When | What you see |
| --- | --- | --- |
| Idle | Nothing is running | The pet strolls inside its idle zone, looks around, now and then plays an idle move or says a line, and dozes off after a few quiet minutes |
| Working | A chat is running | Claude-Chan reads her book, Codex-Chan types at a terminal, DeepSeek-Chan sings |
| Done | A chat finished | A red dot and a bubble such as "Add pet is ready". By default the pet walks to your mouse until you click it |
| Needs you | The agent asks for permission or an answer | A "?" and a bubble such as "Add pet needs you". It clears when that chat moves on, or when you click the pet |
| Notice | Another tool says something, such as a new TODO item | A bubble such as "“Run the tests” is marked as TODO" |
| Limit reset | The agent's 5-hour or weekly limit starts fresh | The pet cheers in its zone inside a ring of light until you click it |

- Done wins over working: if one chat finished while another still runs, the pet shows done.
- **×2**, **×3** next to a pet means that many chats of that agent are running at once.
- A pet that comes to you stops a little away from the pointer, so it never sits under it. Move onto the pet to click it.

## Use the pets

- **Click** a pet with a notice to clear its red dot, "?", bubble, and limit-reset ring. The pet goes back to its zone the way it came.
- **Click a bubble** to open what it is about: the finished chat in the Claude or Codex app, or the tool that sent it (for example Agent TODO). **×** dismisses the bubble without opening anything.
- **Click** a calm pet to make it react: happy, laugh, surprised, or sleepy.
- **Drag** a pet anywhere. It dangles while you hold it, lands with a small bounce, and then walks back to its zone.
- **Hover** a pet to see its latest note, such as `CustomOfflineTool · Add pet` (project folder and chat title).
- **Badges** above a pet come from other tools or programs, for example a count of open items. Clicking a badge does what its sender asked, such as opening that tool.
- Clicks anywhere else go straight through to the apps underneath.
- The pets walk on the screen your mouse is on, and move with it to another screen (or stay on the main screen, if you turn that off).
- They hide while another app is full screen, such as a video or a game (unless you turn that off).
- **Show pets** in the tray menu hides or shows all pets at once.

### The idle zone

The idle zone is the part of the screen where the pets rest, so they never wander in front of your work. Pets stand on its bottom edge and stroll between its sides; working and waiting pets stay there too. Only a pet that walks or teleports to you leaves it.

To set it, choose **Draw the zone** in the settings. The screen with the pets dims and shows the current zone; drag a box where the pets should rest, then choose **Save**. **Use the whole bottom** turns the zone off, and **Cancel** keeps the old one. The zone is kept as a share of the screen (for example "the left 30%, bottom 25%"), so it lands in the same place on screens of different sizes.

### Walk or teleport

For **Task done**, **Needs you**, and **Other notices** you choose how the pet answers:

- **Stay in the idle zone**: it shows the notice where it is.
- **Walk to the pointer**: it walks (and floats) over to your mouse and follows it until you click it.
- **Teleport to the pointer**: an orange portal opens under the pet; it hops in and falls through, then pops out of a teal portal next to your mouse. If you move the mouse far away it teleports again. When you click it, it goes home through a portal too.

A limit reset always stays in the zone.

## Settings

Open **Agent pets** in the toolbox.

Most options are on/off switches.

- **Pets**: turn each pet on or off, and choose its size (Small, Medium, or Large).
- **Try the pets**: send test events (Working, Done, Needs you, Idle, Notice, Limit reset) and a test badge to every pet that is on.
- **Where the pets rest**: keep pets in the idle zone, **Draw the zone**, follow the screen the mouse is on (off: stay on the main screen), and hide while an app is full screen.
- **When something needs you**: stay, walk, or teleport for Task done, Needs you, and Other notices; cheer when a usage limit resets; chat bubbles; the note on hover.
- **While nothing is going on**: walk around, doze off, idle moves (each can be turned off; your own can be removed), **Add idle move**, idle chatter, how often, and the lines the pets say.
- **Event door**: the address outside programs post to (`http://127.0.0.1:47615/pet/events`) and whether it is listening, with a `curl` example to copy.
- **Agent hooks**: install, check, or remove the hooks below.
- **Limit resets**: where resets are read from, and the Claude Code status line wrapper.
- **Art credits**: who drew the characters.

### Idle moves

An idle move is a short extra animation, such as Claude-Chan stretching. One demo move ships for each pet. To add your own, make a folder with PNG frames and a `move.json`, then choose **Add idle move** and pick the folder. Toolbox-Chan checks the folder (the fields, the frame names, and that every frame is a 256×256 PNG of at most 1 MB) and copies it, so you can delete the original afterwards. The format, and a ready-made prompt to ask an image AI for a new move, are in [idle-moves.md](../../../docs/design/agent-pets/idle-moves.md).

## Agent hooks

Hooks tell a pet when a chat starts, finishes, or needs you. **Install** adds Toolbox-Chan's hooks next to the hooks you already have; **Remove** takes out only Toolbox-Chan's. Before its first change to a file, Toolbox-Chan saves a copy next to it as `<file>.toolbox-chan-backup`. A file that cannot be read safely (for example broken JSON) is left alone and the page says why.

| Agent | File | Events → pet status |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | `UserPromptSubmit` → working, `Stop` → done, `Notification` → needs you |
| Codex | `~/.codex/config.toml` | `UserPromptSubmit` → working, `Stop` → done, `PermissionRequest` → needs you |
| DSH | (no hooks) | Toolbox-Chan watches `~/.dsh/sessions/` instead; turn it on with **Turn on** |

- **Claude Code**: start a new chat after installing; chats that are already open keep the hooks they started with. The hooks also work for Claude Code in a terminal. Claude's reminder that a finished chat is "waiting for your input" is not treated as a question, so it does not hide the red dot.
- **Codex**: Toolbox-Chan adds one marked block at the end of `config.toml` and never changes anything else, including the `notify` line. Codex asks you to review new hooks before it runs them; the page shows **waiting for review in Codex** until you do.
- **DSH**: DSH has no hooks Toolbox-Chan can use, so it watches DSH's session folders. A changing session file means DSH is working in that chat; 45 seconds without changes after that counts as done. DSH cannot report "needs you" this way.

### How a hook reaches the pet

Each hook runs the Toolbox-Chan program itself in a small helper mode:

```sh
little-toolbox.exe --pet-hook claude done
```

The agent passes its hook data (session ID, working folder, transcript path) on standard input. The helper turns it into one pet event with `source: "hook"`, the agent, the session ID, and a note made from the project folder and the chat title (Claude's transcript title, Codex's session name, or the first line of the prompt), posts it to the event door, and exits. It starts no window, prints nothing, needs no other software, and always exits within about two seconds, even when Toolbox-Chan is closed, so it never slows an agent down.

Hooks point at the program that installed them. Install them from the installed app, not from a development build; if the app moves, the page shows **Installed for another copy of Toolbox-Chan** and **Update** fixes it.

For a finished chat or a question, the helper also adds the bubble's text and a link to the chat: `codex://threads/<id>` for Codex, and for Claude Code the Claude desktop app's own link to that chat, found in the app's chat records. A Claude Code chat in a terminal and DSH chats have no link, so their bubble only clears the notice.

## Limit resets

Toolbox-Chan reads the usage records the agents already keep and tells a pet when a usage window starts fresh: the 5-hour window, the weekly one, and sudden early resets.

| Agent | Read from | Notes |
| --- | --- | --- |
| Codex | `rate_limits` in `~/.codex/sessions/` | Has reset times. Some plans have only a weekly window. |
| Claude Code | The status line wrapper (below) | Has reset times. Needs Claude Code 2.1.80 or later on a Pro or Max plan. |
| Claude Code | The Claude desktop app's `plan-usage-history.json` | No install needed. A use sample every 15 minutes while the app runs; no reset times. |

A reset counts when the time passes the last known reset time (it shows on time even when the agent is idle), or when the used share drops. A sudden early reset shows only the next time the agent reports its use. Resets that happened while Toolbox-Chan was closed are not announced.

**Status line wrapper.** Claude Code gives its reset times only to its status line command. **Install** in **Limit resets** makes Toolbox-Chan that command:

```sh
little-toolbox.exe --pet-status-line <your own command, encoded>
```

It runs your own status line command with the same input and prints its output unchanged, so your status line looks the same. It saves the limit times in the app data folder for the pets. It prints nothing of its own and gives up on your command after 5 seconds. **Remove** puts your command back. Like the hooks, the first change backs up `settings.json`. A simple command (a program and its arguments) runs directly; one with pipes or variables runs through `cmd /C` on Windows.

## Talk to the pets from other programs

The pets understand only pet events; they know nothing about the agents, hooks, or tools that send them. Any program on this computer can post one:

```sh
curl -s -m 2 -H "Content-Type: application/json" -d "{\"source\":\"script\",\"agent\":\"codex\",\"status\":\"done\",\"note\":\"Build finished\"}" http://127.0.0.1:47615/pet/events
```

A valid event returns `204`. On Windows, `curl -d "..."` passes the text in the system code page, so a note with characters such as `·` is refused as invalid; save the JSON as a UTF-8 file and send it with `--data-binary @event.json` instead. See the [pet event API](../../../docs/architecture.md#background-running-and-the-pet-event-api) for every field. Events say what happened; the pet chooses how to move. `emote` (`happy`, `laugh`, `surprised`, `sleepy`) is the only direct motion request.

## Limitations

- The pets run in the Windows desktop app. The browser preview shows the settings page, but has no pet window, tray, event door, or hooks.
- A chat that stops without a final event (for example one you interrupt) stays "working" until its next event, or for at most 90 minutes.
- Pet state lives in memory: restarting Toolbox-Chan forgets running chats and red dots. Badges survive a restart of the pet window, not of the app.
- DSH detection is a guess from file times: a long step without writes can look finished, and "needs you" is not detected.
- Codex chat titles come from `~/.codex/session_index.jsonl` when Codex has named the chat.
- Bubble links open only the Claude and Codex apps. A chat link works only while that app still has the chat.
- The pet window cannot take keyboard focus, so drawing the zone uses buttons, not Enter or Esc.
- Idle moves are checked for their format, not their art: a frame that does not sit on the pets' baseline looks like it floats.

## Art and credits

**Non-commercial use only.** The pets are chibi versions of fan character art, used with credit for this personal, non-commercial project. Do not sell them or use them in a commercial product; ask the artists for any other use. See [`docs/design/agent-pets/`](../../../docs/design/agent-pets/README.md) and [third-party notices](../../../THIRD_PARTY_NOTICES.md).

| Pet | Agent | Original artist |
| --- | --- | --- |
| Claude-Chan | Claude Code | Ninon |
| Codex-Chan | OpenAI Codex | ZipZipPipe |
| DeepSeek-Chan | DeepSeek Harness (DSH) | ZipZipPipe (the reference sheet also carries the watermark @amemily2050) |

## Development notes

| Path | Owns |
| --- | --- |
| `index.ts` | Manifest: the settings workspace and the `pets` window surface |
| `window/` | The pet window: events, animation loop, hit testing, drag and click, bubbles, portals, idle moves and lines, and the zone editor |
| `model/petModel.ts` | Pet state from events: sessions, done and needs-you notices, bubbles, limit resets, counts, badges |
| `model/motion.ts` | The idle zone, walking, sleeping, walking or teleporting to the cursor, going home, falling and landing |
| `settings.ts` | Settings shared by both windows through local storage, and the zone-drawing request |
| `sprites/` | Frame library, idle moves, and sprite player |
| `assets/<agent>/`, `assets/idle-moves/` | Runtime copies of the sprite frames and demo moves in `docs/design/agent-pets/` |
| `components/` | Settings page sections |
| `services/` | Native commands for hooks, idle moves, and limits |
| `src-tauri/src/tools/agent-pet/` | Pet window, `--pet-hook` adapter, hook and status line installer, DSH watcher, limit watcher and `--pet-status-line` wrapper, idle move importer |
| `src-tauri/capabilities/agent-pet.json` | Commands for the pet window and the settings page |

- The pet window is a core [tool window](../../../docs/architecture.md#tool-windows): `index.html#tool-window/agent-pet/pets`. The native side creates it at startup, covers the work area of the screen the mouse is on, and lets clicks pass through until the page reports the pointer is over a pet.
- **Art.** The sprite frames, contact sheets, prompts, and review notes are in `docs/design/agent-pets/<claude|codex|deepseek>/`; `assets/<agent>/` holds unedited copies of each `frames/` folder. To change art, update the docs folder, then copy the frames over. Frames are found at build time by name (`idle`, `walk`, `working`, `done`, `needsyou`, `held`, `land`, `sleep`, `happy`, `laugh`, `surprised`); a missing animation falls back to a similar one.
- Open `/src/tools/agent-pet/tests/fixtures/poses.html` in the dev server (`npm run dev`) to see every pose of every pet.
- Behaviour follows the [behaviours spec](../../../docs/specs/agent-pet-behaviours.md).
- Tests: `tests/*.test.ts` (state, motion, frames, idle moves, settings), `tests/agent-pet.e2e.ts` (pet window and settings against a stand-in Tauri bridge), and Rust tests for the window, adapter, installers, watchers, and importer. The installer tests use temporary copies only.
