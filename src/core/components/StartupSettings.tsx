import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useToolbox } from "../ToolboxContext";

/** Desktop only: the browser preview cannot start with the system or live in a tray. */
export function StartupSettings() {
  const { notify } = useToolbox();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    invoke<boolean>("plugin:autostart|is_enabled")
      .then((value) => { if (current) setEnabled(value); })
      .catch(() => { if (current) notify("Could not read the startup setting.", true); });
    return () => { current = false; };
  }, [notify]);

  async function change(next: boolean) {
    setSaving(true);
    try {
      await invoke(next ? "plugin:autostart|enable" : "plugin:autostart|disable");
      setEnabled(next);
    } catch {
      notify("Could not change the startup setting. Please try again.", true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-card" aria-labelledby="startup-heading">
      <div className="settings-section-heading">
        <Power size={16} aria-hidden="true" />
        <h2 id="startup-heading">Startup</h2>
      </div>
      <div className="setting-row">
        <div>
          <label htmlFor="start-with-system">Start when you sign in</label>
          <p>Toolbox-Chan starts in the tray, so background features are ready without opening the window.</p>
        </div>
        <input
          id="start-with-system"
          className="toggle"
          role="switch"
          type="checkbox"
          disabled={enabled === null || saving}
          checked={enabled ?? false}
          onChange={(event) => void change(event.target.checked)}
        />
      </div>
      <p className="settings-note">
        Closing the window keeps Toolbox-Chan running in the tray. Choose Quit Toolbox-Chan from the tray icon to exit.
      </p>
    </section>
  );
}

export function StartupSettingsIfDesktop() {
  return isTauri() ? <StartupSettings /> : null;
}
