//! The editable pricing folder is private to this tool. JSON interpretation lives
//! with the frontend calculator so native and imported reports use identical rules.
use serde::Serialize;
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}};
use tauri::Manager;
use super::source::linked;

const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 8 * 1024 * 1024;
static INITIALIZE: std::sync::Mutex<()> = std::sync::Mutex::new(());
const SEEDS: &[(&str, &str)] = &[
    ("deepseek.json", include_str!("../../../../src/tools/session-analyze/pricing/deepseek.json")),
    ("model.example", include_str!("../../../../src/tools/session-analyze/pricing/model.example")),
    ("README.md", include_str!("../../../../src/tools/session-analyze/pricing/README.md")),
];

#[derive(Serialize)]
pub struct PriceFile { name: String, json: String }
#[derive(Serialize)]
pub struct PriceFolder { folder: String, files: Vec<PriceFile> }

fn folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?
        .join("tools").join("session-analyze").join("pricing"))
}

fn initialize(path: &Path) -> Result<(), String> {
    let _guard = INITIALIZE.lock().map_err(|_| "Pricing initialization was interrupted.".to_string())?;
    if fs::symlink_metadata(path).is_ok_and(|metadata| linked(&metadata)) {
        return Err("The pricing folder must not be a symbolic link or junction.".into());
    }
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    match fs::create_dir(path) {
        Ok(()) => {
            // Seed only a new folder. Reloads and upgrades never replace edits or
            // restore deleted prices, which could conflict with the user's history.
            for (name, json) in SEEDS {
                let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path.join(name))
                    .map_err(|error| format!("Could not create pricing file {name}: {error}"))?;
                file.write_all(json.as_bytes()).map_err(|error| format!("Could not seed {name}: {error}"))?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists && path.is_dir() => Ok(()),
        Err(error) => Err(format!("Could not create the pricing folder: {error}")),
    }
}

fn read_folder(path: &Path) -> Result<PriceFolder, String> {
    initialize(path)?;
    let mut files = Vec::new();
    let mut total = 0;
    for (index, entry) in fs::read_dir(path).map_err(|error| error.to_string())?.enumerate() {
        if index >= 1024 { return Err("The pricing folder contains too many entries (maximum 1,024).".into()); }
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("json")) { continue; }
        let name = entry.file_name().to_string_lossy().into_owned();
        let meta = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if !meta.is_file() || linked(&meta) { return Err(format!("Pricing entry {name} must be a regular JSON file, not a link or directory.")); }
        if files.len() >= 32 { return Err("Use at most 32 pricing JSON files.".into()); }
        if meta.len() > MAX_FILE_BYTES { return Err(format!("Pricing file {name} exceeds 1 MiB.")); }
        let mut json = String::new();
        fs::File::open(entry.path()).map_err(|error| error.to_string())?.take(MAX_FILE_BYTES + 1)
            .read_to_string(&mut json).map_err(|error| format!("Could not read pricing file {name}: {error}"))?;
        total += json.len();
        if json.len() as u64 > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES { return Err("Pricing files exceed their size limits (1 MiB each, 8 MiB combined).".into()); }
        files.push(PriceFile { name, json });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(PriceFolder { folder: path.to_string_lossy().into_owned(), files })
}

#[tauri::command]
pub async fn session_analyze_prices(app: tauri::AppHandle) -> Result<PriceFolder, String> {
    let path = folder(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_folder(&path)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn session_analyze_open_prices(app: tauri::AppHandle) -> Result<(), String> {
    let path = folder(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        initialize(&path)?;
        // No caller-supplied path or shell text reaches a process launcher.
        #[cfg(windows)]
        let mut command = {
            use std::os::windows::process::CommandExt;
            let mut command = std::process::Command::new("explorer.exe");
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW; Explorer itself remains visible.
            command
        };
        #[cfg(not(windows))]
        let mut command = std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" });
        command.arg(path).spawn().map(|_| ()).map_err(|error| format!("Could not open the pricing folder: {error}"))
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            Self(std::env::temp_dir().join(format!("toolbox-pricing-{}-{unique}", std::process::id())))
        }
    }
    impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn seeds_once_and_preserves_edits_and_deletions() {
        let temp = Temp::new();
        let first = read_folder(&temp.0).unwrap();
        assert_eq!(first.files.len(), 1);
        serde_json::from_str::<serde_json::Value>(&first.files[0].json).unwrap();
        fs::write(temp.0.join("deepseek.json"), "edited").unwrap();
        assert_eq!(read_folder(&temp.0).unwrap().files[0].json, "edited");
        fs::remove_file(temp.0.join("deepseek.json")).unwrap();
        assert!(read_folder(&temp.0).unwrap().files.is_empty());
        fs::write(temp.0.join("custom.json"), "{}").unwrap();
        assert_eq!(read_folder(&temp.0).unwrap().files[0].name, "custom.json");
    }

    #[test]
    fn refuses_oversized_files_and_json_directories() {
        let temp = Temp::new();
        initialize(&temp.0).unwrap();
        fs::write(temp.0.join("oversized.json"), vec![b' '; MAX_FILE_BYTES as usize + 1]).unwrap();
        assert!(read_folder(&temp.0).err().unwrap().contains("1 MiB"));
        fs::remove_file(temp.0.join("oversized.json")).unwrap();
        fs::create_dir(temp.0.join("directory.json")).unwrap();
        assert!(read_folder(&temp.0).err().unwrap().contains("regular JSON file"));
    }

    #[test]
    fn concurrent_first_reads_receive_complete_seeds() {
        let temp = Temp::new();
        std::thread::scope(|scope| {
            let jobs: Vec<_> = (0..4).map(|_| scope.spawn(|| {
                let data = read_folder(&temp.0).unwrap();
                assert_eq!(data.files.len(), 1);
                assert_eq!(data.files[0].json, SEEDS[0].1);
            })).collect();
            for job in jobs { job.join().unwrap(); }
        });
    }
}
