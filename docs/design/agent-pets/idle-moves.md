# Idle moves

An idle move is a short extra animation a pet plays now and then while it has nothing to do. Anyone can make one, for example with an image AI, and add it in **Agent pets → Idle moves → Add idle move**. Each move belongs to one pet, because the art is drawn for that character.

## Folder format

One folder per move. The folder name does not matter; `<agent>-<name>` keeps things tidy.

```text
claude-stretch/
  move.json
  stretch-1.png
  stretch-2.png
  stretch-3.png
  stretch-4.png
```

`move.json`:

```json
{
  "format": 1,
  "agent": "claude",
  "name": "stretch",
  "label": "Stretch",
  "fps": 6,
  "loops": 2
}
```

| Field | Rule |
| --- | --- |
| `format` | Always `1`. |
| `agent` | `claude`, `codex`, or `deepseek`. |
| `name` | 1–24 lowercase letters or digits, starting with a letter. Frames are named `<name>-<n>.png`. |
| `label` | Optional. Shown in settings; at most 40 characters. |
| `fps` | Frames per second, 1–24. |
| `loops` | How many times the move plays each time, 1–10. |

Frames:

- `<name>-1.png`, `<name>-2.png`, … with no gaps; 1–24 frames.
- PNG, exactly 256×256, with a transparent background.
- The same rules as the pet's own frames ([art brief](art-brief.md)): facing right, feet on one baseline at about y = 244, the same character scale as the pet's `idle` frames.
- No text, speech bubbles, question marks, red dots, badges, or UI. The app draws those.
- At most 1 MB per frame.

When you add a move, Toolbox-Chan checks `move.json`, the frame names, and that every frame is a 256×256 PNG of at most 1 MB, and refuses the folder with the reason if not. The art itself (transparency, baseline, scale) is not checked: a frame drawn off the baseline makes the pet look like it floats.

## Prompt for an image AI

Give the AI the character's reference sheet from [`references/`](references/) and one of the pet's frames, such as `<agent>/frames/idle-1.png`, then this prompt. Replace the parts in ‹angle brackets›.

```text
Draw a short looping sprite animation of ‹character name› from the attached reference,
as a cute moe chibi about 2.5 heads tall, clean anime line art with soft cel shading.
Match the attached idle frame exactly: same face, hair, outfit, colours, and size.

Move: ‹what she does, for example "stretches both arms over her head, yawns, then relaxes"›.
It plays while she is idle, so it starts and ends close to a calm standing pose.

Make ‹4–6› frames as ONE horizontal strip of equal square cells, in order, left to right.
Facing right, three-quarter view. Feet stay on the same ground line in every cell,
unless the move is a hop. Same character scale in every cell.
Transparent background. If transparency is not possible, use flat pure #00FF00 so it can be keyed out.
No text, speech bubbles, question marks, badges, UI, shadows on the ground, or scenery.
Modest outfit.
```

Then cut the strip into frames:

1. Slice the strip into equal cells.
2. Remove any stray specks and any slivers of the neighbouring cell.
3. Scale every cell by the same factor, so the character is as tall as in `idle-1.png`.
4. Place each cell on a transparent 256×256 canvas, centred, with the lowest visible pixel at y = 244.
5. Save as `<name>-<n>.png`, and write `move.json`.

## Demo moves

`idle-moves/` holds one demo move per pet in this format. Each folder also keeps the art record (`sheet.png`, `prompts.json`, `review.json`), like the pets' own frames. The app ships unedited copies of each `move.json` and its frames in `src/tools/agent-pet/assets/idle-moves/`.
