import { ChevronDown, Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "../appearance/ThemeProvider";
import { isThemePreference } from "../appearance/theme";

export function ThemeSettings() {
  const { preference, theme, setPreference } = useTheme();
  const CurrentIcon = theme === "dark" ? Moon : Sun;
  return (
    <section className="settings-card theme-settings" aria-label="Appearance">
      <div className="settings-section-heading">
        <Palette size={19} aria-hidden="true" />
        <h2>Appearance</h2>
        <span className="small-tag">APP-WIDE</span>
      </div>
      <div className="setting-row">
        <div>
          <label htmlFor="color-theme">Color theme</label>
          <p id="color-theme-description">
            Switch themes, or follow your device’s appearance.
          </p>
        </div>
        <div className="select-wrap">
          <select
            id="color-theme"
            aria-describedby="color-theme-description"
            value={preference}
            onChange={(event) => {
              if (isThemePreference(event.target.value))
                setPreference(event.target.value);
            }}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </div>
      </div>
      <div className="settings-note theme-status" role="status">
        <CurrentIcon size={15} aria-hidden="true" />
        <span>
          {preference === "system" ? "Following your system" : "Applied across your toolbox"}
          {" · "}
          {theme === "dark" ? "Dark appearance" : "Light appearance"}
        </span>
        <span className="theme-swatches" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </section>
  );
}
