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
npm run check:native                   # Rust tests
npm run test:e2e                       # Browser integration tests
npm run desktop:build                  # Native packages for the current OS
npm run desktop:build -- --bundles nsis # Windows installer only
```

Browser tests use installed Microsoft Edge on Windows. On macOS/Linux, run `npx playwright install chromium` first. Chinese OCR tests require a CJK system font, such as Microsoft JhengHei or Noto Sans CJK.

On Windows, run the built app at `src-tauri/target/release/little-toolbox.exe`, or install the setup executable in `src-tauri/target/release/bundle/nsis/`.

Internal package names, the executable name, the bundle identifier, and saved preference keys retain their existing identifiers so the Toolbox-Chan rename preserves compatibility.

The [desktop build workflow](../.github/workflows/desktop.yml) supports manual runs and version tags. Build each platform on that platform; macOS/Linux packages need verification on their respective systems. Installers are unsigned until signing identities are configured.

## Preferences

Open **Settings** for global preferences: appearance, font size, the command palette shortcut, and (in the desktop app) startup. Choose **Light**, **Dark**, or **System** appearance. System follows the device's appearance as it changes. **Font size** offers Small (100%), Medium (125%), Large (150%), and Extra large (175%), with a live example. Medium is the default. Preferences apply throughout the toolbox and are saved locally; browser preview and the desktop app use separate local storage. Tool-specific preferences belong on their own tool pages; for example, open **Image to text → OCR settings** for recognition, online providers, and OCR history.

Both appearances use Toolbox-Chan's **Mint Pocket Helper** palette: mint, deep teal, lilac, butter yellow, and ivory. Light mode uses warm surfaces; dark mode uses deep teal surfaces. The sidebar portrait and tool-library character come from the approved [design reference](design/toolbox-chan/mint-pocket-helper-v2/). Bundled copies live in `src/core/assets/`, with shared colors in `src/core/appearance/theme.css`.

## Command palette

Press and release **Ctrl + Shift twice** within half a second to open the command palette. On Windows desktop, a separate floating palette appears over other apps while the main toolbox stays minimized. Choosing a tool or action restores the main window and uses your existing session. **Escape** or clicking another window hides the floating palette without restoring the toolbox. In browser preview and on other platforms, shortcuts work while the toolbox is focused. **Ctrl/Command + K** and the sidebar search button open the in-app palette.

Search by tool name, ID, description, or keyword. Type **ocr**, then press **Enter** to open Image to text. Use **↑ / ↓**, **Home / End**, and **Enter** to select and run a result; **Escape** or a click outside closes the palette. Type **>** to show actions only. Actions that need an image or extracted text show as unavailable until ready.

Under **Settings → Command palette**, select **Record shortcut** and press a combination with Ctrl, Alt, or Windows/Command. **Escape** cancels recording; **Restore default** returns to the double tap. The preference is stored locally. Windows reports reserved or already registered combinations so you can choose another. The app must remain running for a global shortcut to work; closing the window keeps it running in the tray.

## Tray and startup

Closing the main window hides it; Toolbox-Chan keeps running in the system tray. Click the tray icon to open it again, or choose **Quit Toolbox-Chan** from its menu to exit. **Show pets** in the same menu hides or shows the desktop pets. Opening Toolbox-Chan again while it runs brings the existing window forward.

Installed builds start when you sign in, hidden in the tray. Turn this off under **Settings → Startup**. Development builds (`npm run desktop`) never register themselves to start with the system.

## Pet event API

Tools and outside programs talk to the desktop pets through one API; see [architecture](architecture.md#background-running-and-the-pet-event-api). To try it from a terminal while the desktop app runs:

```sh
curl -s -m 2 -H "Content-Type: application/json" -d "{\"source\":\"manual\",\"agent\":\"claude\",\"status\":\"done\",\"note\":\"Hello from curl\"}" http://127.0.0.1:47615/pet/events
```

A valid event returns `204`; anything else returns a short plain-text reason.

## Assets and native tooling

`scripts/prepare-tools.mjs` runs each tool's optional asset-preparation hook before development and builds. OCR's hook copies installed runtime files and language models into `public/tools/ocr/`, which becomes `tools/ocr/` in the built app. Asset hashes and sizes are recorded in its generated `manifest.json`. Generated output is ignored by Git and embedded through `dist/` for production. See the [OCR guide](../src/tools/ocr/README.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).

`scripts/desktop.mjs` uses a project-local Rust toolchain in `.tools/` when available, otherwise the system Rust installation. On Windows, it also detects the standard Visual Studio 2022 C++ environment. It changes environment variables only for the child build process.

## Add a tool

Place each tool in `src/tools/<id>/` with its manifest, UI, state, services, styles, README, and tests, then register it in `src/tools/index.ts`. Import core only from `src/core/sdk.ts`: it supplies the `ToolDefinition` contract, `ToolPage`, `SplitPane`, and `ToolPanel` layouts, and shared services. Render tool preferences inside its workspace. For palette actions, provide a tool-owned class extending `ToolCommandHandler`, give every command ID a `<id>.` prefix, and register it through `useToolCommands(handler, state)` in the manifest's `Commands` component. Native commands go in `src-tauri/src/tools/<id>/`, the command list in `src-tauri/build.rs`, and their permissions in `src-tauri/capabilities/<id>.json`.

Add a row to the [main README's Tools table](../README.md#tools) with an icon, tool name, short description, and links to the tool folder and its README. Keep usage instructions in the tool's README.

Read the [architecture and module guide](architecture.md) for the layout tree, dependency rules, and a complete tool example.
