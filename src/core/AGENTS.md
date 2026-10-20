# Core UI

- Own the toolbox shell, navigation, registry contracts, shared layouts, theme, notifications, and common platform services.
- Render tools through `ToolDefinition` contributions. Keep core independent of OCR and other tool implementations.
- Use `ToolPage` slots and shared layout primitives; keep tool-specific state, styling, and input handlers inside the tool.
- Preserve module providers across navigation. Cover contract or routing changes in `tests/`, including multiple tools and an empty registry.
