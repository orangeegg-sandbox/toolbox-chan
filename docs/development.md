# Development and setup

[← Toolbox-Chan](../README.md)

Toolbox-Chan uses Tauri 2 for its desktop host, React and TypeScript for its UI, and independent modules for each tool.

## Run locally

Use Node.js 22.12+ or 24 and npm. Native builds also require stable Rust and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/): C++ build tools and WebView2 on Windows, Xcode command-line tools on macOS, and the documented WebKitGTK dependencies on Linux.

```sh
npm ci
npm run desktop
```

For a browser preview without Rust:

```sh
npm run dev
```

Open `http://127.0.0.1:1420`. Native clipboard and save dialogs use browser equivalents in preview. Desktop file-drop interception is disabled so standard image drop events reach the frontend.

## Checks and builds

```sh
npm run check                          # TypeScript and unit tests
npm run desktop:build                  # Native packages for the current OS
npm run desktop:build -- --bundles nsis # Windows installer only
```

See [testing](test/README.md) for every check, browser test setup, and what to do when tests time out.

On Windows, run the built app at `src-tauri/target/release/little-toolbox.exe`, or install the setup executable in `src-tauri/target/release/bundle/nsis/`.

Internal package names, the executable name, the bundle identifier, and saved preference keys retain their existing identifiers so the Toolbox-Chan rename preserves compatibility.

The [desktop build workflow](../.github/workflows/desktop.yml) supports manual runs and version tags. Build each platform on that platform; macOS/Linux packages need verification on their respective systems. Installers are unsigned until signing identities are configured.

## Using the app

Preferences, the command palette, and the tray are described in [using Toolbox-Chan](usage/README.md).

## Pet event API

Tools and outside programs talk to the desktop pets through one API; see [architecture](architecture.md#background-running-and-the-pet-event-api). To try it from a terminal while the desktop app runs:

```sh
curl -s -m 2 -H "Content-Type: application/json" -d "{\"source\":\"manual\",\"agent\":\"claude\",\"status\":\"done\",\"note\":\"Hello from curl\"}" http://127.0.0.1:47615/pet/events
```

A valid event returns `204`; anything else returns a short plain-text reason. The [Agent pets](../src/tools/agent-pet/README.md) tool shows these events as desktop pets.

## Assets and native tooling

`scripts/prepare-tools.mjs` runs each tool's optional asset-preparation hook before development and builds. OCR's hook copies installed runtime files and language models into `public/tools/ocr/`, which becomes `tools/ocr/` in the built app. Asset hashes and sizes are recorded in its generated `manifest.json`. Generated output is ignored by Git and embedded through `dist/` for production. See the [OCR guide](../src/tools/ocr/README.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).

`scripts/desktop.mjs` uses a project-local Rust toolchain in `.tools/` when available, otherwise the system Rust installation. On Windows, it also detects the standard Visual Studio 2022 C++ environment. It changes environment variables only for the child build process.

## Add a tool

Place each tool in `src/tools/<id>/` with its manifest, UI, state, services, styles, README, and tests, then register it in `src/tools/index.ts`. Import core only from `src/core/sdk.ts`: it supplies the `ToolDefinition` contract, `ToolPage`, `SplitPane`, and `ToolPanel` layouts, and shared services. Render tool preferences inside its workspace. For palette actions, provide a tool-owned class extending `ToolCommandHandler`, give every command ID a `<id>.` prefix, and register it through `useToolCommands(handler, state)` in the manifest's `Commands` component. Native commands go in `src-tauri/src/tools/<id>/`, the command list in `src-tauri/build.rs`, and their permissions in `src-tauri/capabilities/<id>.json`.

Add a row to the [main README's Tools table](../README.md#tools) with an icon, tool name, short description, and links to the tool folder and its README. Keep usage instructions in the tool's README.

Read the [architecture and module guide](architecture.md) for the layout tree, dependency rules, and a complete tool example.
