mod platform;
mod tools;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(tools::ocr::online::OnlineRequests::default())
        .invoke_handler(tauri::generate_handler![
            platform::text_export::save_text,
            tools::ocr::online::online_ocr,
            tools::ocr::online::cancel_online_ocr
        ])
        .run(tauri::generate_context!())
        .expect("error while running Little Toolbox");
}
