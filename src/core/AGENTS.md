# Core UI

- Own the toolbox shell, navigation, registry contracts, shared layouts, theme, notifications, and common platform services.
- Render tools through `ToolDefinition` contributions. Keep core independent of OCR and other tool implementations; keep tool names out of core text and tests.
- Expose tool-facing APIs only through `sdk.ts`. Tool command IDs must start with `<tool id>.`.
- Keep Settings global; tools render local preferences in their workspace and register tool-owned `ToolCommandHandler` classes for palette actions.
- Use `ToolPage` slots and shared layout primitives; keep tool-specific state, styling, and input handlers inside the tool.
- Preserve module providers across navigation. Cover contract or routing changes in `tests/`, including multiple tools and an empty registry.
