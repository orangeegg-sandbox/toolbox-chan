import { ThemeSettings } from "../components/ThemeSettings";
import { FontSizeSettings } from "../components/FontSizeSettings";
import { CommandPaletteSettings } from "../components/CommandPaletteSettings";

/** App-wide preferences only. Each tool owns its settings inside its workspace. */
export function SettingsPage() {
  return (
    <>
      <h1>Settings</h1>
      <p className="page-intro">
        App-wide preferences. Each tool keeps its own settings in its workspace.
      </p>
      <ThemeSettings />
      <FontSizeSettings />
      <CommandPaletteSettings />
    </>
  );
}
