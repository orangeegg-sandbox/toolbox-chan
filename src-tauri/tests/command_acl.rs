//! Each window may call only the native commands its capability files grant.

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn allowed(window: &WebviewWindow<MockRuntime>, command: &str) -> bool {
    let url = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };
    get_ipc_response(window, InvokeRequest {
        cmd: command.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: url.parse().unwrap(),
        body: InvokeBody::default(),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.into(),
    }).is_ok()
}

#[test]
fn each_window_reaches_only_its_granted_commands() {
    // The ACL allows or denies a call by command name and window before any
    // handler runs, so a catch-all handler stands in for the real commands.
    let app = mock_builder()
        .invoke_handler(|invoke| {
            invoke.resolver.resolve(());
            true
        })
        .build(tauri::generate_context!())
        .expect("failed to build the test app");
    let window = |label: &str| app.get_webview_window(label).unwrap_or_else(|| {
        WebviewWindowBuilder::new(&app, label, WebviewUrl::default()).build().unwrap()
    });
    let (main, palette) = (window("main"), window("command-palette"));
    for command in ["set_palette_shortcut", "palette_update_snapshot", "palette_show", "save_text", "online_ocr", "cancel_online_ocr"] {
        assert!(allowed(&main, command), "main window was denied {command}");
        assert!(!allowed(&palette, command), "palette window reached {command}");
    }
    for command in ["palette_get_snapshot", "palette_execute", "palette_hide"] {
        assert!(allowed(&palette, command), "palette window was denied {command}");
        assert!(!allowed(&main, command), "main window reached {command}");
    }
}
