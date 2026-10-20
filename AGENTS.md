# Little Toolbox

Tauri 2 desktop app with a React/TypeScript UI and independent tool modules.

## Structure
- `src/App.tsx` connects the core to the registry in `src/tools/index.ts`.
- `src/core/` owns the shell, navigation, layouts, contracts, and shared services. See `src/core/AGENTS.md`.
- `src/tools/<id>/` owns each tool's UI, state, services, styles, and tests. OCR is in `src/tools/ocr/`; read its `AGENTS.md` before editing it.
- `src-tauri/` owns the native host and commands. See `src-tauri/AGENTS.md`.
- `scripts/` runs builds; `public/tools/`, `dist/`, `release/`, and `src-tauri/target/` contain generated output.

## Working rules
- Keep tool logic inside its module; core must not import tool implementations, and tools must not import sibling tools.
- Use core layout components and register new tools through their `ToolDefinition` manifest.
- Keep instructions scoped and concise; put implementation detail in `docs/architecture.md` or module READMEs. Do not hand-edit generated output.
- Relevant checks: `npm run check`, `npm run test:e2e`, and `npm run check:native` for Rust changes.

<!-- codebase-memory-mcp:start -->
For structural codebase exploration, use the installed `codebase-memory` skill.
<!-- codebase-memory-mcp:end -->
