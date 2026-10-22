# Agent pet art brief

The full request for the chibi pet sprites. Give it as-is to an image-capable agent (for example Codex with its built-in image generation). Credits and the non-commercial notice are in [README.md](README.md).

## Inputs

| Character | Reference | Output folder |
| --- | --- | --- |
| Claude-Chan (by Ninon) | [references/claude-chan-reference.webp](references/claude-chan-reference.webp) | `claude/` |
| Codex-Chan (by ZipZipPipe) | [references/codex-chan-reference.webp](references/codex-chan-reference.webp) | `codex/` |
| DeepSeek-Chan (by ZipZipPipe) | [references/deepseek-chan-reference.webp](references/deepseek-chan-reference.webp) | `deepseek/` |

Record the work like the Toolbox-Chan art in [`../toolbox-chan/mint-pocket-helper-v2/`](../toolbox-chan/mint-pocket-helper-v2/) (`prompts.json`, `review.json`).

## Style

Cute moe chibi, about 2.5 heads tall, clean anime line art with soft cel shading, modest outfits. Keep each character's face, hair, eye color, outfit and signature items recognisable from the reference.

- **Claude-Chan:** very long straight orange hair, orange eyes, orange sunburst flower hair ornament with a black ribbon bow, cream high-collar blouse, black cravat with an orange flower brooch, black corset, long cream skirt layered with black and orange panels with gold embroidery and orange tassels, cream lace-up heeled boots, carries a brown book with an orange sunburst on the cover. The blouse is fully covered (no chest cutout). Working pose: reading or writing in her book.
- **Codex-Chan:** long wavy white hair with a pale lavender-blue tint, small blue-white dragon horns, pointed ears, sleepy half-closed blue eyes, blue cloud hairclip with a `>_` terminal symbol, white swirl-knot hair ornament with a tassel, white off-shoulder ruffled dress with long puffy sleeves and blue ribbons, chest pocket with pens, pale blue scaled dragon tail, fluffy white slippers. Working pose: typing on a small floating terminal or laptop.
- **DeepSeek-Chan:** long wavy navy hair fading to bright blue at the ends, ahoge, big blue eyes, white frilly maid headband, navy whale-fin ears with white undersides, light-blue bows, navy maid dress with a white frilly apron showing a small blue whale emblem, white frilly socks, navy Mary Jane shoes, navy horizontal whale tail fluke at the back. Working pose: singing (one hand raised, mouth open).

## Frames

Transparent RGBA PNG, every frame exactly 256×256, the same character scale in every frame, feet on one baseline at about y = 244, facing right (the app mirrors for left). Save as `<folder>/frames/<name>-<n>.png`:

| Name | Frames | Pose |
| --- | --- | --- |
| `idle` | 1–4 | Breathing, blinking, looking around |
| `walk` | 1–6 | A walk cycle that loops |
| `working` | 1–4 | The working pose above, looping |
| `done` | 1–3 | Cheering, proud |
| `needsyou` | 1–2 | Puzzled, head tilt, small wave for attention |
| `held` | 1–2 | Dangling while picked up by the collar, legs swinging |
| `land` | 1–2 | Landing squash, then recovering |
| `sleep` | 1–2 | Sitting and dozing |
| `happy`, `laugh`, `surprised` | 1–2 each | Emotes; faces may follow the reference expression panels |

No text, speech bubbles, question marks, red dots, badges or UI in the art; the app draws those.

For consistency, generate each animation as one horizontal strip, then slice it into frames. Without real transparency, use a flat pure `#00FF00` background and key it out with no green fringe.

## Deliverables per folder

- `frames/` with every frame above.
- `sheet.png`: a labelled contact sheet of all frames in order.
- `prompts.json`: the generator and prompts used.
- `review.json`: date, character, artist credit, every frame file with its size, and known issues.
