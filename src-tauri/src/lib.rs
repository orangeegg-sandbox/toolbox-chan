mod platform;
mod tools;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(platform::palette_shortcut::PaletteShortcutService::new(app.handle().clone()));
            Ok(())
        })
        .manage(platform::palette_window::PaletteWindowState::default())
        .manage(tools::ocr::online::OnlineRequests::default())
        .on_window_event(|window, event| {
            // The hidden launcher must not keep the process running after the
            // user closes the main toolbox window.
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            platform::palette_shortcut::set_palette_shortcut,
            platform::palette_window::palette_update_snapshot,
            platform::palette_window::palette_get_snapshot,
            platform::palette_window::palette_execute,
            platform::palette_window::palette_hide,
            platform::palette_window::palette_show,
            platform::text_export::save_text,
            tools::ocr::online::online_ocr,
            tools::ocr::online::cancel_online_ocr
        ])
        .run(tauri::generate_context!())
        .expect("error while running Toolbox-Chan");
}
