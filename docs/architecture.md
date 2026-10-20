# Toolbox modules and layout

The app uses Tauri for the native window and React for its UI. React already represents the interface as a component tree. The core owns the application tree; a tool contributes a subtree through a small typed contract. React's `children` and named JSX props provide the layout slots. There is no additional JSON layout format or imperative DOM injection.

## Folder structure

```text
src/
  App.tsx                       # Composition root: core + registered tools
  core/
    ToolboxApp.tsx              # Shell, provider lifecycle, current route, notifications
    ToolboxContext.tsx          # Shared navigation and notification services
    components/                # Sidebar, command palette, shortcuts dialog
    layout/                    # ToolPage, SplitPane, ToolPanel
    pages/                     # Tool library, settings/activity contribution hosts
    platform/                  # Shared clipboard text and native text export
    tools/                     # ToolDefinition contract and registry
    tests/                     # Registry, dependency boundaries, multi-tool integration
    styles.css                 # Shared theme, controls, shell, and layout styles
  tools/
    index.ts                    # Explicit list of installed modules
    ocr/
      index.ts                  # OCR manifest and lazy-loaded surfaces
      OcrProvider.tsx           # OCR session state, actions, resource lifecycle
      components/              # Workspace, panels, settings, activity, image overlays
      services/                # Offline/online recognition, images, image clipboard
      types.ts                 # OCR-specific types and language choices
      constants.ts
      storage.ts               # OCR settings/history persistence
      ocr.css                  # OCR styles scoped beneath .ocr-tool
      scripts/prepare-assets.mjs
      tests/                   # OCR unit and integration tests

src-tauri/src/
  lib.rs                       # Native composition root; explicit command registration
  platform/text_export.rs      # Shared save dialog and text export
  tools/ocr/online.rs          # OCR HTTP requests, cancellation, endpoint validation

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

The core also hosts `Tool.Settings` and `Tool.Activity` contributions on their shared pages. Tools with no such surfaces simply omit them. There is no OCR-specific route branch in the core. An empty registry also works.

`ToolPage` is the normal starting point for a tool's workspace. Its `children` are flexible: a tool can use the shared `SplitPane`, use a single `ToolPanel`, or compose another layout. Core controls the surrounding shell and common layout primitives; the tool controls the content inside those regions. This keeps styling and navigation consistent without forcing every utility to have OCR's input/output structure.

## Register a new tool

Create `src/tools/example/index.tsx`:

```tsx
import { Wrench } from "lucide-react";
import type { ToolDefinition, ToolSurfaceProps } from "../../core/tools/contracts";
import { ToolPage, ToolPanel } from "../../core/layout";

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

Then import it in `src/tools/index.ts` and append it to `tools`. Navigation, tool count, library cards, search, and the workspace host update from that registry. The core does not need an import or a route case for the new tool. For a larger tool, use `React.lazy` for its workspace, settings, and activity components; the core supplies a Suspense fallback.

Optional manifest members:

| Member | Responsibility |
| --- | --- |
| `Provider` | Tool-owned session state shared by its surfaces |
| `Settings` | Settings page contribution |
| `Activity` | Recent activity contribution |
| `Status` | Status content in the core topbar |
| `shortcuts` | Metadata shown in the core help dialog; implement the matching handlers in the tool |
| `subtitle`, `badge` | Core page heading metadata |

Use `useToolbox()` for `openTool(id)`, `openSettings()`, `navigate(route)`, `notify(message, isError)`, and the platform keyboard modifier. It also exposes the current route and registered tool metadata. It does not expose another tool's state.

## State and dependency rules

- The composition root imports the core and tool registry. The core never imports a tool implementation. A tool can import core contracts, layouts, and services; it must not import a sibling tool's private implementation.
- Keep tool-specific types, styles, tests, build hooks, persistence, and services in the tool's folder. Put a service in core only when it is genuinely shared, such as text export.
- A tool's optional provider stays mounted while switching workspaces, settings, and activity pages. This preserves in-progress session data. Keep provider initialization light; create heavy resources only on demand and dispose of them when idle/unmounted.
- Input handling belongs to the active tool. OCR's file drop, image paste, and action shortcuts do not intercept other tools' input. Global search remains a core shortcut.
- Persist serializable tool data, not React nodes. New tools should use their own namespaced storage keys. OCR retains the original release's existing keys so current preferences and history continue working.
- Tool styles should be scoped to the tool root (OCR uses `:where(.ocr-tool)`). Shared theme and layout styles belong to core.
- Add native logic under `src-tauri/src/tools/<id>/`. Register commands explicitly in the native composition root and grant only the needed Tauri permissions. Frontend registration does not automatically expose native commands.

These are built-in source modules, not a third-party plugin sandbox. A separate schema-driven layout tree would become useful for user-editable layouts, a visual designer, or an external plugin protocol. For the current toolbox, React composition gives the desired boundary with fewer abstractions. See [React's composition guidance](https://react.dev/learn/passing-props-to-a-component#passing-jsx-as-children).

## Verification

`npm run check` includes a dependency-boundary test and registry validation. `npm run test:e2e` includes an independent two-tool fixture: it verifies automatic navigation/search, optional settings/activity surfaces, state retention, different workspace layouts, and an empty registry. Those fixture tools are not included in production. OCR's own tests live alongside its module. `npm run check:native` tests the OCR native endpoint policy.
