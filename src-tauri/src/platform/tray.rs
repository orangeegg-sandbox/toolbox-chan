//! Toolbox-Chan keeps running in the system tray, so background features such as
//! the desktop pets and the pet event door stay alive while the main window is
//! closed. Closing the window hides it; Quit in the tray menu exits.

use super::pet_events::PetHub;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub const MAIN_WINDOW: &str = "main";
/// Passed by the login item, so a start with Windows stays in the tray.
pub const AUTOSTART_ARG: &str = "--autostart";
const AUTOSTART_MARKER: &str = "autostart-default-applied";

pub fn show_main(app: &AppHandle) -> Result<(), String> {
    let main = app.get_webview_window(MAIN_WINDOW).ok_or("The toolbox window is unavailable.")?;
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Toolbox-Chan", true, None::<&str>)?;
    let pets = CheckMenuItem::with_id(app, "pets", "Show pets", true, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Toolbox-Chan", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pets, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut tray = TrayIconBuilder::with_id("toolbox")
        .tooltip("Toolbox-Chan")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => {
                let _ = show_main(app);
            }
            // The menu toggles the check mark itself before this runs.
            "pets" => {
                let _ = app.state::<PetHub>().set_visible(app, pets.is_checked().unwrap_or(true));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let _ = show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Starting with Windows is on by default for installed builds. The choice is
/// applied once; after that the Settings switch owns it. Development builds
/// never register themselves, so a debug executable does not start at login.
pub fn apply_autostart_default(app: &AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    let Ok(directory) = app.path().app_config_dir() else { return };
    let marker = directory.join(AUTOSTART_MARKER);
    if marker.exists() {
        return;
    }
    if !cfg!(debug_assertions) && app.autolaunch().enable().is_err() {
        return;
    }
    if std::fs::create_dir_all(&directory).is_ok() {
        let _ = std::fs::write(marker, "");
    }
}

pub fn started_by_autostart() -> bool {
    std::env::args().any(|argument| argument == AUTOSTART_ARG)
}
