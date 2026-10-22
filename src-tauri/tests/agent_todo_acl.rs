//! Agent TODO's commands are granted to the toolbox window only.

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
fn only_the_toolbox_window_reaches_agent_todo() {
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
        "agent_todo_state", "agent_todo_remove", "agent_todo_restore", "agent_todo_clear_history", "agent_todo_set_paused",
        "agent_todo_scan_now", "agent_todo_rules", "agent_todo_add_rule", "agent_todo_remove_rule",
    ] {
        assert!(allowed(&main, command), "main window was denied {command}");
        assert!(!allowed(&palette, command), "palette window reached {command}");
        assert!(!allowed(&other, command), "another window reached {command}");
    }
}
