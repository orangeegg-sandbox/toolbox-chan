import {
  ChevronDown,
  Cloud,
  LockKeyhole,
  ScanLine,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { Language, Preferences } from "../types";
import { LANGUAGES } from "../types";
import { useOcr } from "../OcrProvider";
export default function OcrSettings() {
  const {
    preferences,
    history,
    online,
    setOnline,
    busy,
    updatePreferences,
    removeHistory,
  } = useOcr();
  return (
    <div className="ocr-tool">
      <section className="settings-card">
        <div className="settings-section-heading">
          <ScanLine size={18} />
          <h2>Recognition</h2>
        </div>
        <div className="setting-row">
          <div>
            <label htmlFor="default-language">Default language</label>
            <p>English and Chinese models are included for offline use.</p>
          </div>
          <div className="select-wrap">
            <select
              id="default-language"
              disabled={busy}
              value={preferences.language}
              onChange={(e) =>
                updatePreferences({
                  language: e.target.value as Language,
                })
              }
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
        </div>
        <div className="setting-row">
          <div>
            <label htmlFor="layout">Text layout</label>
            <p>
              Use Scattered text for screenshots with text in separate places.
            </p>
          </div>
          <div className="select-wrap">
            <select
              id="layout"
              disabled={busy}
              value={preferences.layout}
              onChange={(e) =>
                updatePreferences({
                  layout: e.target.value as Preferences["layout"],
                })
              }
            >
              <option value="auto">Automatic page layout</option>
              <option value="sparse">Scattered text</option>
              <option value="block">Single text block</option>
            </select>
            <ChevronDown size={14} />
          </div>
        </div>
        <div className="setting-row">
          <div>
            <label htmlFor="auto-copy">Automatically copy text</label>
            <p>Put the result on your clipboard as soon as it’s ready.</p>
          </div>
          <input
            id="auto-copy"
            className="toggle"
            role="switch"
            type="checkbox"
            disabled={busy}
            checked={preferences.autoCopy}
            onChange={(e) => updatePreferences({ autoCopy: e.target.checked })}
          />
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-section-heading">
          <Cloud size={18} />
          <h2>Optional online OCR</h2>
          <span className="small-tag">SESSION ONLY</span>
        </div>
        <p className="settings-description">
          Connect a vision model using an OpenAI-compatible Chat Completions
          API. Enter the base URL, model ID, and your own API key. Provider fees
          may apply. These fields are kept in memory and cleared when the app
          closes.
        </p>
        <div className="online-form">
          <label>
            API base URL
            <input
              type="url"
              value={online.endpoint}
              disabled={busy}
              spellCheck={false}
              placeholder="https://api.openai.com/v1"
              onChange={(e) =>
                setOnline({ ...online, endpoint: e.target.value })
              }
            />
          </label>
          <label>
            Vision model
            <input
              value={online.model}
              disabled={busy}
              spellCheck={false}
              placeholder="Your provider’s vision model ID"
              onChange={(e) => setOnline({ ...online, model: e.target.value })}
            />
          </label>
          <label>
            API key
            <input
              type="password"
              autoComplete="off"
              value={online.apiKey}
              disabled={busy}
              placeholder="Optional for a local provider"
              onChange={(e) => setOnline({ ...online, apiKey: e.target.value })}
            />
          </label>
        </div>
        <div className="settings-note">
          <LockKeyhole size={14} />
          Nothing is uploaded until you select Online and press Upload & extract
          text. Overlay selection uses the offline engine.
        </div>
      </section>
      <section className="settings-card">
        <div className="settings-section-heading">
          <ShieldCheck size={18} />
          <h2>Privacy & storage</h2>
        </div>
        <div className="setting-row">
          <div>
            <label htmlFor="keep-history">Keep recent activity</label>
            <p>
              Save up to 20 text results locally. Turning this off clears saved
              history.
            </p>
          </div>
          <input
            id="keep-history"
            className="toggle"
            role="switch"
            type="checkbox"
            disabled={busy}
            checked={preferences.keepHistory}
            onChange={(e) =>
              updatePreferences({ keepHistory: e.target.checked })
            }
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>Clear local history</strong>
            <p>Remove saved text results from this device.</p>
          </div>
          <button
            className="button secondary"
            disabled={!history.length}
            onClick={() => removeHistory()}
          >
            Clear {history.length} results
          </button>
        </div>
        <div className="settings-note">
          <WifiOff size={15} />
          Offline recognition needs no internet, account, or API key. No
          analytics.
        </div>
      </section>
    </div>
  );
}
