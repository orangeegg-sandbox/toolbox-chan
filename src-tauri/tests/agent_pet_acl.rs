//! The pet window reaches only what the pets need; hook editing stays in the toolbox window.

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
fn the_pet_window_reaches_only_the_pet_commands() {
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
    let (main, pet, palette) = (window("main"), window("agent-pet"), window("command-palette"));
    // Plugin commands fail without arguments whether or not they are granted, so only app commands are checked.
    for command in ["pet_get_state", "pet_run_action", "agent_pet_set_window"] {
        assert!(allowed(&pet, command), "pet window was denied {command}");
    }
    for command in [
        "pet_notify", "agent_pet_hooks", "agent_pet_install_hooks", "agent_pet_remove_hooks",
        "save_text", "online_ocr", "cancel_online_ocr", "palette_execute", "palette_get_snapshot", "palette_show",
        "set_palette_shortcut",
    ] {
        assert!(!allowed(&pet, command), "pet window reached {command}");
    }
    for command in ["agent_pet_hooks", "agent_pet_install_hooks", "agent_pet_remove_hooks"] {
        assert!(allowed(&main, command), "main window was denied {command}");
        assert!(!allowed(&palette, command), "palette window reached {command}");
    }
    assert!(!allowed(&main, "agent_pet_set_window"), "main window reached agent_pet_set_window");
}
