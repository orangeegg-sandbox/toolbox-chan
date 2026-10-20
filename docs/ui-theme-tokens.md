# UI theme tokens

Core owns these CSS custom properties on `:root`. Tool styles should consume them rather than hard-code light or dark colors. `data-theme="light"` or `data-theme="dark"` on the root reflects the resolved appearance; the user's preference can be Light, Dark, or System.

| Token | Purpose |
| --- | --- |
| `--bg` | Main app background |
| `--panel` | Cards, dialogs, inputs, and other raised surfaces |
| `--inset` | Recessed areas and subtle surface fills |
| `--sidebar` | Sidebar background |
| `--text` | Primary text |
| `--text-muted` | Supporting text |
| `--text-subtle` | Tertiary labels and decorative icons |
| `--line` / `--line-strong` | Default / emphasized borders |
| `--accent` / `--accent-hover` | Primary action and hover color |
| `--accent-soft` / `--accent-line` | Tinted accent surface / border |
| `--accent-contrast` | Text on solid accent buttons |
| `--success` / `--success-soft` / `--success-line` | Success text, surface, and border |
| `--warning` / `--warning-soft` / `--warning-line` | Warning text, surface, and border |
| `--error` / `--error-soft` / `--error-line` | Error text, surface, and border |
| `--focus-ring` | Keyboard focus outline |
| `--overlay` | Modal backdrop |
| `--shadow-sm` / `--shadow-lg` | Surface / floating-surface shadows (complete shadow values) |

Compatibility aliases remain available: `--purple: var(--accent)`, `--purple-dark: var(--accent-hover)`, and `--muted: var(--text-muted)`. `--line` and `--sidebar` retain their existing names.

Core also honors `--ui-font-scale` (default `1`) from the shared font-size preference. Use `font-size: calc(12px * var(--ui-font-scale, 1))` for visible pixel-sized UI text; intentional `font-size: 0` remains unchanged.
