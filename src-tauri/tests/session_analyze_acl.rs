//! Session analyze's commands are granted to the toolbox window only.

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
fn only_the_toolbox_window_reaches_session_analyze() {
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
    let (main, palette, other) = (window("main"), window("command-palette"), window("some-other-window"));
    for command in [
        "session_analyze_scan", "session_analyze_run", "session_analyze_coverage", "session_analyze_export",
        "session_analyze_prices", "session_analyze_open_prices",
    ] {
        assert!(allowed(&main, command), "main window was denied {command}");
        assert!(!allowed(&palette, command), "palette window reached {command}");
        assert!(!allowed(&other, command), "another window reached {command}");
    }
}

