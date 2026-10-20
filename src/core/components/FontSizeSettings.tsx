import { useId } from "react";
import { ChevronDown, Type } from "lucide-react";
import {
  FONT_SIZE_LEVELS,
  parseFontSize,
  useFontSize,
} from "../appearance/FontSizeProvider";
import "../appearance/typography.css";

export function FontSizeSettings() {
  const id = useId();
  const { fontSize, setFontSize } = useFontSize();
  const level = FONT_SIZE_LEVELS.find((option) => option.value === fontSize)!;

  return (
    <section
      className="settings-card font-size-settings"
      aria-labelledby={`${id}-heading`}
    >
      <div className="settings-section-heading">
        <Type size={18} aria-hidden="true" />
        <h2 id={`${id}-heading`}>Text size</h2>
      </div>
      <div className="font-size-setting-row">
        <div className="font-size-setting-description">
          <label htmlFor={`${id}-select`}>Font size</label>
          <p id={`${id}-description`}>
            Make text comfortable to read throughout your toolbox.
          </p>
        </div>
        <div className="font-size-select-wrap">
          <select
            id={`${id}-select`}
            value={fontSize}
            aria-describedby={`${id}-description`}
            onChange={(event) => setFontSize(parseFontSize(event.target.value))}
          >
            {FONT_SIZE_LEVELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} — {option.value}%
              </option>
            ))}
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
      </div>
      <div
        className="font-size-preview"
        role="group"
        aria-label="Font size preview"
      >
        <div className="font-size-preview-caption">
          <span>Live preview</span>
          <output aria-live="polite" aria-atomic="true">
            {level.label} · {fontSize}%
          </output>
        </div>
        <h3>A little easier to read.</h3>
        <p>Give your everyday tasks a comfortable amount of space.</p>
        <label className="font-size-preview-control">
          Example input
          <input type="text" value="Your text, at this size" readOnly />
        </label>
      </div>
      <p className="font-size-settings-note">
        Changes apply immediately and are saved on this device.
      </p>
    </section>
  );
}
