# Pet frames

Runtime copies of the pet sprite frames go here, one folder per agent:

```text
assets/claude/<name>-<n>.png
assets/codex/<name>-<n>.png
assets/deepseek/<name>-<n>.png
```

Copy them from `docs/design/agent-pets/<agent>/frames/`. Each frame is a 256×256 transparent PNG facing right, with the feet at about y = 244. The names are listed in [the art brief](../../../../docs/design/agent-pets/art-brief.md). Until a folder has frames, that pet uses the placeholder drawing in `../sprites/PlaceholderPet.tsx`.
