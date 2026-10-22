# Toolbox modules and layout

The app uses Tauri for the native window and React for its UI. React already represents the interface as a component tree. The core owns the application tree; a tool contributes a subtree through a small typed contract. React's `children` and named JSX props provide the layout slots. There is no additional JSON layout format or imperative DOM injection.

## Folder structure

```text
src/
  App.tsx                       # Composition root: core + registered tools (loaded lazily)
  core/
    sdk.ts                      # The only core entry point tools may import
    ToolboxApp.tsx              # Shell, provider lifecycle, current route, notifications
    ToolboxContext.tsx          # Shared navigation and notification services
    appearance/                # Theme and font size providers, design tokens
    assets/                    # Toolbox-Chan artwork
    components/                # Sidebar, command palette, shortcuts dialog
    layout/                    # ToolPage, SplitPane, ToolPanel, EmptyState
    pages/                     # Tool library, global settings, tool activity host
    commands/                  # Shared command handler contract, registry, native bridge
    platform/                  # Shared clipboard text and native text export
    tools/                     # ToolDefinition contract and registry
    tests/                     # Registry, dependency boundaries, two-tool fixture integration
    styles.css                 # Shared controls, shell, and layout styles (tokens: appearance/theme.css)
  tools/
    index.ts                    # Explicit list of installed modules
    ocr/
      index.ts                  # OCR manifest and lazy-loaded surfaces
      OcrProvider.tsx           # OCR session state, actions, resource lifecycle
      OcrCommandHandler.ts     # OCR command definitions, availability, action mapping
      OcrCommands.tsx          # Registers the handler against current OCR state
      components/              # Workspace, panels, settings, activity, image overlays
      services/                # Offline/online recognition, images, image clipboard
      types.ts                 # OCR-specific types and language choices
      constants.ts
      storage.ts               # OCR settings/history persistence
      ocr.css                  # OCR styles scoped beneath .ocr-tool
      scripts/prepare-assets.mjs
      tests/                   # OCR unit and integration tests

src-tauri/
  build.rs                     # App command list; turns on the per-window command ACL
  capabilities/                # default.json (core, main), palette.json (popup), ocr.json (OCR)
  src/lib.rs                   # Native composition root; explicit command registration
  src/platform/text_export.rs  # Shared save dialog and text export
  src/platform/palette_*.rs    # Global palette shortcut and floating palette window
  src/tools/ocr/online.rs      # OCR HTTP requests, cancellation, endpoint validation
  tests/command_acl.rs         # Each window reaches only its granted commands

scripts/prepare-tools.mjs       # Discovers optional tool-owned asset preparation scripts
public/tools/ocr/               # Generated offline assets; ignored by Git
```

## The layout tree

```text
ToolboxApp
  ToolboxContext               navigation, registered tools, notifications
    Tool providers             retained across navigation
      ToolboxShell
        Sidebar                built from registry metadata
        Topbar                 core title + optional tool Status contribution
        main
          Tool.Workspace
            ToolPage           core layout, filled by the tool
              heading          core renders the tool's metadata
              toolbar slot     tool controls
              description slot tool instructions
              children slot    any tool-owned React subtree
                SplitPane      optional shared two-pane layout
                  ToolPanel    input or primary UI
                  ToolPanel    output or secondary UI
              footer slot      tool actions or status
              hint slot        tool help
        Footer
        Dialogs                core search and help
```

The core hosts optional `Tool.Activity` contributions on Recent activity. Global Settings contains only appearance, text size, and palette preferences. Each tool renders its own settings inside its workspace; tool settings are not a manifest contribution to the global page. There is no OCR-specific route branch in the core. An empty registry also works.

`ToolPage` is the normal starting point for a tool's workspace. Its `children` are flexible: a tool can use the shared `SplitPane`, use a single `ToolPanel`, or compose another layout. Core controls the surrounding shell and common layout primitives; the tool controls the content inside those regions. This keeps styling and navigation consistent without forcing every utility to have OCR's input/output structure.

## Register a new tool

Create `src/tools/example/index.tsx`:

```tsx
import { Wrench } from "lucide-react";
import { ToolPage, ToolPanel, type ToolDefinition, type ToolSurfaceProps } from "../../core/sdk";

function ExampleWorkspace({ tool }: ToolSurfaceProps) {
  return (
    <ToolPage tool={tool} toolbar={<p>Your tool's controls go here.</p>}>
      <ToolPanel title="Your workspace">
        <p>Build your tool's UI inside this core-owned layout.</p>
      </ToolPanel>
    </ToolPage>
  );
}

export const exampleTool = {
  id: "example",
  name: "Example tool",
  description: "What this utility does.",
  category: "Utilities",
  icon: Wrench,
  Workspace: ExampleWorkspace,
} satisfies ToolDefinition;
```

Then import it in `src/tools/index.ts` and append it to `tools`. Navigation, tool count, library cards, search, and the workspace host update from that registry. The core does not need an import or a route case for the new tool. For a larger tool, use `React.lazy` for its workspace and activity components; the core supplies a Suspense fallback. Render module-specific settings from the workspace.

Optional manifest members:

| Member | Responsibility |
| --- | --- |
| `Provider` | Tool-owned session state shared by its surfaces |
| `Activity` | Recent activity contribution |
| `Status` | Status content in the core topbar |
| `shortcuts` | Metadata shown in the core help dialog; implement the matching handlers in the tool |
| `keywords` | Extra search terms for the command palette; the tool ID, badge, category, name, and description are searchable automatically |
| `Commands` | Lightweight component beneath the retained tool providers; call `useToolCommands(handler, state)` with the tool's command handler class |
| `subtitle`, `badge` | Core page heading metadata |

Use `useToolbox()` for `openTool(id)`, `openSettings()`, `navigate(route)`, `notify(message, isError)`, and the platform keyboard modifier. `openSettings()` opens global preferences. Tools should provide their own action for opening local settings on their workspace. The context also exposes the current route and registered tool metadata. It does not expose another tool's state.

## Tool command handlers

Each tool that contributes actions supplies a class extending `ToolCommandHandler<TState, TAction>` from `src/core/sdk.ts`. Its `definitions` map command IDs to named actions; `actions` map those names to tool-owned callbacks. Every ID must start with the tool's ID and a dot, such as `example.convert`. This keeps IDs apart from core commands (`settings`, `tool:<id>`) and from other tools. Descriptions and availability can depend on current provider state. For example:

```tsx
import { ToolCommandHandler, useToolCommands, type ToolCommandDefinition } from "../../core/sdk";

type ExampleState = { busy: boolean; convert: () => Promise<void> };

class ExampleCommandHandler extends ToolCommandHandler<ExampleState, "convert"> {
  protected readonly definitions: readonly ToolCommandDefinition<ExampleState, "convert">[] = [
    {
      id: "example.convert", name: "Example: Convert", action: "convert",
      description: (state) => state.busy ? "Wait for conversion to finish" : "Convert the current input",
      enabled: (state) => !state.busy,
    },
  ];
  protected readonly actions = {
    convert: (state: ExampleState) => state.convert(),
  };
}

const handler = new ExampleCommandHandler();
function ExampleCommands() {
  const state = useExample(); // The module's own provider hook.
  useToolCommands(handler, state);
  return null;
}
// Include Commands: ExampleCommands in the tool manifest.
```

Keep the handler instance stable. `useToolCommands` publishes display metadata and dispatches against the latest provider state. It works only inside the manifest's `Commands` component, where core supplies the tool's ID, and rejects IDs outside the tool's prefix. The base class rechecks availability on execution and rejects unknown IDs; `CommandProvider` rejects an ID registered twice. Awaitable action results and errors reach the palette. OCR's `OcrCommandHandler` is a production example; the independent counter fixture verifies the same contract with another tool.

## State and dependency rules

The core command palette builds navigation results from the registry and actions from `CommandProvider`. Tool handlers own their action mappings, and should describe missing prerequisites when disabling a command. Registrations update with provider state and are removed on unmount. Core supplies search, selection, focus handling, and execution error notifications. Prefixing a query with `>` filters to actions.

`ShortcutProvider` persists the palette shortcut independently of tool preferences. Browser/non-Windows input uses a local matcher; Windows uses `platform/palette_shortcut.rs`, with a pass-through low-level hook for the default modifier gesture and `RegisterHotKey` for custom chords. Shortcut recording temporarily suspends the native trigger. Global activation opens a separate topmost `command-palette` webview through `platform/palette_window.rs`; it leaves the main window minimized and does not launch an app that has exited.

The floating entry `index.html#command-palette` renders only the shared palette view and appearance providers. `App.tsx` loads the toolbox and tool registry lazily, so the popup never downloads tool modules. `useDesktopPalette` publishes serializable command metadata to a native cache, and the floating window subscribes before reading it. It forwards a selected ID through `palette_execute`; native code checks the sender and cached availability, restores main, and emits `palette-execute`. The main window rechecks the live command and runs its current callback. Tool providers are never duplicated in the popup. Escape, loss of focus, and closing the popup hide it for reuse; closing main still exits the app.

- The composition root imports the core and tool registry. The core never imports a tool implementation. A tool imports core contracts, layouts, and services only through `src/core/sdk.ts`; everything else in core is private to the shell. A tool must not import a sibling tool's private implementation. Keep core text and tests free of specific tool names.
- Keep tool-specific types, styles, tests, build hooks, persistence, and services in the tool's folder. Put a service in core only when it is genuinely shared, such as text export.
- A tool's optional provider stays mounted while switching workspaces, settings, and activity pages. This preserves in-progress session data. Keep provider initialization light; create heavy resources only on demand and dispose of them when idle/unmounted.
- Input handling belongs to the active tool. OCR's file drop, image paste, and action shortcuts do not intercept other tools' input. Global search remains a core shortcut.
- Persist serializable tool data, not React nodes. New tools should use their own namespaced storage keys. OCR retains the original release's existing keys so current preferences and history continue working.
- Tool styles should be scoped to the tool root (OCR uses `:where(.ocr-tool)`). Shared theme and layout styles belong to core.
- Add native logic under `src-tauri/src/tools/<id>/`. Register commands explicitly in the native composition root and list them in `src-tauri/build.rs`. Listing turns on Tauri's command ACL, so a window can call only the commands granted to it. Grant a tool's commands and plugin permissions in its own `src-tauri/capabilities/<id>.json`, for the `main` window only. Frontend registration does not automatically expose native commands.

These are built-in source modules, not a third-party plugin sandbox. A separate schema-driven layout tree would become useful for user-editable layouts, a visual designer, or an external plugin protocol. For the current toolbox, React composition gives the desired boundary with fewer abstractions. See [React's composition guidance](https://react.dev/learn/passing-props-to-a-component#passing-jsx-as-children).

## Verification

`npm run check` includes command handler dispatch and ID-prefix tests, dependency boundaries (including the SDK-only rule), and registry validation. `npm run test:e2e` includes an independent two-tool fixture: it verifies automatic navigation/search, class-based actions with current state, global-only settings, tool-local preferences, activity contributions, different layouts, and an empty registry. Core tests use only that fixture or mocked data, so they pass without OCR; the fixture tools are not included in production. OCR's own tests, including its palette and appearance integration, live alongside its module. `npm run check:native` tests the OCR native endpoint policy, the floating palette/shortcut services, and the per-window command ACL.
