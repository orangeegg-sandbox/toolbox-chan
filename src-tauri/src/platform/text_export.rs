use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_text(app: tauri::AppHandle, text: String, name: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = app.dialog().file().add_filter("Text file", &["txt"]).set_file_name(name).blocking_save_file();
        match file {
            Some(file) => {
                let path = file.into_path().map_err(|_| "Please select a local file.".to_string())?;
                std::fs::write(path, text).map_err(|error| format!("Could not save text: {error}"))?;
                Ok(true)
            }
            None => Ok(false),
        }
    }).await.map_err(|_| "The save dialog could not be opened.".to_string())?
}
