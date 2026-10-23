# Agent pets

[← Toolbox-Chan](../../../README.md)

Little desktop pets that stand on your taskbar and show what your coding agents are doing: one pet each for **Claude Code** (Claude-Chan), **Codex** (Codex-Chan), and **DeepSeek Harness / DSH** (DeepSeek-Chan). A pet works, cheers when a chat finishes, and asks for you when an agent waits for an answer.

The pets run in the desktop app, in their own transparent window. They keep running while the toolbox window is closed to the tray.

## What the pets show

| State | When | What you see |
| --- | --- | --- |
| Idle | Nothing is running | The pet walks around, stops, looks around, and dozes off after a few quiet minutes |
| Working | A chat is running | Claude-Chan reads her book, Codex-Chan types at a terminal, DeepSeek-Chan sings |
| Done | A chat finished | A red dot, and the pet follows your mouse until you click it |
| Needs you | The agent asks for permission or an answer | A "?" bubble. It clears when that chat moves on, or when you click the pet |

- Done wins over working: if one chat finished while another still runs, the pet shows done.
- **×2**, **×3** next to a pet means that many chats of that agent are running at once.
- A following pet stops a little away from the pointer, so it never sits under it. Move onto the pet to click it.

## Use the pets

- **Click** a finished pet to clear its red dot (and a "?" if it has one). The pet drops back to the taskbar.
- **Click** a calm pet to make it react: happy, laugh, surprised, or sleepy.
- **Drag** a pet anywhere. It dangles while you hold it and lands with a small bounce.
- **Hover** a pet to see its latest note, such as `CustomOfflineTool · Add pet` (project folder and chat title).
- **Badges** above a pet come from other tools or programs, for example a count of open items. Clicking a badge does what its sender asked, such as opening that tool.
- Clicks anywhere else go straight through to the apps underneath.
- The pets walk on the screen your mouse is on, and move with it to another screen.
- They hide while another app is full screen, such as a video or a game.
- **Show pets** in the tray menu hides or shows all pets at once.

## Settings

Open **Agent pets** in the toolbox.

- **Pets**: turn each pet on or off, and choose its size (Small, Medium, or Large).
- **Try the pets**: send test events (Working, Done, Needs you, Idle) and a test badge to every pet that is on.
- **Event door**: the address outside programs post to (`http://127.0.0.1:47615/pet/events`) and whether it is listening, with a `curl` example to copy.
- **Agent hooks**: install, check, or remove the hooks below.
- **Art credits**: who drew the characters.

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
| `window/` | The pet window: events, animation loop, hit testing, drag and click |
| `model/petModel.ts` | Pet state from events: sessions, done and needs-you notices, counts, badges |
| `model/motion.ts` | Walking, sleeping, following the cursor, falling and landing |
| `sprites/` | Frame library and sprite player |
| `assets/<agent>/` | Runtime copies of the sprite frames in `docs/design/agent-pets/<agent>/frames/` |
| `components/` | Settings page and hooks section |
| `src-tauri/src/tools/agent-pet/` | Pet window, `--pet-hook` adapter, hook installer, DSH watcher |
| `src-tauri/capabilities/agent-pet.json` | Commands for the pet window and the hooks section |

- The pet window is a core [tool window](../../../docs/architecture.md#tool-windows): `index.html#tool-window/agent-pet/pets`. The native side creates it at startup, covers the work area of the screen the mouse is on, and lets clicks pass through until the page reports the pointer is over a pet.
- **Art.** The sprite frames, contact sheets, prompts, and review notes are in `docs/design/agent-pets/<claude|codex|deepseek>/`; `assets/<agent>/` holds unedited copies of each `frames/` folder. To change art, update the docs folder, then copy the frames over. Frames are found at build time by name (`idle`, `walk`, `working`, `done`, `needsyou`, `held`, `land`, `sleep`, `happy`, `laugh`, `surprised`); a missing animation falls back to a similar one.
- Open `/src/tools/agent-pet/tests/fixtures/poses.html` in the dev server (`npm run dev`) to see every pose of every pet.
- Tests: `tests/*.test.ts` (state, motion, frames, settings), `tests/agent-pet.e2e.ts` (pet window and settings against a stand-in Tauri bridge), and Rust tests for the window, adapter, installer, and watcher. The installer tests use temporary copies only.
