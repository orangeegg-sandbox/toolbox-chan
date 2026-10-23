# Toolbox-Chan

Tauri 2 desktop app with a React/TypeScript UI and independent tool modules.

## Structure
- `src/App.tsx` connects the core to the registry in `src/tools/index.ts`.
- `src/core/` owns the shell, navigation, layouts, contracts, and shared services. See `src/core/AGENTS.md`.
- `src/tools/<id>/` owns each tool's UI, state, services, styles, and tests. OCR is in `src/tools/ocr/`; read its `AGENTS.md` before editing it.
- `src-tauri/` owns the native host and commands. See `src-tauri/AGENTS.md`.
- `scripts/` runs builds; `public/tools/`, `dist/`, `release/`, and `src-tauri/target/` contain generated output.

## Working rules
- Keep tool logic inside its module; core must not import tool implementations, tools import core only through `src/core/sdk.ts`, and tools must not import sibling tools.
- Use core layout components and register new tools through their `ToolDefinition` manifest.
- Follow `docs/design-system.md` for UI: use the tokens in `src/core/appearance/theme.css`, never raw colors or pixel font sizes.
- Keep instructions scoped and concise; put implementation detail in `docs/architecture.md` or module READMEs. Do not hand-edit generated output.
- Relevant checks: `npm run check`, `npm run test:e2e`, and `npm run check:native` for Rust changes.
- If browser tests time out on `page.goto` with a blank page, the Vite dev server is usually stalled, not the code: agent worktrees under `.claude/worktrees/` and other large folders inside the project slow it down. Keep `vite.config.ts` ignoring them, run the Rust checks separately, and see "When browser tests time out" in `docs/development.md`.

## Documentation
- Keep the root `README.md` to a short app introduction, a Tools table, and links to shared documentation.
- Give every Tools table row an icon, tool name, short description, and separate relative links to `src/tools/<id>/` and `src/tools/<id>/README.md`. Update the table when adding, renaming, or removing a tool.
- Give every tool a user-facing README in its own folder with usage, settings, shortcuts, and relevant limitations; keep module-specific development notes there too.
- Keep shared setup, builds, and checks in `docs/development.md`, and architecture details in `docs/architecture.md`.

<!-- codebase-memory-mcp:start -->
For structural codebase exploration, use the installed `codebase-memory` skill.
<!-- codebase-memory-mcp:end -->

## Other agents
This project uses tower (rules in TOWER.md). Before a large task, or a subtask you could hand off, use the `tower` skill.
