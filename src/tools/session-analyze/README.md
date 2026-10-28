# Session analyze

[← Toolbox-Chan](../../../README.md)

Inspect Codex, Claude Code, and DeepSeek Harness (DSH) sessions locally. No model or network service is used. Session files are never changed.

## Use

Open **Session analyze → Sessions**. The desktop app discovers chats and reads bounded previews, grouped by project. Search titles, project paths, or IDs; filter by project, agent platform, and Tower origin. Search checks the full discovered catalog, and all matching sessions are shown directly. Platform bars show session counts and act as filters. Select **Analyze** to open the full-width **Analysis** tab. Switching between these tabs preserves the selected report and session filters. **Refresh sessions** refreshes previews without analyzing every chat.

Use **Display mode** to switch between **By project** and **By date — newest first**. Date mode groups sessions by local calendar day and sorts them by last-modified time, newest to oldest, with the project shown on each row. Sessions without a usable date appear last. Switching views keeps search and filters; every matching session remains available without paging.

The selected session's title, project, cost, and usage sit beside the tool heading. Flow, Skills, MCP, Tools, and Context use separate chart and reading panes. All matching events are available in one scrollable list. The reading pane keeps source order, search, and outcome filters visible while events scroll, and marks the currently visible event range. Hover or focus a frequency row or legend to highlight its related timeline records. Subviews color individual activities and retain their position across the full session, including gaps.

The report provides:

- **Overview:** event counts, a source-order activity strip, call outcomes, and frequency bars. Select a bar to inspect its matching evidence. Result records and duplicate calls are excluded from call totals; uncertain calls and skill-file requests are identified separately.
- **Flow:** recorded messages, context, tool calls and results, skills, MCP calls, and compactions in source order. Expand an event to inspect its evidence.
- **Skills / MCP / Tools:** separate counts, frequency charts, and evidence lists, with MCP server grouping and command frequency. Command groups use the first literal executable; compound scripts count once. Available skill catalogs are context, not proof of skill use. Calls recovered from orchestration script literals are marked **unknown** because branches may not execute.
- **Files:** concrete read, write, search, and list targets with evidence and a link to the corresponding event. Explicit means a path was named by a tool, not that every byte was read. Shell-derived paths are inferred, including literal directory changes within a command; dynamic or ambiguous shell paths are not guessed.
- **Context:** recorded instructions and compactions, repeated reads, and the largest text events by character count. These are investigation aids, not an automatic verdict of context pollution.
- **Cost:** recorded provider or matching Tower cost where available; otherwise an API token estimate when complete usage and matching JSON prices are available. Mixed models use their own rates at each recorded usage timestamp. Unknown or incomplete pricing stays visible as a partial subtotal. Recorded costs are preserved.

**Scan project structure**, on the Files view, builds a proportional folder map and expandable directory tree, including untouched files, empty folders, and visible excluded folders. Select a folder to explore nested contents; use breadcrumbs to return or search all inventoried paths. Color and text distinguish read, written, both, untouched, and excluded entries. Only file metadata is scanned, except for `.gitignore` rules when enabled.

Files has independently scrolling **Project structure** and **Recorded file operations** panes. The **Structure activity** filter shows touched, read, written, untouched, or excluded entries while retaining their parent folders. It filters the map, tree, and path search together; recorded operations keep their own search and filter. **Recorded paths not mapped** explains read/write records that are absent from the snapshot, outside the project, or unresolved. Those records remain available as evidence and do not inflate coverage counts.

Inventories are cached per project and scan scope in the app's data folder under `tools/session-analyze/projects`. Each session's recorded file activity is applied separately. The snapshot time and cache status are shown; **Rescan project** refreshes the saved tree. By default the contents of `.git`, `node_modules`, `vendor`, `target`, `dist`, `build`, `.tools`, and `.claude` are excluded. **Include dependency and build folders** expands the scope; `.git` and links remain excluded. Folder contents, expanded tree rows, and search results are directly scrollable without paging. Scan limits or inaccessible entries produce a partial-inventory warning.

Enable **Respect .gitignore** to read bounded `.gitignore` files and hide matching entries from the structure, including Git-style exceptions. Projects inside a Git repository inherit rules from the nearest repository root down to the selected project, then apply nested rules. Without a repository, only the selected project and its descendants supply rules. Global ignore files and `.git/info/exclude` are not consulted. Recorded file operations remain intact. Rules are cached with the inventory; **Rescan project** picks up rule changes. Skipped-entry counts include encountered ignored files and folders, not the unenumerated contents of ignored folders. Invalid rules or read limits are disclosed as a partial snapshot.

Coverage uses unique paths in the **saved filesystem snapshot**, not a historical checkout. Failed calls, directory listings, and searches do not increase the read count. Missing, outside-project, and unresolved paths are reported separately. A complete inventory means the selected scope was listed within scan limits; coverage does not prove what reached the model's context window.

**Export JSON** saves the portable report. **Import report** accepts that format from any agent and works in the browser preview too. Imports do not access paths mentioned inside the report; local coverage requires its own explicit action. Reports can contain private prompts, tool output, and paths, so review the JSON before sharing it. Reports and estimates remain in memory while navigating the app; export anything you want to retain after closing it.

## Agent conversion skill

The distributable [session-analyze skill](../../../skills/session-analyze/SKILL.md) tells other agents how to convert their accessible session exports. Copy that folder into your agent's skill directory, or provide its instructions and the linked schema to an agent that does not support skills. It includes a [JSON Schema](../../../skills/session-analyze/references/general-chat-analyze.schema.json) and a [synthetic example](../../../skills/session-analyze/references/example.json). The app does not install or inject the skill into other agents automatically.

## Sources and settings

**Cost → Open pricing folder** opens editable model prices in the app's data folder under `tools/session-analyze/pricing` (on Windows, normally `%APPDATA%/com.littletoolbox.desktop/tools/session-analyze/pricing`). The first load seeds DeepSeek prices, a `model.example` template, and instructions. Add or edit `.json` files, then **Reload prices**. Reanalysis uses the latest files; **Use JSON estimate in report** applies a recalculated estimate to an existing report. Reloads and app updates preserve your files. The browser preview uses bundled prices only.

See [pricing format and maintenance](pricing/README.md) for effective dates, exact model IDs, cache buckets, timezone schedules, and holiday overrides. Bundled DeepSeek rates are verified from October 27, 2026, with holiday coverage through December 2026; add verified history or future calendar entries as needed. Other models need their own verified prices. Token estimates exclude subscriptions and non-token fees. The manual whole-session calculator remains available for sessions where you can supply one applicable rate set.

Session discovery needs no configuration. The desktop app respects the same home overrides as the agents:

| Agent | Default session folder | Override |
| --- | --- | --- |
| Codex | `~/.codex/sessions` | `CODEX_HOME` |
| Claude Code | `~/.claude/projects` | `CLAUDE_CONFIG_DIR` |
| DSH | `~/.dsh/sessions` | `DSH_HOME` |

Codex's session index and DSH's existing project cache improve preview titles. Tower matching uses project `.tower/tasks/T-*.json` records, comparing the delegated platform and session ID. Absence of a matching task is **Unknown**, not proof of **No**. **No** is available for imported reports with affirmative provenance.

Tab bars support Left/Right arrows and Home/End. All controls support normal keyboard navigation, and the app's shared command palette opens the tool. Search matches are highlighted in session previews and report evidence.

## Limits and development

Logs cannot prove the exact context window used by the model. Unlogged system prompts, hook injections, silently read files, omitted outputs, and old format variants may be unavailable. Context sources may be larger than the retained event text; warnings disclose truncation. Costs may be absent or incomplete. Fork history is visible and usage attribution depends on recorded boundaries. Codex Desktop copies imported from other agents may contain only message text and placeholder usage; the analyzer flags these limits. Event locators use parsed-record ordinals, which can differ from physical line numbers after damaged records are skipped.

Discovery reads at most 64 KiB per session (DSH preview decompression up to 256 KiB), up to 5,000 sessions. Full analysis reads at most 64 MiB decoded text (256 MiB stored DSH input), 100,000 records, 50,000 report events, and 8 MiB of event text. Portable JSON imports/exports are capped at 20 MiB. Oversized, corrupt, or incomplete records produce warnings; unsupported formats fail visibly. Coverage has entry, depth, path-memory, and time limits.

Frontend state, report views, and import validation live here. Native discovery, parsing, coverage, and commands live in `src-tauri/src/tools/session-analyze/`. Native command permissions are restricted to the main toolbox window. `types.ts`, native `model.rs`, the runtime importer, and the skill's schema define the same version-1 general chat analyze object.

Run `npm run check`, `npm run check:native`, and `npx playwright test src/tools/session-analyze/tests`. Read [test guidance](../../../docs/test/README.md) first. Fixtures cover provider usage, file evidence, path boundaries, corrupt/truncated logs, cached coverage, command permissions, chart drilldowns, and map navigation. An ignored `replay_local_catalog` native test checks actual local formats and prints counts only; it runs only when explicitly selected.
