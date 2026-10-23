# Pet frames

Runtime copies of the pet sprite frames go here, one folder per agent:

```text
assets/claude/<name>-<n>.png
assets/codex/<name>-<n>.png
assets/deepseek/<name>-<n>.png
```

Copy them from `docs/design/agent-pets/<agent>/frames/`. Each frame is a 256×256 transparent PNG facing right, with the feet at about y = 244. The names are listed in [the art brief](../../../../docs/design/agent-pets/art-brief.md). Keep these files identical to the ones in the docs folder; edit art there, then copy it here. `tests/sprites.test.ts` checks that every pet has every animation.
