import { useEffect, useId, useRef, useState } from "react";
import { Keyboard, RotateCcw, X } from "lucide-react";
import { usePaletteShortcut } from "../commands/ShortcutProvider";
import {
  DEFAULT_PALETTE_SHORTCUT, formatShortcut, shortcutFromEvent, validateShortcut,
} from "../commands/shortcuts";

export function CommandPaletteSettings() {
  const id = useId();
  const { shortcut, shortcutLabel, setShortcut, recording, setRecording, nativeActive, error } = usePaletteShortcut();
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const recorderRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const record = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || event.isComposing || saving) return;
      if (event.key === "Escape") {
        setRecording(false);
        setMessage("Shortcut recording canceled.");
        return;
      }
      const value = shortcutFromEvent(event);
      if (!value) {
        setPreview([
          event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift",
          event.metaKey && "Win / ⌘",
        ].filter(Boolean).join(" + "));
        return;
      }
      setPreview(formatShortcut(value));
      const validation = validateShortcut(value);
      if (validation) {
        setMessage(validation);
        return;
      }
      setSaving(true);
      void setShortcut(value).then((success) => {
        setMessage(success ? `Shortcut saved: ${formatShortcut(value)}.` : "Choose another shortcut or try again.");
        setRecording(false);
        setSaving(false);
        recorderRef.current?.focus();
      });
    };
    document.addEventListener("keydown", record, true);
    return () => document.removeEventListener("keydown", record, true);
  }, [recording, saving, setRecording, setShortcut]);

  useEffect(() => () => setRecording(false), [setRecording]);

  async function restoreDefault() {
    setSaving(true);
    const success = await setShortcut(DEFAULT_PALETTE_SHORTCUT);
    setMessage(success ? "Default shortcut restored." : "The default shortcut could not be enabled.");
    setSaving(false);
  }

  return (
    <section className="settings-card palette-settings" aria-labelledby={`${id}-heading`}>
      <div className="settings-section-heading">
        <Keyboard size={16} aria-hidden="true" />
        <h2 id={`${id}-heading`}>Command palette</h2>
      </div>
      <div className="shortcut-setting-row">
        <div className="shortcut-setting-description">
          <span id={`${id}-label`}>Open command palette</span>
          <p id={`${id}-description`}>Find a tool or run an action without leaving your keyboard.</p>
        </div>
        <kbd className={`shortcut-preview${recording ? " is-recording" : ""}`} aria-label={recording ? "Shortcut being recorded" : "Current shortcut"}>
          {recording ? preview || "Press your shortcut…" : shortcutLabel}
        </kbd>
      </div>
      <div className="shortcut-controls">
        <button
          ref={recorderRef}
          className="button-secondary shortcut-record-button"
          type="button"
          disabled={saving}
          aria-pressed={recording}
          aria-describedby={`${id}-description ${id}-status`}
          onClick={() => {
            setRecording(!recording);
            setPreview("");
            setMessage(recording ? "Shortcut recording canceled." : "Press a shortcut with a modifier key. Press Escape to cancel.");
          }}
        >
          {recording ? <X size={15} aria-hidden="true" /> : <Keyboard size={15} aria-hidden="true" />}
          {saving ? "Saving…" : recording ? "Cancel recording" : "Record shortcut"}
        </button>
        <button
          className="button-secondary shortcut-reset-button"
          type="button"
          disabled={recording || saving || shortcut === DEFAULT_PALETTE_SHORTCUT}
          onClick={() => void restoreDefault()}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Restore default
        </button>
      </div>
      <p className="shortcut-note">Default: press and release Ctrl + Shift twice within half a second. Ctrl + K also opens the palette while the toolbox is focused.</p>
      <p className="shortcut-note">{nativeActive ? "Opens a floating palette anywhere on Windows. The toolbox stays minimized until you choose a command." : "Your shortcut works while the toolbox is focused."}</p>
      <p id={`${id}-status`} className={`shortcut-status${error ? " is-error" : ""}`} role="status" aria-live="polite">
        {error || message || "Shortcuts are saved on this device."}
      </p>
    </section>
  );
}
