mod platform;
mod tools;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Registered first: a second launch only brings the running toolbox forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = platform::tray::show_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![platform::tray::AUTOSTART_ARG]),
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(platform::palette_shortcut::PaletteShortcutService::new(app.handle().clone()));
            platform::tray::install(app.handle())?;
            platform::tray::apply_autostart_default(app.handle());
            platform::pet_door::start(app.handle());
            // The main window starts hidden so a start with Windows stays in the tray.
            if !platform::tray::started_by_autostart() {
                let _ = platform::tray::show_main(app.handle());
            }
            Ok(())
        })
        .manage(platform::palette_window::PaletteWindowState::default())
        .manage(platform::pet_events::PetHub::default())
        .manage(tools::ocr::online::OnlineRequests::default())
        .on_window_event(|window, event| {
            if window.label() != platform::tray::MAIN_WINDOW {
                return;
            }
            match event {
                // Closing the toolbox keeps it in the tray; Quit in the tray menu exits.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // Hidden helper windows must not keep the process alive without the toolbox.
                tauri::WindowEvent::Destroyed => window.app_handle().exit(0),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            platform::palette_shortcut::set_palette_shortcut,
            platform::palette_window::palette_update_snapshot,
            platform::palette_window::palette_get_snapshot,
            platform::palette_window::palette_execute,
            platform::palette_window::palette_hide,
            platform::palette_window::palette_show,
            platform::pet_events::pet_notify,
            platform::pet_events::pet_get_state,
            platform::pet_events::pet_run_action,
            platform::text_export::save_text,
            tools::ocr::online::online_ocr,
            tools::ocr::online::cancel_online_ocr
        ])
        .run(tauri::generate_context!())
        .expect("error while running Toolbox-Chan");
}
