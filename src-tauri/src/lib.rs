mod platform;
mod tools;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Agent hooks start this executable as a short-lived adapter; it exits before Tauri starts.
    if let Some(code) = tools::agent_pet::hook_cli::run_if_requested() {
        std::process::exit(code);
    }
    // Claude Code runs it as its status line wrapper; it also exits before Tauri starts.
    if let Some(code) = tools::agent_pet::limits::status_line::run_if_requested() {
        std::process::exit(code);
    }
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
            if let Err(error) = tools::agent_todo::start(app.handle()) {
                eprintln!("Agent TODO could not start: {error}");
            }
            tools::agent_pet::install(app.handle())?;
            // The main window starts hidden so a start with Windows stays in the tray.
            if !platform::tray::started_by_autostart() {
                let _ = platform::tray::show_main(app.handle());
            }
            Ok(())
        })
        .manage(platform::palette_window::PaletteWindowState::default())
        .manage(platform::pet_events::PetHub::default())
        .manage(tools::ocr::online::OnlineRequests::default())
        .manage(tools::agent_pet::window::PetWindowState::default())
        .manage(tools::agent_pet::dsh_watch::DshWatcher::default())
        .manage(tools::agent_pet::limits::LimitWatcher::default())
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
            tools::session_analyze::session_analyze_scan,
            tools::session_analyze::session_analyze_run,
            tools::session_analyze::session_analyze_coverage,
            tools::session_analyze::session_analyze_export,
            tools::session_analyze::pricing::session_analyze_prices,
            tools::session_analyze::pricing::session_analyze_open_prices,
            tools::ocr::online::online_ocr,
            tools::ocr::online::cancel_online_ocr,
            tools::agent_todo::agent_todo_state,
            tools::agent_todo::agent_todo_remove,
            tools::agent_todo::agent_todo_restore,
            tools::agent_todo::agent_todo_clear_history,
            tools::agent_todo::agent_todo_set_paused,
            tools::agent_todo::agent_todo_scan_now,
            tools::agent_todo::agent_todo_rules,
            tools::agent_todo::agent_todo_add_rule,
            tools::agent_todo::agent_todo_remove_rule,
            tools::agent_pet::window::agent_pet_set_window,
            tools::agent_pet::hooks::agent_pet_hooks,
            tools::agent_pet::hooks::agent_pet_install_hooks,
            tools::agent_pet::hooks::agent_pet_remove_hooks,
            tools::agent_pet::idle_moves::agent_pet_idle_moves,
            tools::agent_pet::idle_moves::agent_pet_import_idle_move,
            tools::agent_pet::idle_moves::agent_pet_remove_idle_move,
            tools::agent_pet::limits::agent_pet_limits,
            tools::agent_pet::limits::agent_pet_install_status_line,
            tools::agent_pet::limits::agent_pet_remove_status_line
        ])
        .run(tauri::generate_context!())
        .expect("error while running Toolbox-Chan");
}
