# Using Toolbox-Chan

[← Toolbox-Chan](../../README.md)

App-wide features. Each tool's own usage is in its README, linked from the [Tools table](../../README.md#tools).

## Preferences

Open **Settings** for global preferences: appearance, font size, the command palette shortcut, and (in the desktop app) startup. Choose **Light**, **Dark**, or **System** appearance. System follows the device's appearance as it changes. **Font size** offers Small (100%), Medium (125%), Large (150%), and Extra large (175%), with a live example. Medium is the default. Preferences apply throughout the toolbox and are saved locally; browser preview and the desktop app use separate local storage. Tool-specific preferences belong on their own tool pages; for example, open **Image to text → OCR settings** for recognition, online providers, and OCR history.

Both appearances use Toolbox-Chan's **Mint Pocket Helper** palette: mint, deep teal, lilac, butter yellow, and ivory. Light mode uses warm surfaces; dark mode uses deep teal surfaces. The sidebar portrait and tool-library character come from the approved [design reference](../design/toolbox-chan/mint-pocket-helper-v2/). Bundled copies live in `src/core/assets/`, with shared colors in `src/core/appearance/theme.css`.

## Command palette

Press and release **Ctrl + Shift twice** within half a second to open the command palette. On Windows desktop, a separate floating palette appears over other apps while the main toolbox stays minimized. Choosing a tool or action restores the main window and uses your existing session. **Escape** or clicking another window hides the floating palette without restoring the toolbox. In browser preview and on other platforms, shortcuts work while the toolbox is focused. **Ctrl/Command + K** and the sidebar search button open the in-app palette.

Search by tool name, ID, description, or keyword. Type **ocr**, then press **Enter** to open Image to text. Use **↑ / ↓**, **Home / End**, and **Enter** to select and run a result; **Escape** or a click outside closes the palette. Type **>** to show actions only. Actions that need an image or extracted text show as unavailable until ready.

Under **Settings → Command palette**, select **Record shortcut** and press a combination with Ctrl, Alt, or Windows/Command. **Escape** cancels recording; **Restore default** returns to the double tap. The preference is stored locally. Windows reports reserved or already registered combinations so you can choose another. The app must remain running for a global shortcut to work; closing the window keeps it running in the tray.

## Tray and startup

Closing the main window hides it; Toolbox-Chan keeps running in the system tray. Click the tray icon to open it again, or choose **Quit Toolbox-Chan** from its menu to exit. **Show pets** in the same menu hides or shows the desktop pets. Opening Toolbox-Chan again while it runs brings the existing window forward.

Installed builds start when you sign in, hidden in the tray. Turn this off under **Settings → Startup**. Development builds (`npm run desktop`) never register themselves to start with the system.
