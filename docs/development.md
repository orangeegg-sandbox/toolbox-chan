# Development and setup

[← Little Toolbox](../README.md)

Little Toolbox uses Tauri 2 for its desktop host, React and TypeScript for its UI, and independent modules for each tool.

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
npm run check:native                   # Rust tests
npm run test:e2e                       # Browser integration tests
npm run desktop:build                  # Native packages for the current OS
npm run desktop:build -- --bundles nsis # Windows installer only
```

Browser tests use installed Microsoft Edge on Windows. On macOS/Linux, run `npx playwright install chromium` first. Chinese OCR tests require a CJK system font, such as Microsoft JhengHei or Noto Sans CJK.

On Windows, run the built app at `src-tauri/target/release/little-toolbox.exe`, or install the setup executable in `src-tauri/target/release/bundle/nsis/`.

The [desktop build workflow](../.github/workflows/desktop.yml) supports manual runs and version tags. Build each platform on that platform; macOS/Linux packages need verification on their respective systems. Installers are unsigned until signing identities are configured.

## Preferences

Open **Settings** to choose **Light**, **Dark**, or **System** appearance. System follows the device's appearance as it changes. **Font size** offers Small (100%), Medium (125%), Large (150%), and Extra large (175%), with a live example. Medium is the default. Both preferences apply throughout the toolbox and are saved locally; browser preview and the desktop app use separate local storage.

## Assets and native tooling

`scripts/prepare-tools.mjs` runs each tool's optional asset-preparation hook before development and builds. OCR's hook copies installed runtime files and language models into `public/tools/ocr/`, which becomes `tools/ocr/` in the built app. Asset hashes and sizes are recorded in its generated `manifest.json`. Generated output is ignored by Git and embedded through `dist/` for production. See the [OCR guide](../src/tools/ocr/README.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).

`scripts/desktop.mjs` uses a project-local Rust toolchain in `.tools/` when available, otherwise the system Rust installation. On Windows, it also detects the standard Visual Studio 2022 C++ environment. It changes environment variables only for the child build process.

## Add a tool

Place each tool in `src/tools/<id>/` with its manifest, UI, state, services, styles, README, and tests, then register it in `src/tools/index.ts`. The core supplies navigation, settings, activity, and shared layouts through the `ToolDefinition` contract and `ToolPage`, `SplitPane`, and `ToolPanel` components.

Add a row to the [main README's Tools table](../README.md#tools) with an icon, tool name, short description, and links to the tool folder and its README. Keep usage instructions in the tool's README.

Read the [architecture and module guide](architecture.md) for the layout tree, dependency rules, and a complete tool example.
