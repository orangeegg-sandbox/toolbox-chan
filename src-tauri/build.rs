// Declaring the app commands turns on Tauri's command ACL: a window may call only
// the commands granted to it in `capabilities/`. List every registered command here.
const COMMANDS: &[&str] = &[
    "set_palette_shortcut",
    "palette_update_snapshot",
    "palette_get_snapshot",
    "palette_execute",
    "palette_hide",
    "palette_show",
    "save_text",
    "online_ocr",
    "cancel_online_ocr",
];

fn main() {
    // Test executables do not get the app's resource manifest. Tauri needs Common
    // Controls v6 on Windows, or the test binary fails to load.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
