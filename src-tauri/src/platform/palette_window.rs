//! A separate launcher window keeps the main toolbox minimized until a command
//! is chosen. Only display metadata crosses into this window; commands execute
//! in the main webview, where their current availability can be checked again.

use serde_json::{json, Value};
use std::{collections::HashSet, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const MAIN_WINDOW: &str = "main";
const PALETTE_WINDOW: &str = "command-palette";
const WIDTH: f64 = 720.0;
const HEIGHT: f64 = 560.0;

pub struct PaletteWindowState {
    snapshot: Mutex<Value>,
}

impl Default for PaletteWindowState {
    fn default() -> Self {
        Self {
            snapshot: Mutex::new(json!({ "commands": [], "shortcutLabel": "Ctrl + Shift twice" })),
        }
    }
}

fn require_window(label: &str, expected: &str) -> Result<(), String> {
    if label == expected {
        Ok(())
    } else {
        Err("This command is not available from this window.".into())
    }
}

fn validate_snapshot(snapshot: &Value) -> Result<(), String> {
    let commands = snapshot["commands"].as_array()
        .ok_or("The command palette snapshot must contain a command list.")?;
    if !snapshot["shortcutLabel"].is_string() {
        return Err("The command palette shortcut label must be text.".into());
    }
    let mut ids = HashSet::new();
    for command in commands {
        let id = command["id"].as_str().filter(|id| !id.is_empty())
            .ok_or("Every command must have a non-empty ID.")?;
        if !ids.insert(id) {
            return Err("Command palette IDs must be unique.".into());
        }
        if !command["name"].is_string()
            || !matches!(command["kind"].as_str(), Some("tool" | "navigation" | "action"))
            || command.get("disabled").is_some_and(|value| !value.is_boolean())
        {
            return Err("The command palette contains invalid command metadata.".into());
        }
    }
    Ok(())
}

fn validate_execution(snapshot: &Value, id: &str) -> Result<(), String> {
    let command = snapshot["commands"].as_array()
        .and_then(|commands| commands.iter().find(|command| command["id"].as_str() == Some(id)))
        .ok_or("This command is no longer available.")?;
    if command["disabled"].as_bool() == Some(true) {
        return Err("This command is currently unavailable.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn palette_update_snapshot(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, PaletteWindowState>,
    snapshot: Value,
) -> Result<(), String> {
    require_window(window.label(), MAIN_WINDOW)?;
    validate_snapshot(&snapshot)?;
    *state.snapshot.lock().map_err(|_| "The command palette is unavailable.")? = snapshot.clone();
    // A newly created webview also reads the cache, so a first-show listener race
    // cannot lose the command list.
    app.emit_to(PALETTE_WINDOW, "palette-snapshot", snapshot).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn palette_get_snapshot(
    window: WebviewWindow,
    state: tauri::State<'_, PaletteWindowState>,
) -> Result<Value, String> {
    require_window(window.label(), PALETTE_WINDOW)?;
    state.snapshot.lock().map(|snapshot| snapshot.clone())
        .map_err(|_| "The command palette is unavailable.".into())
}

#[tauri::command]
pub fn palette_hide(window: WebviewWindow) -> Result<(), String> {
    require_window(window.label(), PALETTE_WINDOW)?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn palette_execute(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, PaletteWindowState>,
    id: String,
) -> Result<(), String> {
    require_window(window.label(), PALETTE_WINDOW)?;
    {
        let snapshot = state.snapshot.lock().map_err(|_| "The command palette is unavailable.")?;
        validate_execution(&snapshot, &id)?;
    }
    let main = app.get_webview_window(MAIN_WINDOW).ok_or("The toolbox window is unavailable.")?;
    window.hide().map_err(|error| error.to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())?;
    app.emit_to(MAIN_WINDOW, "palette-execute", json!({ "id": id }))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn palette_show(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    require_window(window.label(), MAIN_WINDOW)?;
    let (result, response) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = result.send(show(&handle));
    }).map_err(|error| error.to_string())?;
    response.await.map_err(|_| "The command palette could not be opened.".to_string())?
}

/// Call on Tauri's main thread: window construction is serialized here so two
/// closely spaced shortcut events always reuse the same webview.
pub fn show(app: &AppHandle) -> Result<(), String> {
    let palette = match app.get_webview_window(PALETTE_WINDOW) {
        Some(window) => window,
        None => {
            let window = WebviewWindowBuilder::new(app, PALETTE_WINDOW, WebviewUrl::App("index.html#command-palette".into()))
                .title("Toolbox-Chan Command Palette")
                .inner_size(WIDTH, HEIGHT)
                .visible(false)
                .focused(false)
                .decorations(false)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .skip_taskbar(true)
                .always_on_top(true)
                .shadow(true)
                .disable_drag_drop_handler()
                .build().map_err(|error| error.to_string())?;
            let handle = app.clone();
            window.on_window_event(move |event| {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        if let Some(window) = handle.get_webview_window(PALETTE_WINDOW) {
                            let _ = window.hide();
                        }
                    }
                    WindowEvent::Focused(false) => {
                        if let Some(window) = handle.get_webview_window(PALETTE_WINDOW) {
                            // Ignore an older blur event if a rapid new shortcut
                            // has already focused this window again.
                            if !window.is_focused().unwrap_or(false) {
                                let _ = window.hide();
                            }
                        }
                    }
                    _ => {}
                }
            });
            window
        }
    };
    position_on_active_monitor(app, &palette)?;
    palette.show().map_err(|error| error.to_string())?;
    palette.set_focus().map_err(|error| error.to_string())?;
    app.emit_to(PALETTE_WINDOW, "palette-opened", ()).map_err(|error| error.to_string())
}

fn position_on_active_monitor(app: &AppHandle, palette: &WebviewWindow) -> Result<(), String> {
    let foreground = foreground_position().and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten());
    let monitor = foreground
        .or_else(|| app.cursor_position().ok().and_then(|point| app.monitor_from_point(point.x, point.y).ok().flatten()))
        .or_else(|| app.get_webview_window(MAIN_WINDOW).and_then(|window| window.current_monitor().ok().flatten()))
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let width = WIDTH.min((f64::from(area.size.width) / scale - 32.0).max(1.0));
        let height = HEIGHT.min((f64::from(area.size.height) / scale - 32.0).max(1.0));
        palette.set_size(tauri::LogicalSize::new(width, height)).map_err(|error| error.to_string())?;
        let x = area.position.x + ((f64::from(area.size.width) - width * scale) / 2.0).round() as i32;
        let y = area.position.y + ((f64::from(area.size.height) - height * scale) / 3.0).round() as i32;
        palette.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|error| error.to_string())?;
    } else {
        palette.center().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
fn foreground_position() -> Option<(f64, f64)> {
    #[repr(C)]
    #[derive(Default)]
    struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut std::ffi::c_void;
        fn GetWindowRect(window: *mut std::ffi::c_void, rect: *mut Rect) -> i32;
    }
    let mut rect = Rect::default();
    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() || GetWindowRect(window, &mut rect) == 0 {
            return None;
        }
    }
    Some(((f64::from(rect.left) + f64::from(rect.right)) / 2.0, (f64::from(rect.top) + f64::from(rect.bottom)) / 2.0))
}

#[cfg(not(windows))]
fn foreground_position() -> Option<(f64, f64)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_requires_an_existing_enabled_command() {
        let snapshot = json!({ "commands": [
            { "id": "open:ocr", "name": "OCR", "kind": "tool" },
            { "id": "ocr:copy", "name": "Copy text", "kind": "action", "disabled": true }
        ], "shortcutLabel": "Ctrl + Shift twice" });
        assert!(validate_snapshot(&snapshot).is_ok());
        assert!(validate_execution(&snapshot, "open:ocr").is_ok());
        assert!(validate_execution(&snapshot, "ocr:copy").is_err());
        assert!(validate_execution(&snapshot, "unknown").is_err());
    }

    #[test]
    fn rejects_ambiguous_or_malformed_snapshots() {
        for snapshot in [
            json!({ "commands": [], "shortcutLabel": 42 }),
            json!({ "commands": [{ "id": "", "name": "OCR", "kind": "tool" }], "shortcutLabel": "" }),
            json!({ "commands": [{ "id": "ocr", "name": "OCR", "kind": "native" }], "shortcutLabel": "" }),
            json!({ "commands": [{ "id": "ocr", "name": "OCR", "kind": "tool", "disabled": "true" }], "shortcutLabel": "" }),
            json!({ "commands": [
                { "id": "ocr", "name": "OCR", "kind": "tool" },
                { "id": "ocr", "name": "Duplicate", "kind": "tool" }
            ], "shortcutLabel": "" }),
        ] {
            assert!(validate_snapshot(&snapshot).is_err(), "accepted {snapshot}");
        }
    }

    #[test]
    fn window_commands_reject_the_wrong_sender() {
        assert!(require_window(MAIN_WINDOW, MAIN_WINDOW).is_ok());
        assert!(require_window(PALETTE_WINDOW, PALETTE_WINDOW).is_ok());
        assert!(require_window(PALETTE_WINDOW, MAIN_WINDOW).is_err());
        assert!(require_window(MAIN_WINDOW, PALETTE_WINDOW).is_err());
    }
}
