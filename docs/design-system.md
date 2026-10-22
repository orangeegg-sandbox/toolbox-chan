# Design system: Mint Pocket Helper

[← Toolbox-Chan](../README.md)

Toolbox-Chan should feel like a calm developer tool that happens to have a mascot, not a mascot page with tools attached. The colors come from the character art in [`docs/design/toolbox-chan/mint-pocket-helper-v2/`](design/toolbox-chan/mint-pocket-helper-v2/); the UI uses them sparingly, with fixed jobs.

The tokens live in [`src/core/appearance/theme.css`](../src/core/appearance/theme.css). That file is the source of truth for values; this page explains how to use them.

## Principles

1. **Neutral first.** Surfaces are near-neutral greys with a faint ink tint. Color marks meaning, never decoration.
2. **One accent.** Pine (light) or mint (dark) marks the primary action, the current selection, and links. Use at most one primary button per view.
3. **Borders, not shadows.** Flat surfaces are separated by 1px lines. Shadows are only for floating layers.
4. **Plain words.** Labels say what things do. No slogans, taglines, or marketing copy.
5. **The character has a place.** The pixel head is the logo. Two small peeking poses watch from the sidebar's edge and over the command palette. The full-body art appears only on empty and idle screens.

## Palette

### Brand colors

Sampled from the turnaround sheet's swatches and the full-body art. These `--brand-*` tokens are for artwork and swatches only; components never use them directly.

| Token | Hex | From the character | Job in the UI |
| --- | --- | --- | --- |
| `--brand-mint` | `#9bd6c5` | Jacket, hair tips | Accent in dark mode. Darkened to pine for light mode. |
| `--brand-petrol` | `#2c5768` | Trousers, headband, toolbox | Hue of the neutral ink ramp. |
| `--brand-lavender` | `#b899dc` | Eyes, toolbox handle | Keyboard focus and info. Her eyes show where she's looking. |
| `--brand-butter` | `#fed986` | Sticky notes, notebook | Notes, hints, warnings, and OCR highlight regions. |
| `--brand-ivory` | `#faf0e7` | Shirt | Artwork backgrounds only. |
| `--brand-ink` | `#16242b` | Line art | Base of the dark surfaces and light-mode text. |

### Semantic tokens

Components read these. Each has a light and a dark value.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f5f7f7` | `#111617` | Page background behind content |
| `--sidebar` | `#eef2f2` | `#151b1c` | Sidebar |
| `--panel` | `#ffffff` | `#1a2022` | Cards, panels, topbar, inputs, dialogs |
| `--inset` | `#f2f5f5` | `#14191a` | Wells inside panels: drop zones, previews, `kbd`, segmented controls |
| `--hover` | ink 5% | white 5% | Hover fill on any surface |
| `--text` | `#172225` | `#e3e9e9` | Primary text |
| `--text-muted` | `#4d5b5e` | `#a3afb1` | Secondary text and descriptions |
| `--text-subtle` | `#5f6c6f` | `#849193` | Metadata, placeholders, icons |
| `--line` | `#e1e7e7` | `#263033` | Default 1px border and dividers |
| `--line-strong` | `#c8d1d2` | `#36444a` | Control borders (buttons, selects, inputs) |
| `--accent` | `#1d6f5f` | `#9bd6c5` | Primary button fill, links, selected text, active icons |
| `--accent-hover` | `#175a4d` | `#b5e3d6` | Hover for accent fills |
| `--accent-soft` | `#e3f2ed` | `#1c322e` | Selected row or nav item background |
| `--accent-line` | `#b5dccf` | `#2f5a50` | Border of accent-tinted or hovered cards |
| `--accent-contrast` | `#ffffff` | `#0f2a26` | Text on `--accent` |
| `--lilac`, `-soft`, `-line` | `#6b4ea0` … | `#c4a8ea` … | Info states |
| `--butter`, `-soft`, `-line` | `#7a5600` … | `#f2d083` … | Notes and hints |
| `--success`, `-soft`, `-line` | `#2a7a4a` … | `#8fd4a6` … | Success status |
| `--warning`, `-soft`, `-line` | `#8a5d00` … | `#f2d083` … | Warning status (same family as butter) |
| `--error`, `-soft`, `-line` | `#b3343f` … | `#f0a2a8` … | Errors and destructive hover |
| `--focus-ring` | `#7c5cb5` | `#c4a8ea` | 2px focus outline |
| `--overlay` | ink 40% | black 70% | Dialog backdrop |
| `--shadow-sm`, `--shadow-lg` | | | Floating layers only |

Every text pair meets WCAG AA (4.5:1) on the surfaces it is used on. For example, pine on white is 6.0:1, white on pine is 6.0:1, subtle text on the sidebar is 4.8:1, and mint on the dark panel is 10:1.

### Color rules

- Use semantic tokens. Never write a hex value or a `--brand-*` token in component CSS.
- Tinted state: `-soft` background with the base color as text (selected nav item, palette row).
- Filled control: `--accent` background with `--accent-contrast` text (primary button, checked toggle).
- Lavender and butter carry meaning (focus, info, notes, warnings). Don't use them to decorate icons or cards.
- No gradients, glows, blur, or colored shadows.

## Typography

| Role | Stack |
| --- | --- |
| UI (`--font-sans`) | Segoe UI Variable, Segoe UI, system UI fonts |
| Mono (`--font-mono`) | Cascadia Mono, Cascadia Code, JetBrains Mono, Consolas |

Use mono for keyboard shortcuts (`kbd`), counts, version numbers, and tags such as `OCR`.

Every size is a token that follows the Text size setting. The app defaults to 125%.

| Token | Base | At 125% | Use |
| --- | --- | --- | --- |
| `--fs-2xs` | 9px | 11.25px | Tags, `kbd`, uppercase group labels, fine print |
| `--fs-xs` | 10px | 12.5px | Captions, metadata, setting descriptions |
| `--fs-sm` | 11px | 13.75px | Buttons, controls, secondary body text |
| `--fs-md` | 12px | 15px | Body text, nav items, panel titles |
| `--fs-lg` | 13px | 16.25px | Card and section titles, root size |
| `--fs-xl` | 16px | 20px | Dialog titles, sub-page titles, palette input |
| `--fs-2xl` | 20px | 25px | Page titles |

- Weights: 400 regular, 500 medium, 600 semibold. Nothing heavier.
- Sentence case everywhere. Uppercase only for tiny group labels (sidebar groups, palette sections), set with `text-transform: uppercase` and `letter-spacing: 0.06em`.
- Never write `font-size` in px; use a `--fs-*` token.

## Shape, space, and depth

| Token | Value | Use |
| --- | --- | --- |
| `--radius-xs` | 4px | Tags, `kbd`, step numbers |
| `--radius-sm` | 6px | Buttons, inputs, selects, nav items, list rows |
| `--radius-md` | 8px | Panels, cards, drop zones, toasts |
| `--radius-lg` | 12px | Dialogs, command palette, expanded overlays |
| `--radius-full` | 999px | Dots and toggles |

- Spacing follows a 4px grid: `--space-1` (4px) through `--space-10` (40px). Older rules still have some off-grid values; snap them to the grid when you touch them.
- Borders are 1px solid. Dashed borders mean "drop or fill something here" (drop zones, empty output).
- Surfaces are flat. Only dialogs, the palette, toasts, and the expanded OCR comparison use `--shadow-lg`.

## Components

Reuse these classes and core components before writing new styles.

| Component | Where | Rules |
| --- | --- | --- |
| Page heading | `ToolPage` (`.page-heading`) | 40px icon tile, `--fs-2xl` title, optional mono tag, one-line subtitle |
| Panel | `ToolPanel` (`.workspace-panel`) | 48px header with title, optional step number, and actions |
| Primary button | `.button.primary` | One per view; the main action only |
| Secondary button | `.button.secondary` | Default for everything else |
| Text and icon buttons | `.text-button`, `.icon-button` | Toolbars and inline actions; hover uses `--hover` |
| Select | `.select-wrap` | Wraps a native `select` with a chevron icon |
| Card | `.tool-card` | Border only; hover changes the border to `--accent-line`. No lift or shadow. |
| Tag | `.small-tag` | Mono, neutral. Not for status. |
| Segmented control | OCR `.mode-tabs` | Inset track; selected item is a panel-colored chip |
| Settings | `.settings-card`, `.setting-row`, `.settings-note` | One card per topic, label left and control right |
| Banners | `.error-banner`, `.info-banner` | Error uses error tokens; info stays neutral |
| Toast | `.toast` | Neutral surface; the icon carries the status color |
| Empty state | `EmptyState` from `src/core/layout` | Title, one sentence, optional action, optional character art |
| Topbar status | `.privacy-pill`, `.green-dot` | A dot and short label, not a badge |

Icons come from `lucide-react`: 16px in nav and buttons, 14–15px in dense toolbars, and 18–20px in headings. Icons use the text color; only the tool's own icon uses `--accent`.

## Character usage

| Asset | File | Where |
| --- | --- | --- |
| Pixel head | `src/core/assets/toolbox-chan-head.png` | App icon and the 32px sidebar logo |
| Side peek | `src/core/assets/toolbox-chan-peek-side.png` | Sidebar background, peeking in from its right edge and resting on the version divider (220px tall, 22% opacity, 14% in dark, hidden when the window is shorter than 640px or the sidebar collapses) |
| Top peek | `src/core/assets/toolbox-chan-peek-top.png` | Peeks over the command palette's top edge near its right corner (88px tall, full opacity, rises in after the palette opens, hidden in the floating palette and in small windows) |
| Full body | `src/core/assets/toolbox-chan.png` | `EmptyState mascot` (55% opacity, 35% in dark) and the idle home page (16% opacity, 9% in dark, hidden below 1100px) |
| Face sheet | `docs/design/toolbox-chan/mint-pocket-helper-v2/02-faces-emotes.png` | Not shipped. Cut single faces (96px or smaller) if a status needs one: Thinking for work in progress, Eureka for success, Sorry for errors. |

- The art sits outside content, or behind it at low opacity. It never covers text or controls, and it never takes clicks.
- Peeking poses always look at the user and are cut flat where they meet a UI edge. Source files and prompts are in `docs/design/toolbox-chan/mint-pocket-helper-v2/`.
- No hero banners, circles or frames behind the character, sparkles, or speech bubbles.

## Writing

- Short, sentence case, verb-first buttons: "Extract text", "Clear history".
- No slogans or taglines ("A little…", "Built for…"), no eyebrow text above titles, and no exclamation marks.
- Empty states say what's missing and how to fill it.
- Privacy notes state facts: "Images are processed on this device."

## Motion

- `--duration-fast` (120ms) for hover and press; `--duration-base` (180ms) for toggles and panels; `--ease-out` for both.
- No bounce, lift, or scale on hover.
- The global `prefers-reduced-motion` rule in `styles.css` turns animation off.

## Checklist for new UI

- [ ] Only semantic tokens for color, `--fs-*` for size, `--radius-*` for corners, and `--space-*` for new spacing.
- [ ] Looks right in light and dark, and at 100% and 175% text size.
- [ ] At most one primary button, and no decorative color.
- [ ] Reuses the classes and components above.
- [ ] Copy follows the writing rules.
