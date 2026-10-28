// Declaring the app commands turns on Tauri's command ACL: a window may call only
// the commands granted to it in `capabilities/`. List every registered command here.
const COMMANDS: &[&str] = &[
    "set_palette_shortcut",
    "palette_update_snapshot",
    "palette_get_snapshot",
    "palette_execute",
    "palette_hide",
    "palette_show",
    "pet_notify",
    "pet_get_state",
    "pet_run_action",
    "save_text",
    "session_analyze_scan",
    "session_analyze_run",
    "session_analyze_coverage",
    "session_analyze_export",
    "session_analyze_prices",
    "session_analyze_open_prices",
    "online_ocr",
    "cancel_online_ocr",
    "agent_todo_state",
    "agent_todo_remove",
    "agent_todo_restore",
    "agent_todo_clear_history",
    "agent_todo_set_paused",
    "agent_todo_scan_now",
    "agent_todo_rules",
    "agent_todo_add_rule",
    "agent_todo_remove_rule",
    "agent_pet_set_window",
    "agent_pet_hooks",
    "agent_pet_install_hooks",
    "agent_pet_remove_hooks",
    "agent_pet_idle_moves",
    "agent_pet_import_idle_move",
    "agent_pet_remove_idle_move",
    "agent_pet_limits",
    "agent_pet_install_status_line",
    "agent_pet_remove_status_line",
];

fn main() {
    // Test executables do not get the app's resource manifest. Tauri needs Common
    // Controls v6 on Windows, or the test binary fails to load.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    // tauri-build embeds the icons but only watches tauri.conf.json, so a new icon
    // would not reach the app until something else forced a rebuild.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
